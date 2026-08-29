import { tick } from 'svelte';
import { ChatState } from './chat.svelte';
import { createSession, closeSession, projectRoot, writeConfig, git, claudeSessionTranscript } from './protocol';
import { canHandOffToTui, isValidResumeSessionId } from './tuiHandoff';
import { createAdapter, normalizeBackendId, type BackendId } from './backends';
import { dispatch, ioFor, registerAdapter, unregisterAdapter } from './backends/router';
import { buildBackendOpts, defaultBackendFor } from './backends/settings';
import { needsClaudeYoloRespawn, toEngineMode } from './approval';
import { toClaudeMode } from './backends/claude';
import { t } from '$lib/i18n';
import { normalizeColor, parseTabIcon, type TabIcon } from './workbench/tabChrome';
import type { Project, Session, WorktreeMeta } from './types';

/** Optional per-tab chrome persisted alongside the session id + title. */
export interface SavedTabChrome {
	color?: string;
	icon?: TabIcon;
	/** The title was set by an explicit rename (auto-titling stays off). */
	titleLocked?: boolean;
}

// The persisted shape of a project + its open tabs. `id` is the desktop
// session id (stable across restore so layout chat tiles keep matching);
// `sid` is the engine conversation to resume, present only when the engine
// actually persisted one.
export interface SavedProject {
	id: string;
	name: string;
	path: string;
	tabs?: ({
		id?: string;
		sid?: string;
		title: string;
		backend?: string;
		/** backend 为 'acp' 时：驱动该会话的 registry agent（重启动/恢复时必需）。 */
		acpAgent?: { id: string; name: string };
		archived?: boolean;
		/** The conversation was handed to the native TUI (resume by `sid`).
		 *  Omitted for the default GUI surface so old layouts stay clean. */
		surface?: 'tui';
	} & SavedTabChrome)[];
	/** 并行任务 worktree 项目的元数据（isWorktree/mainRepoPath/branch/baseBranch/slug）。 */
	worktree?: WorktreeMeta;
	/** 本项目最近一次新建会话所用的引擎后端（缺省 = jucode）。 */
	lastBackend?: string;
	/** lastBackend 为 'acp' 时：上次选择的 ACP agent。 */
	lastAcpAgent?: { id: string; name: string };
}

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/** A v4-ish UUID for claude's --session-id (falls back if crypto is unavailable). */
function newUuid(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
		});
	}
}

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
	 *  adapter with the op router. `acpAgent` (acp backend only) records which
	 *  registry agent backs the session, for spawn opts and display. `reuseId`
	 *  re-applies a persisted desktop id (layout chat tiles key on it) unless
	 *  this run already spawned it. */
	#newSession(backendId: BackendId, acpAgent?: { id: string; name: string }, reuseId?: string): Session {
		const id = reuseId && !this.allSessions.some((s) => s.id === reuseId) ? reuseId : this.uid();
		const chat = new ChatState();
		chat.backendId = backendId;
		if (acpAgent) {
			chat.acpAgentId = acpAgent.id;
			chat.acpAgentName = acpAgent.name;
		}
		const adapter = createAdapter(backendId);
		registerAdapter(id, adapter);
		return { id, chat, backendId, adapter, ...(acpAgent ? { acpAgent } : {}) };
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
		// ACP sessions always pass their registry agent id (initial spawn and
		// every crash auto-restart alike) — the Rust side looks the command up.
		const agentOpt = s.backendId === 'acp' && s.acpAgent ? { agent: s.acpAgent.id } : undefined;
		const opts =
			agentOpt || extraOpts ? { ...(base ?? {}), ...(agentOpt ?? {}), ...(extraOpts ?? {}) } : base;
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
	 *  (which itself falls back to the settings default). `acpAgent` picks the
	 *  registry agent for 'acp' sessions (defaults to the project's last one;
	 *  without any, the session falls back to the native engine). */
	addSession(
		project: Project,
		firstMessage?: string,
		backend?: BackendId,
		acpAgent?: { id: string; name: string }
	) {
		let backendId = backend ?? defaultBackendFor(project.lastBackend);
		let agent = backendId === 'acp' ? (acpAgent ?? project.lastAcpAgent) : undefined;
		if (backendId === 'acp' && !agent) {
			backendId = 'jucode'; // no agent to launch — never spawn a bare 'acp'
			agent = undefined;
		}
		const s = this.#newSession(backendId, agent);
		project.sessions.push(s);
		project.lastBackend = backendId;
		if (backendId === 'acp' && agent) project.lastAcpAgent = agent;
		this.activeId = s.id;
		// Pin a session id we control for claude (via --session-id) so the
		// conversation persists under a known uuid and --resume can restore its
		// context after a crash/restart — the CLI's own auto-generated id isn't
		// reliably resumable in gateway setups ("No conversation found").
		const extra = backendId === 'claude' ? { session_id: newUuid() } : undefined;
		if (extra) s.chat.sessionId = extra.session_id;
		this.#spawn(s, project.path, () => {
			if (firstMessage) {
				s.chat.optimisticUser(firstMessage);
				dispatch(s.id, { op: 'user_message', content: firstMessage });
			}
		}, extra).catch((e) => this.#engineFailed(s.chat, e));
		return s.id;
	}

	/**
	 * Switch a fresh session (no user turn yet) to a different engine backend,
	 * in place: same tab, same session id. There is no conversation to carry
	 * over, so the old engine is torn down and a new adapter + child is brought
	 * up; ChatState is rebuilt because everything it holds is engine-specific
	 * (model catalog, commands, session id…). No-op once the first user message
	 * has been sent — the conversation can't move engines.
	 */
	async switchBackend(id: string, backend: BackendId, acpAgent?: { id: string; name: string }) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (s.backendId === backend && (backend !== 'acp' || s.acpAgent?.id === acpAgent?.id)) return;
		if (s.chat.userTurns > 0 || s.restored) return;
		if (backend === 'acp' && !acpAgent) return; // nothing to launch
		const project = this.projects.find((pr) => pr.sessions.some((x) => x.id === id));
		// Swap the projection + adapter BEFORE the old child exits, so the exit
		// event lands on the new ChatState with `switching` set and isn't treated
		// as a crash to auto-restart (handleExit resolves chat via the session).
		const chat = new ChatState();
		chat.backendId = backend;
		chat.switching = true;
		unregisterAdapter(id);
		const adapter = createAdapter(backend);
		registerAdapter(id, adapter);
		s.chat = chat;
		s.backendId = backend;
		s.adapter = adapter;
		if (backend === 'acp' && acpAgent) {
			s.acpAgent = acpAgent;
			chat.acpAgentId = acpAgent.id;
			chat.acpAgentName = acpAgent.name;
			if (project) project.lastAcpAgent = acpAgent;
		} else {
			s.acpAgent = undefined;
		}
		if (project) project.lastBackend = backend;
		try {
			await closeSession(id);
		} catch {
			/* old child may already be gone */
		}
		// Same rationale as addSession: pin a resumable uuid for claude.
		const extra = backend === 'claude' ? { session_id: newUuid() } : undefined;
		if (extra) chat.sessionId = extra.session_id;
		try {
			await this.#spawn(s, project?.path, undefined, extra);
		} catch (e) {
			this.#engineFailed(chat, e);
		}
	}

	/** Archive a thread: hide it from the sidebar by default without closing or
	 *  deleting it. If it was active, move focus to a live non-archived sibling. */
	archiveSession(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		s.archived = true;
		if (this.activeId === id) {
			const next =
				this.activeProject?.sessions.find((x) => x.id !== id && !x.archived) ??
				this.allSessions.find((x) => x.id !== id && !x.archived);
			this.activeId = next?.id ?? '';
		}
	}

	/** Restore an archived thread to the normal list. */
	unarchiveSession(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (s) s.archived = false;
	}

	/** Explicit rename: sets the title and locks out auto-titling. */
	renameSession(id: string, title: string) {
		const s = this.allSessions.find((x) => x.id === id);
		const trimmed = title.trim();
		if (!s || !trimmed) return;
		s.chat.title = trimmed;
		s.chat.titleLocked = true;
	}

	/** Set or clear a session's tag color / tab icon (null clears). */
	setSessionChrome(id: string, chrome: { color?: string | null; icon?: TabIcon | null }) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (chrome.color !== undefined) {
			s.color = chrome.color === null ? undefined : normalizeColor(chrome.color);
		}
		if (chrome.icon !== undefined) {
			s.icon = chrome.icon === null ? undefined : parseTabIcon(chrome.icon);
		}
	}

	/** Re-open a persisted conversation in a new session (resume by id).
	 *  jucode resumes via the `/resume` command; claude has no such command in
	 *  stream-json mode and resumes via the allowlisted `--resume` spawn option
	 *  instead, replaying the transcript from the session file on disk (the
	 *  engine-side context is preserved by --resume regardless);
	 *  codex resumes via the thread/resume RPC after the handshake (the thread
	 *  id rides the SessionCtx, and the response replays the transcript). */
	restoreSession(
		project: Project,
		sid: string,
		title: string,
		backend: BackendId = 'jucode',
		archived = false,
		chrome?: SavedTabChrome,
		reuseId?: string,
		acpAgent?: { id: string; name: string },
		surface?: 'tui'
	) {
		const s = this.#newSession(backend, backend === 'acp' ? acpAgent : undefined, reuseId);
		if (title) s.chat.title = title;
		s.archived = archived;
		if (chrome?.color) s.color = chrome.color;
		if (chrome?.icon) s.icon = chrome.icon;
		if (chrome?.titleLocked) s.chat.titleLocked = true;
		// The engine resumes persisted context — the backend can't be switched
		// even while the replayed transcript is still empty.
		s.restored = true;
		project.sessions.push(s);
		if (backend === 'claude' || backend === 'codex') s.chat.sessionId = sid;
		// The conversation was handed to the native TUI when it was persisted:
		// render the TuiPanel (which resumes by id) and never spawn the GUI
		// engine beside it — one process per conversation. `returnToGui`
		// respawns the engine with resume later.
		if (surface === 'tui' && canHandOffToTui(backend)) {
			s.surface = 'tui';
			s.chat.sessionId = sid;
			return s.id;
		}
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

	/** Spawn a fresh session for a persisted tab that has no engine
	 *  conversation to resume (never sent a turn), reusing the saved desktop
	 *  id so layout chat tiles keep matching across workspace switches. */
	#spawnSaved(
		project: Project,
		reuseId: string,
		title: string,
		backend: BackendId = 'jucode',
		archived = false,
		chrome?: SavedTabChrome,
		acpAgent?: { id: string; name: string }
	) {
		const s = this.#newSession(backend, backend === 'acp' ? acpAgent : undefined, reuseId);
		if (title) s.chat.title = title;
		s.archived = archived;
		if (chrome?.color) s.color = chrome.color;
		if (chrome?.icon) s.icon = chrome.icon;
		if (chrome?.titleLocked) s.chat.titleLocked = true;
		project.sessions.push(s);
		// Same rationale as addSession: pin a resumable uuid for claude.
		const extra = backend === 'claude' ? { session_id: newUuid() } : undefined;
		if (extra) s.chat.sessionId = extra.session_id;
		this.#spawn(s, project.path, undefined, extra).catch((e) => this.#engineFailed(s.chat, e));
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
		// A restored session's conversation exists engine-side even while its
		// replayed transcript is still empty (replay is async / best-effort) —
		// the same rule serialize uses to decide a tab is resumable.
		const canResume = s.chat.resumable || (!!sid && !!s.restored);
		s.chat.engineState = 'connecting';
		s.chat.messages.push({ kind: 'system', text: force ? t('shell.restarting') : t('shell.autoRestarting') });
		// claude resumes via the --resume spawn option (no /resume command in
		// stream-json mode); codex resumes via the thread/resume RPC (thread id
		// through SessionCtx); jucode resumes with the command after the handshake.
		// A resume target the engine can't find ("No conversation found …") makes it
		// exit immediately, which would crash-loop forever re-resuming the same
		// doomed id (the bootstrap 'ready' keeps resetting the restart budget). When
		// the adapter flagged a resume failure, come up fresh instead. One-shot: the
		// fresh session gets a new id that CAN be resumed on a later crash.
		const mayResume = sid && canResume && !s.chat.resumeBroken;
		s.chat.resumeBroken = false;
		const resumeViaSpawn = s.backendId === 'claude' && mayResume;
		const resumeViaCtx = s.backendId === 'codex' && mayResume;
		// Preserve claude's permission mode across the restart so yolo
		// (--dangerously-skip-permissions) survives an auto-restart — otherwise the
		// engine comes up in default mode while the desktop still thinks it's yolo.
		const extra: Record<string, unknown> = {};
		if (resumeViaSpawn) extra.resume = sid;
		if (s.backendId === 'claude') extra.permission_mode = toClaudeMode(toEngineMode(s.chat.approvalMode));
		this.#spawn(
			s,
			this.projectPathOf(id),
			() => {
				if (sid && canResume && s.backendId === 'jucode')
					dispatch(id, { op: 'command', input: `/resume ${sid}` });
			},
			Object.keys(extra).length ? extra : undefined,
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
		model: string,
		/** Explicit effort pick (popover chip); must be one of the model's efforts. */
		effort?: string
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
		if (effort && efforts.includes(effort)) patch.reasoning_effort = effort;
		else if (efforts.length) patch.reasoning_effort = efforts.includes('medium') ? 'medium' : efforts[0];
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

	/**
	 * Rewind a claude conversation to the `userIndex`-th user turn. claude has no
	 * live rewind control frame, so — mirroring the yolo respawn — we restart the
	 * child resuming the session truncated at the previous turn's assistant message
	 * (`--resume <sid> --resume-session-at <uuid>`, the same argv the Agent SDK
	 * builds), and truncate our projected transcript to match. A null uuid (rewind
	 * to the first turn) restarts the session fresh.
	 */
	async rewindClaudeSession(id: string, resumeAtUuid: string | null, userIndex: number) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.backendId !== 'claude') return;
		const sid = s.chat.sessionId;
		const yolo = needsClaudeYoloRespawn('claude', toEngineMode(s.chat.approvalMode));
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.truncateToUserTurn(userIndex);
		try {
			await closeSession(id);
			await this.#spawn(s, this.projectPathOf(id), undefined, {
				...(sid && resumeAtUuid ? { resume: sid, resume_session_at: resumeAtUuid } : {}),
				...(yolo ? { permission_mode: 'bypassPermissions' } : {})
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

	/** Hand a conversation to the native TUI (same chat tile, `surface` flips
	 *  to 'tui'): the tile re-renders as a TuiPanel resuming the same engine
	 *  session by id (claude `--resume <id>`, codex `resume <id>`, jucode
	 *  `/resume <id>` written into the pty). The GUI engine is closed FIRST so
	 *  two processes never hold the same conversation. Requires a usable
	 *  engine session id — resume-by-id is the product, never a TUI picker —
	 *  so a fresh empty chat and ACP sessions are a no-op. */
	async openInTui(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.surface === 'tui' || !canHandOffToTui(s.backendId)) return;
		// Same rule serialize uses for `sid`: the engine persisted the
		// conversation only once a user turn exists (or it was restored).
		if (!isValidResumeSessionId(s.chat.sessionId) || !(s.chat.resumable || s.restored)) return;
		// Intentional close — handleExit must not auto-restart the GUI engine
		// underneath the TUI.
		s.chat.switching = true;
		try {
			await closeSession(id);
		} catch {
			/* engine already gone */
		}
		s.surface = 'tui';
	}

	/** Bring a handed-off conversation back to the GUI: flip the surface first
	 *  (unmounting the TuiPanel closes its pty in onDestroy), wait one tick
	 *  for that unmount, then respawn the GUI engine resuming the same
	 *  conversation (claude `--resume`, jucode `/resume`, codex thread ctx —
	 *  all inside restartSession). */
	async returnToGui(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.surface !== 'tui') return;
		s.surface = 'gui';
		await tick(); // let the TuiPanel unmount issue its ptyClose first
		this.restartSession(id, true);
	}

	/** Snapshot of the layout + open tabs for persistence. Every session is
	 *  written (empty windows survive a workspace switch under their desktop
	 *  id); `sid` only when the engine actually persisted the conversation —
	 *  never `/resume` one it didn't. A restored session keeps its `sid` even
	 *  while its replayed transcript is still empty (replay is async and may
	 *  fail; the engine-side conversation exists regardless). The backend id
	 *  is only written when it isn't the default, so pre-existing layouts stay
	 *  byte-identical; 'acp' tabs also carry their agent so restore can respawn. */
	serialize(): SavedProject[] {
		return this.projects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			...(p.worktree ? { worktree: p.worktree } : {}),
			...(p.lastBackend && p.lastBackend !== 'jucode' ? { lastBackend: p.lastBackend } : {}),
			...(p.lastBackend === 'acp' && p.lastAcpAgent ? { lastAcpAgent: p.lastAcpAgent } : {}),
			tabs: p.sessions
				.map((s) => ({
					id: s.id,
					...(s.chat.sessionId && (s.chat.resumable || s.restored) ? { sid: s.chat.sessionId } : {}),
					title: s.chat.title,
					...(s.backendId !== 'jucode' ? { backend: s.backendId } : {}),
					...(s.backendId === 'acp' && s.acpAgent ? { acpAgent: s.acpAgent } : {}),
					...(s.archived ? { archived: true } : {}),
					...(s.surface === 'tui' ? { surface: 'tui' as const } : {}),
					...(s.color ? { color: s.color } : {}),
					...(s.icon ? { icon: s.icon } : {}),
					...(s.chat.titleLocked ? { titleLocked: true } : {})
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
				if (
					proj.lastBackend === 'acp' &&
					p.lastAcpAgent &&
					typeof p.lastAcpAgent.id === 'string' &&
					typeof p.lastAcpAgent.name === 'string'
				) {
					proj.lastAcpAgent = { id: p.lastAcpAgent.id, name: p.lastAcpAgent.name };
				}
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
					if (!t.sid && !t.id) continue;
					// Tabs saved before multi-backend support carry no backend field →
					// jucode (normalizeBackendId maps unknown/missing to the default).
					// Chrome fields are re-validated here (the file is user-editable).
					let backend = normalizeBackendId(t.backend);
					// An 'acp' tab needs its agent back to respawn; older files carry
					// none on the tab → fall back to the project's last agent. Without
					// any, never spawn a bare 'acp' (create_session rejects it).
					const savedAgent =
						t.acpAgent && typeof t.acpAgent.id === 'string' && typeof t.acpAgent.name === 'string'
							? { id: t.acpAgent.id, name: t.acpAgent.name }
							: undefined;
					let acpAgent = backend === 'acp' ? (savedAgent ?? proj.lastAcpAgent) : undefined;
					if (backend === 'acp' && !acpAgent) {
						backend = 'jucode';
						acpAgent = undefined;
					}
					const chrome = {
						color: normalizeColor(t.color),
						icon: parseTabIcon(t.icon),
						titleLocked: !!t.titleLocked
					};
					// With a conversation to resume, resume it; an empty window spawns
					// fresh. Both keep the saved desktop id (pre-id files mint anew).
					// A tab handed to the TUI restores as a TUI surface (no engine).
					const surface = t.surface === 'tui' ? ('tui' as const) : undefined;
					const id = t.sid
						? this.restoreSession(proj, t.sid, t.title, backend, !!t.archived, chrome, t.id, acpAgent, surface)
						: this.#spawnSaved(proj, t.id!, t.title, backend, !!t.archived, chrome, acpAgent);
					if (!first && !t.archived) first = id;
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
