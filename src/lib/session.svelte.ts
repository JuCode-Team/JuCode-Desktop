import { ChatState } from './chat.svelte';
import { sendOp, createSession, closeSession, projectRoot } from './protocol';
import type { Project } from './types';

// The persisted shape of a project + its open tabs (engine session id + title).
export interface SavedProject {
	id: string;
	name: string;
	path: string;
	tabs?: { sid: string; title: string }[];
}

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/**
 * Owns the project/session tree and its lifecycle (spawn, restore, restart,
 * remove) so the page is left with UI glue only. Reactive via Svelte 5 runes;
 * framework-free enough to unit-test by mocking `$lib/protocol`.
 */
export class SessionStore {
	projects = $state<Project[]>([]);
	activeId = $state('');
	loaded = $state(false);

	#counter = 0;
	uid() {
		return `s${Date.now().toString(36)}-${(this.#counter++).toString(36)}`;
	}

	get allSessions() {
		return this.projects.flatMap((p) => p.sessions);
	}
	get active() {
		return this.allSessions.find((s) => s.id === this.activeId);
	}
	get chat() {
		return this.active?.chat;
	}
	get activeProject() {
		return this.projects.find((p) => p.sessions.some((s) => s.id === this.activeId));
	}

	projectPathOf(id: string) {
		return this.projects.find((p) => p.sessions.some((s) => s.id === id))?.path;
	}

	#engineFailed(chat: ChatState, e: unknown) {
		chat.engineState = 'exited';
		chat.messages.push({ kind: 'error', text: `无法启动引擎：${e}` });
	}

	/** Spawn a fresh session in `project` and make it active. */
	addSession(project: Project) {
		const id = this.uid();
		const chat = new ChatState();
		project.sessions.push({ id, chat });
		this.activeId = id;
		createSession(id, project.path).catch((e) => this.#engineFailed(chat, e));
		return id;
	}

	/** Re-open a persisted conversation in a new session (resume by id). */
	restoreSession(project: Project, sid: string, title: string) {
		const id = this.uid();
		const chat = new ChatState();
		if (title) chat.title = title;
		project.sessions.push({ id, chat });
		createSession(id, project.path)
			.then(() => sendOp(id, { op: 'command', input: `/resume ${sid}` }))
			.catch((e) => this.#engineFailed(chat, e));
		return id;
	}

	/** Create a project from a directory path and seed its first session. */
	createProject(path: string) {
		const p: Project = { id: this.uid(), name: base(path), path, sessions: [] };
		this.projects.push(p);
		this.addSession(p);
		return p;
	}

	/**
	 * Re-spawn the engine for a session that exited, resuming its conversation if
	 * it had one. Auto-restart is capped at 3 within a 30s window to avoid crash
	 * loops; `force` (the manual button) resets the window.
	 */
	restartSession(id: string, force = false) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		const now = Date.now();
		if (force || s.chat.restartWindowStart == null || now - s.chat.restartWindowStart > 30000) {
			s.chat.restartWindowStart = now;
			s.chat.restarts = 0;
		}
		s.chat.restarts++;
		const sid = s.chat.sessionId;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({ kind: 'system', text: force ? '正在重启引擎…' : '引擎已退出，正在自动重启…' });
		createSession(id, this.projectPathOf(id))
			.then(() => {
				if (sid) sendOp(id, { op: 'command', input: `/resume ${sid}` });
			})
			.catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Handle an engine exit: mark exited and auto-restart unless we've already
	 *  retried 3× in the last 30s. */
	handleExit(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		s.chat.engineState = 'exited';
		const now = Date.now();
		const freshWindow = s.chat.restartWindowStart == null || now - s.chat.restartWindowStart > 30000;
		if (freshWindow || s.chat.restarts < 3) {
			this.restartSession(id);
		} else {
			s.chat.messages.push({ kind: 'error', text: '引擎多次退出，已暂停自动重启。点「重启引擎」重试。' });
		}
	}

	removeSession(id: string) {
		closeSession(id).catch(() => {});
		const p = this.projects.find((pr) => pr.sessions.some((s) => s.id === id));
		if (p) p.sessions = p.sessions.filter((s) => s.id !== id);
		if (this.activeId === id) this.activeId = this.allSessions[0]?.id ?? '';
	}

	/** Tear down a project and all its sessions (the page handles confirmation). */
	removeProject(p: Project) {
		for (const s of p.sessions) closeSession(s.id).catch(() => {});
		this.projects = this.projects.filter((x) => x.id !== p.id);
		if (!this.allSessions.some((s) => s.id === this.activeId)) this.activeId = this.allSessions[0]?.id ?? '';
	}

	/** Open the project's history picker (/resume with no arg). */
	openHistory(p: Project) {
		const id = p.sessions[0]?.id ?? this.addSession(p);
		this.activeId = id;
		sendOp(id, { op: 'command', input: '/resume' });
	}

	/** Snapshot of the layout + open tabs for persistence. */
	serialize(): SavedProject[] {
		return this.projects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			tabs: p.sessions
				.map((s) => ({ sid: s.chat.sessionId, title: s.chat.title }))
				.filter((t) => t.sid)
		}));
	}

	/** Restore saved projects + their open conversations, or seed a default
	 *  project on first run. Sets `loaded` when done. */
	async restore(saved: SavedProject[]) {
		let first = '';
		if (saved.length) {
			for (const p of saved) {
				const proj: Project = { id: p.id, name: p.name, path: p.path, sessions: [] };
				this.projects.push(proj);
				for (const t of p.tabs ?? []) {
					if (!t.sid) continue;
					const id = this.restoreSession(proj, t.sid, t.title);
					if (!first) first = id;
				}
			}
			this.activeId = first || (this.projects[0] && this.addSession(this.projects[0])) || '';
		} else {
			const root = await projectRoot();
			this.projects.push({ id: this.uid(), name: base(root), path: root, sessions: [] });
			this.addSession(this.projects[0]);
		}
		this.loaded = true;
	}
}
