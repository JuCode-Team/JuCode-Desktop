// Keeps the desktop and the daemon on one set of workspaces, projects and
// sessions (JuCode-CLI docs/daemon-protocol.md): the daemon is the source,
// every client follows it, and the desktop's own edits go to it.
//
// - Workspaces and projects: the desktop's list is sent with `workspaces_set`
//   whenever it differs from the daemon's; a `workspaces` frame that differs
//   is applied here (projects added, removed or renamed elsewhere). An empty
//   daemon takes the desktop's list.
// - Sessions: every daemon session in one of the active workspace's projects
//   shows in the sidebar. Ones not open here are listed dormant and open when
//   first shown; titles and archive state follow the daemon; a session
//   another client removed leaves the list.
//
// Tabs, their order and chrome, and the tile layout stay desktop-only.

import { daemon } from '$lib/protocol';
import type { DaemonSessionView } from '$lib/agents.svelte';
import type { SavedProject, SessionStore } from '$lib/session.svelte';
import type { Project, WorktreeMeta } from '$lib/types';
import type { WorkspaceStore } from '$lib/workbench/workspaceStore.svelte';

interface DaemonProject {
	id: string;
	name: string;
	path: string;
	chats?: boolean;
	worktree?: WorktreeMeta;
}

interface DaemonWorkspace {
	id: string;
	name: string;
	is_default?: boolean;
	color?: string;
	icon?: unknown;
	projects: DaemonProject[];
}

/** Engines a listed session can be opened on (ACP needs its registry agent). */
const LISTED_ENGINES = new Set(['jucode', 'claude', 'codex']);
/** A session created this recently may still be on its way to its tab. */
const NEW_SESSION_GRACE_MS = 10_000;

const trim = (path: string) => path.replace(/[\\/]+$/, '');

function project(p: { id: string; name: string; path: string; chats?: boolean; worktree?: WorktreeMeta }): DaemonProject {
	return {
		id: p.id,
		name: p.name,
		path: p.path,
		...(p.chats ? { chats: true } : {}),
		...(p.worktree ? { worktree: p.worktree } : {})
	};
}

function workspace(
	ws: { id: string; name: string; isDefault?: boolean; is_default?: boolean; color?: string; icon?: unknown },
	projects: DaemonProject[]
): DaemonWorkspace {
	return {
		id: ws.id,
		name: ws.name,
		...(ws.isDefault || ws.is_default ? { is_default: true } : {}),
		...(ws.color ? { color: ws.color } : {}),
		...(ws.icon ? { icon: ws.icon } : {}),
		projects
	};
}

