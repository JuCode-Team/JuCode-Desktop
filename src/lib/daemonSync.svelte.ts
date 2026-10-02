// Keeps the desktop and the daemon on one set of workspaces, projects and
// sessions (JuCode-CLI docs/daemon-protocol.md): the daemon is the source,
// every client follows it, and the desktop's own edits go to it.
//
// - Workspaces and projects: the desktop's list is sent with `workspaces_set`
//   whenever it differs from the daemon's. A `workspaces` frame brings over
//   what changed since the daemon's previous list (projects added, removed or
//   renamed elsewhere); what the desktop changed meanwhile stays and is sent.
//   The first list of a connection only adds: an empty daemon takes the
//   desktop's list, and one that knows fewer projects (a new daemon, a lost
//   file) never closes the desktop's.
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
import { normalizeColor, parseTabIcon, type TabIcon } from '$lib/workbench/tabChrome';

interface DaemonProject {
	id: string;
	name: string;
	path: string;
	chats?: boolean;
	worktree?: WorktreeMeta;
	color?: string;
	icon?: TabIcon;
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

/** Folder chrome is checked on the way in and out: the daemon keeps it as
 *  any client sent it. */
function project(p: {
	id: string;
	name: string;
	path: string;
	chats?: boolean;
	worktree?: WorktreeMeta;
	color?: unknown;
	icon?: unknown;
}): DaemonProject {
	const color = normalizeColor(p.color);
	const icon = parseTabIcon(p.icon);
	return {
		id: p.id,
		name: p.name,
		path: p.path,
		...(p.chats ? { chats: true } : {}),
		...(p.worktree ? { worktree: p.worktree } : {}),
		...(color ? { color } : {}),
		...(icon ? { icon } : {})
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
	/** The daemon's last list on this connection; null before its first. */
	#base: DaemonWorkspace[] | null = null;
	/** A list that arrived before the desktop's own was restored. */
	#held: Record<string, unknown> | null = null;
	/** Session ids the last daemon list on this connection had. */
	#seen = new Set<string>();

	/** `ready`: the desktop's project tree is restored and not being swapped
	 *  (a list applied before would be merged with an empty tree). */
	constructor(
		private store: SessionStore,
		private workspaces: WorkspaceStore,
		private ready: () => boolean = () => true
	) {}

	/** The connection dropped: the next daemon may be another one, so its
	 *  first list is merged as at start and its session list compared afresh. */
	reset() {
		this.#rev = -1;
		this.#remoteKey = '';
		this.#base = null;
		this.#held = null;
		this.#seen = new Set();
	}

	/** Applies the list held while the desktop was not ready. */
	flush() {
		const frame = this.#held;
		this.#held = null;
		if (frame) this.handle(frame);
	}

	/** The desktop's list, shaped as the daemon keeps it; the active
	 *  workspace's projects come from the live session tree. */
	local(): DaemonWorkspace[] {
		return this.workspaces.workspaces.map((ws) =>
			workspace(
				ws,
				(ws.id === this.workspaces.activeId ? this.store.userProjects : ws.projects).map(project)
			)
		);
	}

	/** Daemon-wide frames (wired to `daemon.onEvent`). */
	handle(frame: Record<string, unknown>) {
		if (frame.type !== 'workspaces' || !Array.isArray(frame.workspaces)) return;
		if (!this.ready()) {
			this.#held = frame;
			return;
		}
		this.#rev = Number(frame.rev) || 0;
		const remote = (frame.workspaces as DaemonWorkspace[]).map((ws) =>
			workspace(ws, (ws.projects ?? []).map(project))
		);
		this.#remoteKey = canonical(remote);
		const base = this.#base;
		this.#base = remote;
		// An empty daemon takes the desktop's list (push below). The first
		// list of a connection keeps and sends the projects only the desktop
		// has: they were added while the two were apart.
		const local = this.local();
		const target = base ? rebase(local, base, remote) : union(remote, local);
		if (remote.length > 0 && canonical(local) !== canonical(target)) this.#apply(target);
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
		for (const p of [...this.store.userProjects]) {
			const r = byPath.get(trim(p.path));
			if (!r) {
				this.store.removeProject(p);
				continue;
			}
			if (p.name !== r.name) p.name = r.name;
			this.store.setProjectChrome(p, { color: r.color ?? null, icon: r.icon ?? null });
		}
		for (const r of projects) {
			if (!this.store.userProjects.some((p) => trim(p.path) === trim(r.path))) this.store.addProjectShell(r);
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
			const s = bySid.get(r.session);
			// An agent's session opens on the workbench, never listed here; an
			// open one still follows the daemon's title.
			if (r.agent) {
				if (s && r.title && r.title !== s.chat.title) s.chat.title = r.title;
				continue;
			}
			if (s) {
				if (r.title && r.title !== s.chat.title) s.chat.title = r.title;
				if (!!r.archived !== !!s.archived) s.archived = !!r.archived;
				if ((r.group || undefined) !== s.group) s.group = r.group || undefined;
				// Not open here yet: it runs the way the daemon last ran it (a tab
				// saved without the flag would otherwise read as the official one).
				if (s.dormant && typeof r.gateway === 'boolean') s.gateway = r.gateway;
				continue;
			}
			if (daemon.desktopOf(r.session)) continue;
			if (opening && Date.now() - r.created_at < NEW_SESSION_GRACE_MS) continue;
			if (!LISTED_ENGINES.has(r.engine ?? 'jucode')) continue;
			const home = this.#projectFor(r.cwd);
			// At the start, with the project's newest: it came from elsewhere just now.
			if (home) this.store.listDormant(home, r, undefined, true);
		}
		for (const s of this.store.allSessions) {
			const sid = s.chat.sessionId;
			if (sid && this.#seen.has(sid) && !current.has(sid)) this.store.forget(s.id);
		}
		this.#seen = current;
	}

	#projectFor(cwd: string): Project | undefined {
		return this.store.userProjects.find((p) => !p.stale && trim(p.path) === trim(cwd));
	}
}

/** An inactive workspace's saved projects after another client's change:
 *  known projects keep their tabs. */
function merge(saved: SavedProject[], remote: DaemonProject[]): SavedProject[] {
	return remote.map((r) => {
		const known = saved.find((p) => trim(p.path) === trim(r.path));
		return known ? { ...known, name: r.name, color: r.color, icon: r.icon } : { ...r, tabs: [] };
	});
}

const projectKey = (p: DaemonProject) => trim(p.path);

/** The daemon's workspaces with the desktop's changes kept: of the projects
 *  the two disagree on, the ones the daemon added or removed since `base`
 *  follow it, the rest stay as the desktop has them (its own edits, maybe
 *  not sent yet, or sent and not echoed back yet). */
function rebase(local: DaemonWorkspace[], base: DaemonWorkspace[], remote: DaemonWorkspace[]): DaemonWorkspace[] {
	return remote.map((r) => {
		const mine = local.find((w) => w.id === r.id);
		const was = base.find((w) => w.id === r.id);
		if (!mine) return r;
		if (!was) return union([r], [mine])[0];
		const keys = (list: DaemonProject[]) => new Map(list.map((p) => [projectKey(p), p]));
		const theirs = keys(r.projects);
		const before = keys(was.projects);
		const ours = keys(mine.projects);
		const kept = mine.projects
			.filter((p) => theirs.has(projectKey(p)) || !before.has(projectKey(p)))
			.map((p) => {
				const now = theirs.get(projectKey(p));
				const then = before.get(projectKey(p));
				// Changed elsewhere (a rename, new chrome): theirs; else ours.
				return now && then && canonical(now) !== canonical(then) ? now : p;
			});
		const added = r.projects.filter((p) => !ours.has(projectKey(p)) && !before.has(projectKey(p)));
		return { ...r, projects: [...kept, ...added] };
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
