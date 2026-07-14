import { ChatState } from './chat.svelte';
import { createSession, closeSession, projectRoot, writeConfig, git, claudeSessionTranscript } from './protocol';
import { createAdapter, normalizeBackendId, type BackendId } from './backends';
import { dispatch, ioFor, registerAdapter, unregisterAdapter } from './backends/router';
import { buildBackendOpts, defaultBackendFor } from './backends/settings';
import { t } from '$lib/i18n';
import type { Project, Session, WorktreeMeta } from './types';

// The persisted shape of a project + its open tabs (engine session id + title).
export interface SavedProject {
	id: string;
	name: string;
	path: string;
	tabs?: { sid: string; title: string; backend?: string }[];
	/** 并行任务 worktree 项目的元数据（isWorktree/mainRepoPath/branch/baseBranch/slug）。 */
	worktree?: WorktreeMeta;
	/** 本项目最近一次新建会话所用的引擎后端（缺省 = jucode）。 */
	lastBackend?: string;
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
		chat.messages.push({ kind: 'error', text: t('shell.startFail', { msg: String(e) }) });
	}

	/** Builds a session record (chat + per-session adapter) and registers the
	 *  adapter with the op router. */
	#newSession(backendId: BackendId): Session {
		const id = this.uid();
		const chat = new ChatState();
		chat.backendId = backendId;
		const adapter = createAdapter(backendId);
		registerAdapter(id, adapter);
		return { id, chat, backendId, adapter };
	}

	/** Spawns the engine child for `s`, invokes the adapter's onStart hook once
	 *  it is up (initial spawn and every restart alike), then runs `after` in
	 *  the same continuation (so a first message follows the handshake without
	 *  an extra microtask hop). The plain jucode call stays exactly the
	 *  historical two-argument createSession (byte-for-byte default behavior);
	 *  other backends (or a configured bin override) pass backend + opts.
	 *  `extraOpts` adds per-spawn options on top of the settings-derived ones
	 *  (e.g. claude's allowlisted `resume` session id). `resume` instead rides
	 *  the SessionCtx into the adapter, for backends whose resume is a protocol
	 *  call after the handshake rather than a spawn flag (codex thread/resume). */
	#spawn(
		s: Session,
		cwd: string | undefined,
		after?: () => void,
		extraOpts?: Record<string, unknown>,
		resume?: string
	) {
		const base = buildBackendOpts(s.backendId);
		const opts = extraOpts ? { ...(base ?? {}), ...extraOpts } : base;
		const spawned =
			s.backendId === 'jucode' && !opts
				? createSession(s.id, cwd)
				: createSession(s.id, cwd, s.backendId, opts ?? {});
		return spawned.then(() => {
			// The child is up and its stdout is being pumped — let the adapter
			// send handshake frames / reset per-process state before any op flows.
			s.adapter.onStart(ioFor(s.id), {
				cwd: cwd ?? '',
				approvalMode: s.chat.approvalMode,
				sessionId: s.id,
				...(resume ? { resume } : {})
			});
			after?.();
		});
	}

	/** Spawn a fresh session in `project` and make it active. `firstMessage`
	 *  (e.g. a parallel task's 任务描述) is sent as the opening user turn once
	 *  the engine is up. `backend` overrides the project's last-used backend
	 *  (which itself falls back to the settings default). */
	addSession(project: Project, firstMessage?: string, backend?: BackendId) {
		const backendId = backend ?? defaultBackendFor(project.lastBackend);
		const s = this.#newSession(backendId);
		project.sessions.push(s);
		project.lastBackend = backendId;
		this.activeId = s.id;
		this.#spawn(s, project.path, () => {
			if (firstMessage) {
				s.chat.optimisticUser(firstMessage);
				dispatch(s.id, { op: 'user_message', content: firstMessage });
			}
		}).catch((e) => this.#engineFailed(s.chat, e));
		return s.id;
	}

	/** Re-open a persisted conversation in a new session (resume by id).
	 *  jucode resumes via the `/resume` command; claude has no such command in
	 *  stream-json mode and resumes via the allowlisted `--resume` spawn option
	 *  instead, replaying the transcript from the session file on disk (the
	 *  engine-side context is preserved by --resume regardless);
	 *  codex resumes via the thread/resume RPC after the handshake (the thread
	 *  id rides the SessionCtx, and the response replays the transcript). */
	restoreSession(project: Project, sid: string, title: string, backend: BackendId = 'jucode') {
		const s = this.#newSession(backend);
		if (title) s.chat.title = title;
		project.sessions.push(s);
		if (backend === 'claude' || backend === 'codex') s.chat.sessionId = sid;
		const spawned =
			backend === 'claude'
				? this.#spawn(s, project.path, () => this.#replayClaudeTranscript(s, project.path, sid), {
						resume: sid
					})
				: backend === 'codex'
					? this.#spawn(s, project.path, undefined, undefined, sid)
					: this.#spawn(s, project.path, () => dispatch(s.id, { op: 'command', input: `/resume ${sid}` }));
		spawned.catch((e) => this.#engineFailed(s.chat, e));
		return s.id;
	}

	/** Best-effort transcript replay for a resumed claude session: the session
	 *  file's user/assistant text becomes the message list (caps.transcriptReplay).
	 *  Failures are silent — `--resume` already restored the engine-side context,
	 *  the chat just starts visually empty. Only restores replay (crash
	 *  auto-restarts keep their in-memory messages). */
	#replayClaudeTranscript(s: Session, cwd: string, sid: string) {
		claudeSessionTranscript(cwd, sid)
			.then((rows) => {
				if (!rows?.length || s.chat.messages.some((m) => m.kind === 'user')) return;
				s.chat.handle({ type: 'transcript', items: rows });
			})
			.catch(() => {});
	}

	/** Create a project from a directory path and seed its first session.
	 *  Worktree metadata marks it as a parallel-task project; `firstMessage`
	 *  opens the seeded session with that user turn. */
	createProject(path: string, worktree?: WorktreeMeta, firstMessage?: string) {
		const p: Project = { id: this.uid(), name: base(path), path, sessions: [] };
		if (worktree) p.worktree = worktree;
		this.projects.push(p);
		this.addSession(p, firstMessage);
		return p;
	}

	/**
	 * Re-spawn the engine for a session that exited, resuming its conversation if
	 * it had one. Auto-restart is capped at 3 consecutive crashes to avoid crash
	 * loops; the counter is reset by a healthy engine `status` event (see
	 * ChatState.handle) — i.e. only after a restart genuinely succeeds — and by
	 * `force` (the manual button), which clears the budget so the user can retry.
	 */
	restartSession(id: string, force = false) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		const now = Date.now();
		if (force) {
			s.chat.restarts = 0;
		}
		s.chat.restartWindowStart = now;
		s.chat.restarts++;
		const sid = s.chat.sessionId;
		const canResume = s.chat.resumable;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({ kind: 'system', text: force ? t('shell.restarting') : t('shell.autoRestarting') });
		// claude resumes via the --resume spawn option (no /resume command in
		// stream-json mode); codex resumes via the thread/resume RPC (thread id
		// through SessionCtx); jucode resumes with the command after the handshake.
		const resumeViaSpawn = s.backendId === 'claude' && sid && canResume;
		const resumeViaCtx = s.backendId === 'codex' && sid && canResume;
		this.#spawn(
			s,
			this.projectPathOf(id),
			() => {
				if (sid && canResume && s.backendId === 'jucode')
					dispatch(id, { op: 'command', input: `/resume ${sid}` });
			},
			resumeViaSpawn ? { resume: sid } : undefined,
			resumeViaCtx ? sid : undefined
		).catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Handle an engine exit: mark exited and auto-restart unless we've already
	 *  retried 3× in a row without the engine coming back healthy. The counter is
	 *  reset by a healthy `status` event, so a restart that actually recovers frees
	 *  the budget again; a run of crashes without recovery exhausts it. */
	handleExit(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		// Intentional close for a provider switch — switchProvider re-creates the
		// engine itself, so don't treat this exit as a crash.
		if (s.chat.switching) {
			s.chat.switching = false;
			return;
		}
		s.chat.engineState = 'exited';
		if (s.chat.restarts < 3) {
			this.restartSession(id);
		} else {
			s.chat.messages.push({ kind: 'error', text: t('shell.restartExhausted') });
		}
	}

	/**
	 * Switch a running session to a different provider's model. The engine has one
	 * active provider per session and can't change it at runtime, so we rewrite the
	 * global config and restart the engine, resuming the conversation. (Switching a
	 * model *within* the current provider uses /model instead — instant, no restart.)
	 */
	async switchProvider(
		id: string,
		provider: { id: string; base_url: string; format: string; models: { name: string; reasoning_efforts?: string[] }[] },
		model: string
	) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		const efforts = provider.models.find((m) => m.name === model)?.reasoning_efforts ?? [];
		const patch: Record<string, unknown> = {
			provider: provider.id,
			base_url: provider.base_url,
			protocol: provider.format,
			models: provider.models,
			model
		};
		if (efforts.length) patch.reasoning_effort = efforts.includes('medium') ? 'medium' : efforts[0];
		try {
			await writeConfig(patch);
		} catch (e) {
			this.#engineFailed(s.chat, e);
			return;
		}
		const sid = s.chat.sessionId;
		const canResume = s.chat.resumable;
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({ kind: 'system', text: t('shell.switchingTo', { provider: provider.id, model }) });
		try {
			await closeSession(id);
			await this.#spawn(s, this.projectPathOf(id));
			if (sid && canResume) dispatch(id, { op: 'command', input: `/resume ${sid}` });
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	/**
	 * Switch a claude session INTO yolo (bypassPermissions) via a respawn: the
	 * runtime `set_permission_mode bypassPermissions` control frame isn't honored
	 * (no system/status follow-up), so we restart the child with
	 * `--permission-mode bypassPermissions`, resuming the conversation with
	 * `--resume <session-id>` when there is one to preserve context. Every other
	 * mode switches live and never comes here (see approval.needsClaudeYoloRespawn).
	 */
	async respawnClaudeYolo(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.backendId !== 'claude') return;
		const sid = s.chat.sessionId;
		const canResume = s.chat.resumable;
		// The close below is intentional — don't let handleExit treat it as a crash.
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		try {
			await closeSession(id);
			await this.#spawn(s, this.projectPathOf(id), undefined, {
				permission_mode: 'bypassPermissions',
				...(sid && canResume ? { resume: sid } : {})
			});
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	removeSession(id: string) {
		closeSession(id).catch(() => {});
		unregisterAdapter(id);
		const p = this.projects.find((pr) => pr.sessions.some((s) => s.id === id));
		if (p) p.sessions = p.sessions.filter((s) => s.id !== id);
		if (this.activeId === id) this.activeId = this.allSessions[0]?.id ?? '';
	}

	/** Tear down a project and all its sessions (the page handles confirmation). */
	removeProject(p: Project) {
		for (const s of p.sessions) {
			closeSession(s.id).catch(() => {});
			unregisterAdapter(s.id);
		}
		this.projects = this.projects.filter((x) => x.id !== p.id);
		if (!this.allSessions.some((s) => s.id === this.activeId)) this.activeId = this.allSessions[0]?.id ?? '';
	}

	/** Open the project's history picker (/resume with no arg). History is a
	 *  jucode-engine feature, so prefer a live jucode session (or spawn one). */
	openHistory(p: Project) {
		const id = p.sessions.find((s) => s.backendId === 'jucode')?.id ?? this.addSession(p, undefined, 'jucode');
		this.activeId = id;
		dispatch(id, { op: 'command', input: '/resume' });
	}

	/** Snapshot of the layout + open tabs for persistence. The backend id is
	 *  only written when it isn't the default, so pre-existing layouts stay
	 *  byte-identical. */
	serialize(): SavedProject[] {
		return this.projects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			...(p.worktree ? { worktree: p.worktree } : {}),
			...(p.lastBackend && p.lastBackend !== 'jucode' ? { lastBackend: p.lastBackend } : {}),
			tabs: p.sessions
				.filter((s) => s.chat.resumable)
				.map((s) => ({
					sid: s.chat.sessionId,
					title: s.chat.title,
					...(s.backendId !== 'jucode' ? { backend: s.backendId } : {})
				}))
		}));
	}

	/** Restore saved projects + their open conversations, or seed a default
	 *  project on first run. Sets `loaded` when done. A worktree project whose
	 *  directory has vanished (task finished elsewhere / dir deleted) is kept in
	 *  the list as `stale` — no sessions are spawned into a dead cwd — so the
	 *  sidebar can offer a remove-from-list affordance instead of crashing. */
	async restore(saved: SavedProject[]) {
		let first = '';
		if (saved.length) {
			for (const p of saved) {
				const proj: Project = { id: p.id, name: p.name, path: p.path, sessions: [] };
				if (p.lastBackend) proj.lastBackend = normalizeBackendId(p.lastBackend);
				if (p.worktree) {
					proj.worktree = p.worktree;
					try {
						await git(['rev-parse', '--show-toplevel'], p.path);
					} catch {
						proj.stale = true;
					}
				}
				this.projects.push(proj);
				if (proj.stale) continue;
				for (const t of p.tabs ?? []) {
					if (!t.sid) continue;
					// Tabs saved before multi-backend support carry no backend field →
					// jucode (normalizeBackendId maps unknown/missing to the default).
					const id = this.restoreSession(proj, t.sid, t.title, normalizeBackendId(t.backend));
					if (!first) first = id;
				}
			}
			const firstLive = this.projects.find((p) => !p.stale);
			this.activeId = first || (firstLive && this.addSession(firstLive)) || '';
		} else {
			const root = await projectRoot();
			this.projects.push({ id: this.uid(), name: base(root), path: root, sessions: [] });
			this.addSession(this.projects[0]);
		}
		this.loaded = true;
	}
}