/** JSON with sorted keys, so lists compare equal whatever order a side
 *  wrote their fields in. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export class DaemonSync {
	/** The daemon's save counter; -1 until its list arrived. */
	#rev = -1;
	/** The daemon's list as last seen (or as last sent). */
	#remoteKey = '';
	/** Session ids the last daemon list had. */
	#seen = new Set<string>();

	constructor(
		private store: SessionStore,
		private workspaces: WorkspaceStore
	) {}

	/** The desktop's list, shaped as the daemon keeps it; the active
	 *  workspace's projects come from the live session tree. */
	local(): DaemonWorkspace[] {
		return this.workspaces.workspaces.map((ws) =>
			workspace(
				ws,
				(ws.id === this.workspaces.activeId ? this.store.projects : ws.projects).map(project)
			)
		);
	}

	/** Daemon-wide frames (wired to `daemon.onEvent`). */
	handle(frame: Record<string, unknown>) {
		if (frame.type !== 'workspaces' || !Array.isArray(frame.workspaces)) return;
		const first = this.#rev < 0;
		this.#rev = Number(frame.rev) || 0;
		const remote = (frame.workspaces as DaemonWorkspace[]).map((ws) =>
			workspace(ws, (ws.projects ?? []).map(project))
		);
		this.#remoteKey = canonical(remote);
		// An empty daemon takes the desktop's list (push below). On the
		// first list after start, projects only the desktop has are kept and
		// sent, not closed: they were added while the two were apart.
		const target = first ? union(remote, this.local()) : remote;
		if (remote.length > 0 && canonical(this.local()) !== canonical(target)) this.#apply(target);
		this.push();
	}

	/** Sends the desktop's list when it differs from the daemon's. */
	push() {
		if (this.#rev < 0) return;
		const local = this.local();
		const key = canonical(local);
		if (key === this.#remoteKey) return;
		this.#remoteKey = key;
		daemon.request({ op: 'workspaces_set', rev: this.#rev, workspaces: local }).then(
			(reply) => this.handle(reply),
			() => {
				// Another client saved first; its broadcast brings the new list.
				this.#remoteKey = '';
			}
		);
	}

	#apply(remote: DaemonWorkspace[]) {
		for (const r of remote) {
			const local = this.workspaces.workspaces.find((w) => w.id === r.id);
			if (!local) {
				this.workspaces.adopt({
					id: r.id,
					name: r.name,
					projects: r.projects.map((p) => ({ ...p, tabs: [] })),
					layout: null,
					...(r.is_default ? { isDefault: true } : {})
				});
				continue;
			}
			if (local.name !== r.name) this.workspaces.rename(local.id, r.name);
			if (local.id === this.workspaces.activeId) this.#applyLive(r.projects);
			else this.workspaces.setProjects(local.id, merge(local.projects, r.projects));
		}
	}

	/** Brings the live project list in line with the daemon's. */
	#applyLive(projects: DaemonProject[]) {
		const byPath = new Map(projects.map((p) => [trim(p.path), p]));
		for (const p of [...this.store.projects]) {
			const r = byPath.get(trim(p.path));
			if (!r) this.store.removeProject(p);
			else if (p.name !== r.name) p.name = r.name;
		}
		for (const r of projects) {
			if (!this.store.projects.some((p) => trim(p.path) === trim(r.path))) this.store.addProjectShell(r);
		}
	}

	/** Brings the sidebar's sessions in line with the daemon's list. */
	reconcile(list: DaemonSessionView[]) {
		const bySid = new Map(
			this.store.allSessions.filter((s) => s.chat.sessionId).map((s) => [s.chat.sessionId, s])
		);
		const current = new Set(list.map((r) => r.session));
		// A new tab learns its id just after the daemon records it (drafts have
		// no daemon session yet).
		const opening = this.store.allSessions.some((s) => !s.draft && !s.chat.sessionId);
		for (const r of list) {
			if (r.agent) continue;
			const s = bySid.get(r.session);
			if (s) {
				if (r.title && r.title !== s.chat.title) s.chat.title = r.title;
				if (!!r.archived !== !!s.archived) s.archived = !!r.archived;
				// Not open here yet: it runs the way the daemon last ran it (a tab
				// saved without the flag would otherwise read as the official one).
				if (s.dormant && typeof r.gateway === 'boolean') s.gateway = r.gateway;
				continue;
			}
			if (daemon.desktopOf(r.session)) continue;
			if (opening && Date.now() - r.created_at < NEW_SESSION_GRACE_MS) continue;
			if (!LISTED_ENGINES.has(r.engine ?? 'jucode')) continue;
			const home = this.#projectFor(r.cwd);
			if (home) this.store.listDormant(home, r);
		}
		for (const s of this.store.allSessions) {
			const sid = s.chat.sessionId;
			if (sid && this.#seen.has(sid) && !current.has(sid)) this.store.forget(s.id);
		}
		this.#seen = current;
	}

	#projectFor(cwd: string): Project | undefined {
		return this.store.projects.find((p) => !p.stale && trim(p.path) === trim(cwd));
	}
}

/** An inactive workspace's saved projects after another client's change:
 *  known projects keep their tabs. */
function merge(saved: SavedProject[], remote: DaemonProject[]): SavedProject[] {
	return remote.map((r) => {
		const known = saved.find((p) => trim(p.path) === trim(r.path));
		return known ? { ...known, name: r.name } : { ...r, tabs: [] };
	});
}

/** The daemon's workspaces plus the projects only the desktop has. */
function union(remote: DaemonWorkspace[], local: DaemonWorkspace[]): DaemonWorkspace[] {
	return remote.map((r) => {
		const mine = local.find((w) => w.id === r.id);
		const extra = (mine?.projects ?? []).filter((p) => !r.projects.some((q) => trim(q.path) === trim(p.path)));
		return extra.length ? { ...r, projects: [...r.projects, ...extra] } : r;
	});
}
