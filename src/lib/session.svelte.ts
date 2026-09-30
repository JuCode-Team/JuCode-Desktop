import { ChatState } from './chat.svelte';
import { acpAgentsList, createSession, closeSession, daemon, hostSession, sessionMeta, projectRoot, chatsDir, writeConfig, git, claudeSessionTranscript, jucodeSessions } from './protocol';
import type { EngineSpec } from './daemon';
import { canHandOffToTui, isValidResumeSessionId } from './tuiHandoff';
import { createAdapter, normalizeBackendId, type BackendId } from './backends';
import { clearDraft, dispatch, dropHeldOps, holdOps, ioFor, markDraft, registerAdapter, unregisterAdapter } from './backends/router';
import { buildBackendOpts, defaultBackendFor, loadBackendSettings } from './backends/settings';
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
		/** Hosted by the local `jucode daemon`; `sid` is its daemon session. */
		hosted?: boolean;
		/** Claude Code / Codex through the JuCode gateway (Session.gateway). */
		gateway?: boolean;
	} & SavedTabChrome)[];
	/** 并行任务 worktree 项目的元数据（isWorktree/mainRepoPath/branch/baseBranch/slug）。 */
	worktree?: WorktreeMeta;
	/** 本项目最近一次新建会话所用的引擎后端（缺省 = jucode）。 */
	lastBackend?: string;
	/** lastBackend 为 'acp' 时：上次选择的 ACP agent。 */
	lastAcpAgent?: { id: string; name: string };
	/** 对话分组（见 Project.chats）。 */
	chats?: boolean;
}

/** Waits between attempts to reach an unreachable daemon, ms (~4.5 min). */
const DAEMON_RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000, 30000, 30000];

/** Backends the daemon can run. */
const DAEMON_BACKENDS: BackendId[] = ['jucode', 'claude', 'codex', 'acp'];

/** New sessions of those backends run in the daemon when the setting is on. */
function hostsNewSessions(backend: BackendId): boolean {
	return DAEMON_BACKENDS.includes(backend) && loadBackendSettings().daemon;
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
	#surfaceTransitions = new Set<string>();
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

	/** An engine that failed to start retries like one that crashed (see
	 *  handleExit): up to 3 times, a little later each time, since the usual
	 *  causes (daemon still starting, a network blip) clear up on their own. */
	#engineFailed(chat: ChatState, e: unknown) {
		chat.engineState = 'exited';
		chat.restarting = false;
		const s = this.allSessions.find((x) => x.chat === chat);
		// A hosted session whose daemon can't be reached (restarting, being
		// upgraded): keep trying for about 4.5 minutes, backing off, without
		// spending the crash budget or stacking an error per attempt.
		if (s?.hosted && s.surface !== 'tui' && chat.daemonRetries < DAEMON_RETRY_DELAYS.length) {
			if (chat.daemonRetries === 0) chat.messages.push({ kind: 'system', text: t('shell.daemonReconnecting') });
			const delay = DAEMON_RETRY_DELAYS[chat.daemonRetries++]!;
			setTimeout(() => {
				const live = this.allSessions.find((x) => x.id === s.id);
				if (live?.chat === chat && chat.engineState === 'exited') this.restartSession(s.id, false, '', false);
			}, delay);
			return;
		}
		chat.messages.push({ kind: 'error', text: t('shell.startFail', { msg: String(e) }) });
		// Out of retries: held messages wait for a manual restart.
		if (!s || s.surface === 'tui' || chat.restarts >= 3) return;
		setTimeout(() => {
			// The tab may have been closed, or its chat replaced, meanwhile.
			const live = this.allSessions.find((x) => x.id === s.id);
			if (live?.chat === chat && chat.engineState === 'exited') this.restartSession(s.id);
		}, 1500 * (chat.restarts + 1));
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
		resume?: string,
		agent?: string
	) {
		const base = buildBackendOpts(s.backendId);
		// ACP sessions always pass their registry agent id (initial spawn and
		// every crash auto-restart alike) — the Rust side looks the command up.
		const agentOpt = s.backendId === 'acp' && s.acpAgent ? { agent: s.acpAgent.id } : undefined;
		// Sessions of the chats group run as chats (engine-side chat prompt).
		const chat = this.projects.some((p) => p.chats && p.sessions.some((x) => x.id === s.id));
		const chatOpt = chat ? { chat: true } : undefined;
		// claude reports its permission mode only when the first turn starts; an
		// engine spawned in another mode than the desktop's would then be
		// respawned mid-turn (yolo can't be set live), losing a turn it had not
		// saved yet. Spawn it in the desktop's mode from the start.
		const modeOpt =
			s.backendId === 'claude' ? { permission_mode: toClaudeMode(toEngineMode(s.chat.approvalMode)) } : undefined;
		// This session alone talks to the JuCode gateway (see Session.gateway).
		const gatewayOpt =
			(s.backendId === 'claude' || s.backendId === 'codex') && s.gateway !== undefined
				? { jucode_gateway: s.gateway }
				: undefined;
		const opts =
			agentOpt || extraOpts || chatOpt || modeOpt || gatewayOpt
				? {
						...(base ?? {}),
						...(agentOpt ?? {}),
						...(chatOpt ?? {}),
						...(modeOpt ?? {}),
						...(gatewayOpt ?? {}),
						...(extraOpts ?? {})
					}
				: base;
		if (s.backendId === 'claude') s.spawnedMode = String((opts as Record<string, unknown>)?.permission_mode ?? '');
		// Ops sent until the new engine is up wait for it instead of reaching no
		// child (or the one being replaced).
		holdOps(s.id);
		s.chat.restarting = true;
		// A hosted session reopens its daemon session when it has one (restart,
		// restore, provider switch) and creates one otherwise.
		// The daemon translates other engines into jucode events itself.
		if (s.hosted && s.adapter.id !== 'jucode') {
			s.adapter = createAdapter('jucode');
			registerAdapter(s.id, s.adapter);
		}
		const optsRec = (opts ?? {}) as Record<string, unknown>;
		const engine = !s.hosted
			? undefined
			: s.backendId === 'claude'
				? {
						engine: 'claude',
						options: {
							approval_mode: optsRec.permission_mode,
							...(gatewayOpt ?? {}),
							...(optsRec.model ? { model: optsRec.model } : {}),
							...(optsRec.resume_session_at ? { resume_at: optsRec.resume_session_at } : {})
						}
					}
				: s.backendId === 'codex'
					? { engine: 'codex', options: { approval_mode: toEngineMode(s.chat.approvalMode), ...(gatewayOpt ?? {}) } }
					: undefined;
		// An ACP agent runs the command its registry entry names.
		const acpEngine = () =>
			acpAgentsList().then((agents) => {
				const entry = agents.find((a) => a.id === s.acpAgent?.id);
				if (!entry) throw new Error(`unknown ACP agent ${s.acpAgent?.id ?? ''}`);
				return { engine: 'acp', options: { command: entry.command, args: entry.args, env: entry.env } };
			});
		const host = (spec: EngineSpec | undefined) =>
			hostSession(s.id, cwd ?? '', resume ?? (s.chat.sessionId || undefined), agent, chat, spec).then(() => spec);
		const hosted = () => (s.backendId === 'acp' ? acpEngine().then(host) : host(engine));
		const spawned = s.hosted
			? hosted().then((spec) => {
					// A new claude or codex session is named by the daemon (the engine's
					// conversation id).
					if (spec && !s.chat.sessionId) s.chat.sessionId = daemon.sessionOf(s.id) ?? '';
				})
			: s.backendId === 'jucode' && !opts
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
			// The spawn's own follow-up (resume, first message) goes first, then
			// whatever the user sent meanwhile.
			const held = dropHeldOps(s.id);
			s.chat.restarting = false;
			after?.();
			for (const op of held) dispatch(s.id, op);
		});
	}

	/** A new session in `project`, made active, as a draft: nothing starts
	 *  until its first message (see `#startDraft`). `firstMessage` (e.g. a
	 *  parallel task's 任务描述) is that message, sent right away. `backend`
	 *  overrides the project's last-used backend (which itself falls back to
	 *  the settings default). `acpAgent` picks the registry agent for 'acp'
	 *  sessions (defaults to the project's last one; without any, the session
	 *  falls back to the native engine). */
	addSession(
		project: Project,
		firstMessage?: string,
		backend?: BackendId,
		acpAgent?: { id: string; name: string }
	) {
		// Only the jucode engine has a chat mode.
		let backendId = project.chats ? 'jucode' : (backend ?? defaultBackendFor(project.lastBackend));
		let agent = backendId === 'acp' ? (acpAgent ?? project.lastAcpAgent) : undefined;
		if (backendId === 'acp' && !agent) {
			backendId = 'jucode'; // no agent to launch — never spawn a bare 'acp'
			agent = undefined;
		}
		const s = this.#newSession(backendId, agent);
		this.#makeDraft(s);
		project.sessions.push(s);
		this.activeId = s.id;
		if (firstMessage) {
			s.chat.optimisticUser(firstMessage);
			dispatch(s.id, { op: 'user_message', content: firstMessage });
		}
		return s.id;
	}

	/** No engine yet: the menus show what the backend reported last time, and
	 *  the first op the session is sent starts it. Call it before the session
	 *  joins its project (the list is reactive state; see `#startDraft`). */
	#makeDraft(s: Session) {
		s.draft = true;
		s.chat.booting = false;
		s.chat.engineState = 'ready';
		s.chat.seedFromProfile();
		markDraft(s.id, () => this.#startDraft(s.id));
	}

	/** The first message: the draft becomes a session of its backend. Looked
	 *  up by id, so it changes the session as the reactive list holds it. */
	#startDraft(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		const project = this.projects.find((p) => p.sessions.some((x) => x.id === id));
		if (!s?.draft || !project) return;
		s.draft = false;
		s.hosted = hostsNewSessions(s.backendId);
		project.lastBackend = s.backendId;
		if (s.backendId === 'acp' && s.acpAgent) project.lastAcpAgent = s.acpAgent;
		// Pin a session id we control for claude (via --session-id) so the
		// conversation persists under a known uuid and --resume can restore its
		// context after a crash/restart — the CLI's own auto-generated id isn't
		// reliably resumable in gateway setups ("No conversation found").
		const extra = s.backendId === 'claude' && !s.hosted ? { session_id: newUuid() } : undefined;
		if (extra) s.chat.sessionId = extra.session_id;
		const pick = s.draftPick;
		s.draftPick = undefined;
		const model = pick?.model || s.chat.model;
		// The model and effort picked while a draft go first; the held first
		// message follows.
		const applyPick = () => {
			if (!pick || !model) return;
			const effort = pick.effort ?? '';
			dispatch(s.id, { op: 'command', input: effort ? `/model ${model} ${effort}` : `/model ${model}` });
		};
		this.#spawn(s, project.path, applyPick, extra).catch((e) => this.#engineFailed(s.chat, e));
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
		if (s.draft) {
			this.#redraft(s, backend, acpAgent);
			return;
		}
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
			if (this.#gone(s)) return;
		} catch {
			/* old child may already be gone */
		}
		s.hosted = hostsNewSessions(backend);
		// Same rationale as addSession: pin a resumable uuid for claude.
		const extra = backend === 'claude' && !s.hosted ? { session_id: newUuid() } : undefined;
		if (extra) chat.sessionId = extra.session_id;
		try {
			await this.#spawn(s, project?.path, undefined, extra);
			chat.switching = false;
		} catch (e) {
			chat.switching = false;
			this.#engineFailed(chat, e);
		}
	}

	/** A draft's backend changes: only the choice, nothing starts. */
	#redraft(s: Session, backend: BackendId, acpAgent?: { id: string; name: string }) {
		const chat = new ChatState();
		chat.backendId = backend;
		chat.title = s.chat.title;
		chat.titleLocked = s.chat.titleLocked;
		const agent = backend === 'acp' ? acpAgent : undefined;
		if (agent) {
			chat.acpAgentId = agent.id;
			chat.acpAgentName = agent.name;
		}
		const adapter = createAdapter(backend);
		registerAdapter(s.id, adapter);
		s.chat = chat;
		s.backendId = backend;
		s.adapter = adapter;
		s.acpAgent = agent;
		s.draftPick = undefined;
		this.#makeDraft(s);
	}

	/** Archive a thread: hide it from the sidebar by default without closing or
	 *  deleting it. If it was active, move focus to a live non-archived sibling. */
	archiveSession(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		s.archived = true;
		this.#share(s, { archived: true });
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
		if (!s) return;
		s.archived = false;
		this.#share(s, { archived: false });
	}

	/** A hosted session's title, archive state or removal goes to the daemon,
	 *  which every other client follows. */
	#share(s: Session, changes: { title?: string; archived?: boolean; hidden?: boolean }) {
		if (s.hosted && s.chat.sessionId) sessionMeta(s.chat.sessionId, changes).catch(() => {});
	}

	/** Lists a daemon session in `project` without opening it here; it opens
	 *  when it is first shown. Returns the desktop id. */
	listDormant(
		project: Project,
		rec: { session: string; title?: string | null; archived?: boolean; engine?: string },
		reuseId?: string
	): string {
		const s = this.#newSession(normalizeBackendId(rec.engine), undefined, reuseId);
		s.hosted = true;
		s.dormant = true;
		s.restored = true;
		s.archived = !!rec.archived;
		s.chat.sessionId = rec.session;
		if (rec.title) s.chat.title = rec.title;
		s.chat.engineState = 'ready';
		project.sessions.push(s);
		return s.id;
	}

	#restoreDormant(
		project: Project,
		sid: string,
		title: string,
		backend: BackendId,
		archived: boolean,
		chrome: SavedTabChrome,
		reuseId?: string
	): string {
		const id = this.listDormant(project, { session: sid, title, archived, engine: backend }, reuseId);
		const s = project.sessions[project.sessions.length - 1];
		if (chrome.color) s.color = chrome.color;
		if (chrome.icon) s.icon = chrome.icon;
		if (chrome.titleLocked) s.chat.titleLocked = true;
		return id;
	}

	/** Opens a dormant session's engine (through the daemon). */
	wake(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		const path = this.projectPathOf(id);
		if (!s?.dormant || !path) return;
		s.dormant = false;
		this.#spawn(s, path, undefined, undefined, s.chat.sessionId).catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Drops a session another client removed, without telling the daemon. */
	forget(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (!s.dormant && !s.draft) closeSession(id).catch(() => {});
		unregisterAdapter(id);
		clearDraft(id);
		dropHeldOps(id);
		const p = this.projects.find((pr) => pr.sessions.includes(s));
		if (p) p.sessions = p.sessions.filter((x) => x !== s);
		if (this.activeId === id) this.activeId = this.allSessions.find((x) => !x.archived)?.id ?? '';
	}

	/** Adds a project another client created, with no sessions of its own. */
	addProjectShell(project: { id: string; name: string; path: string; chats?: boolean; worktree?: WorktreeMeta }) {
		const p: Project = { id: project.id, name: project.name, path: project.path, sessions: [] };
		if (project.chats) p.chats = true;
		if (project.worktree) p.worktree = project.worktree;
		this.projects.push(p);
	}

	/** Explicit rename: sets the title and locks out auto-titling. */
	renameSession(id: string, title: string) {
		const s = this.allSessions.find((x) => x.id === id);
		const trimmed = title.trim();
		if (!s || !trimmed) return;
		s.chat.title = trimmed;
		s.chat.titleLocked = true;
		this.#share(s, { title: trimmed });
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
		surface?: 'tui',
		hosted = false,
		gateway?: boolean
	) {
		const s = this.#newSession(backend, backend === 'acp' ? acpAgent : undefined, reuseId);
		if (gateway) s.gateway = true;
		// A claude or codex conversation moves into the daemon whenever it can
		// run there, even one saved or started outside it (the daemon resumes it
		// by id).
		s.hosted = (hosted && DAEMON_BACKENDS.includes(backend)) || (backend !== 'jucode' && hostsNewSessions(backend));
		if (title) s.chat.title = title;
		s.archived = archived;
		if (chrome?.color) s.color = chrome.color;
		if (chrome?.icon) s.icon = chrome.icon;
		if (chrome?.titleLocked) s.chat.titleLocked = true;
		// The engine resumes persisted context — the backend can't be switched
		// even while the replayed transcript is still empty.
		s.restored = true;
		project.sessions.push(s);
		// Known before the engine confirms it: a tab saved (or restarted) before
		// the resumed engine reports its id must keep pointing at the saved
		// conversation, or it comes back as a fresh session next time.
		s.chat.sessionId = sid;
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
			backend === 'claude' && !s.hosted
				? this.#spawn(s, project.path, () => this.#replayClaudeTranscript(s, project.path, sid), {
						resume: sid
					})
				: backend === 'codex' || s.hosted
					? this.#spawn(s, project.path, undefined, undefined, sid)
					: this.#spawn(s, project.path, () => dispatch(s.id, { op: 'command', input: `/resume ${sid}` }));
		spawned.catch((e) => this.#engineFailed(s.chat, e));
		return s.id;
	}

	/** A persisted tab that never had a conversation (no first message) comes
	 *  back as a draft of its backend, reusing the saved desktop id so layout
	 *  chat tiles keep matching across workspace switches. */
	#draftSaved(
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
		this.#makeDraft(s);
		project.sessions.push(s);
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

	/** Start a chat (conversation and research, no project) in the chats
	 *  group, which is created first in the list on first use. */
	async newChat() {
		if (!this.projects.some((p) => p.chats)) {
			const path = await chatsDir();
			this.projects.unshift({ id: this.uid(), name: t('shell.chats'), path, sessions: [], chats: true });
		}
		return this.addSession(this.projects.find((p) => p.chats)!);
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

	/** Show a long-lived agent's conversation: `sid` (a daemon session of
	 *  that agent) in its open tab or a new one, or a new session of the
	 *  agent when `sid` is omitted. The tab lands in the project for the
	 *  agent's directory, which is added when missing. */
	openAgentSession(agent: { id: string; name: string; cwd: string }, sid?: string) {
		const open = sid && this.allSessions.find((s) => s.hosted && s.chat.sessionId === sid);
		if (open) {
			open.archived = false;
			this.activeId = open.id;
			return open.id;
		}
		let project = this.projects.find((p) => p.path === agent.cwd && !p.worktree);
		if (!project) {
			project = { id: this.uid(), name: base(agent.cwd), path: agent.cwd, sessions: [] };
			this.projects.push(project);
		}
		const s = this.#newSession('jucode');
		s.hosted = true;
		s.chat.title = agent.name;
		if (sid) {
			// The daemon holds the conversation; the backend stays jucode.
			s.restored = true;
			s.chat.sessionId = sid;
		}
		project.sessions.push(s);
		this.activeId = s.id;
		this.#spawn(s, project.path, undefined, undefined, sid, sid ? undefined : agent.id).catch((e) =>
			this.#engineFailed(s.chat, e)
		);
		return s.id;
	}

	/**
	 * Re-spawn the engine for a session that exited, resuming its conversation if
	 * it had one. Auto-restart is capped at 3 consecutive crashes to avoid crash
	 * loops; the counter is reset by a healthy engine `status` event (see
	 * ChatState.handle) — i.e. only after a restart genuinely succeeds — and by
	 * `force` (the manual button), which clears the budget so the user can retry.
	 */
	restartSession(id: string, force = false, reason = '', spend = true) {
		const s = this.allSessions.find((x) => x.id === id);
		// The native TUI owns handed-off conversations. No crash/manual path may
		// bring up a GUI engine beside it; returnToGui flips ownership first.
		if (!s || s.surface === 'tui') return;
		const now = Date.now();
		if (force) {
			s.chat.restarts = 0;
		}
		s.chat.restartWindowStart = now;
		if (spend) s.chat.restarts++;
		if (force) s.chat.daemonRetries = 0;
		const sid = s.chat.sessionId;
		// A restored session's conversation exists engine-side even while its
		// replayed transcript is still empty (replay is async / best-effort) —
		// the same rule serialize uses to decide a tab is resumable.
		const canResume = s.chat.resumable || (!!sid && !!s.restored);
		s.chat.engineState = 'connecting';
		const text = force
			? t('shell.restarting')
			: reason
				? t('shell.autoRestartingWhy', { reason })
				: t('shell.autoRestarting');
		if (spend) s.chat.messages.push({ kind: 'system', text });
		// claude resumes via the --resume spawn option (no /resume command in
		// stream-json mode); codex resumes via the thread/resume RPC (thread id
		// through SessionCtx); jucode resumes with the command after the handshake.
		// A resume target the engine can't find ("No conversation found …") makes it
		// exit immediately, which would crash-loop forever re-resuming the same
		// doomed id (the bootstrap 'ready' keeps resetting the restart budget). When
		// the adapter flagged a resume failure, come up fresh instead. One-shot: the
		// fresh session gets a new id that CAN be resumed on a later crash.
		const mayResume = sid && canResume && !s.chat.resumeBroken;
		// The failed id names no saved conversation: forget it, or every later
		// restart (the fresh engine has not reported its own id yet) would try it
		// again and die the same way.
		if (s.chat.resumeBroken) s.chat.sessionId = '';
		s.chat.resumeBroken = false;
		const resumeViaSpawn = s.backendId === 'claude' && mayResume;
		const resumeViaCtx = s.backendId === 'codex' && mayResume;
		// Preserve claude's permission mode across the restart so yolo
		// (--dangerously-skip-permissions) survives an auto-restart — otherwise the
		// engine comes up in default mode while the desktop still thinks it's yolo.
		const extra: Record<string, unknown> = {};
		if (resumeViaSpawn) extra.resume = sid;
		// A claude engine coming up fresh gets a new pinned id (as a new session
		// does), not a leftover one it never used, which a later resume would
		// fail on.
		else if (s.backendId === 'claude' && !s.hosted) {
			extra.session_id = newUuid();
			s.chat.sessionId = extra.session_id as string;
			s.chat.unsavedSid = true;
		}
		// A hosted claude session reopens by id; the daemon starts it again if
		// Claude Code never saved it.
		if (s.backendId === 'claude') extra.permission_mode = toClaudeMode(toEngineMode(s.chat.approvalMode));
		this.#spawn(
			s,
			this.projectPathOf(id),
			() => {
				// Hosted sessions resume by reopening the daemon session in #spawn.
				if (sid && canResume && s.backendId === 'jucode' && !s.hosted)
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
	handleExit(id: string, reason = '') {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		// An intentional GUI close can be observed after openInTui has already
		// flipped the surface. Never auto-restart underneath the native TUI.
		if (s.surface === 'tui') {
			s.chat.switching = false;
			return;
		}
		// Intentional close (provider switch, respawn): the caller brings the
		// engine back itself. Local engines no longer report such closes (the
		// Rust side drops a replaced child's exit); hosted ones still do.
		if (s.chat.switching) {
			s.chat.switching = false;
			return;
		}
		s.chat.engineState = 'exited';
		// Until an engine is back (automatically, or by the restart button once
		// the budget is spent), what the user sends waits for it.
		holdOps(id);
		if (s.chat.restarts < 3) {
			this.restartSession(id, false, reason);
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
			if (this.#gone(s)) return;
		} catch (e) {
			this.#engineFailed(s.chat, e);
			return;
		}
		// A draft reads the new config when it starts.
		if (s.draft) {
			s.chat.provider = provider.id;
			s.chat.model = model;
			s.chat.modelLabel = '';
			s.chat.efforts = efforts;
			s.chat.effort = String(patch.reasoning_effort ?? '');
			s.draftPick = undefined;
			return;
		}
		const sid = s.chat.sessionId;
		const canResume = s.chat.resumable;
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({ kind: 'system', text: t('shell.switchingTo', { provider: provider.id, model }) });
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			await this.#spawn(s, this.projectPathOf(id));
			s.chat.switching = false;
			if (sid && canResume && !s.hosted) dispatch(id, { op: 'command', input: `/resume ${sid}` });
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	/** Run this Claude Code / Codex session through the JuCode gateway
	 *  (`jucode`, optionally on `model`) or the provider in the user's own
	 *  config (`system`). Only this session's process changes; other Claude
	 *  Code / Codex sessions on the machine keep their config. */
	async applyToolProfile(id: string, mode: 'system' | 'jucode', model?: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (s.backendId !== 'claude' && s.backendId !== 'codex') return;
		s.gateway = mode === 'jucode';
		// A draft starts that way with its first message.
		if (s.draft) {
			if (model) {
				s.draftPick = { model };
				s.chat.model = model;
				s.chat.modelLabel = '';
			}
			return;
		}
		// The TUI surface picks it up when the conversation returns here.
		if (s.surface === 'tui') return;
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({
			kind: 'system',
			text: mode === 'jucode' ? t('shell.toolSwitch.toJucode') : t('shell.toolSwitch.toSystem')
		});
		const sid = s.chat.sessionId;
		const canResume = s.chat.resumable || (!!sid && !!s.restored);
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			s.chat.resumeBroken = false;
			const mayResume = !!(sid && canResume);
			const extra: Record<string, unknown> = {};
			if (s.backendId === 'claude' && mayResume && !s.hosted) extra.resume = sid;
			await this.#spawn(
				s,
				this.projectPathOf(id),
				model ? () => dispatch(id, { op: 'command', input: `/model ${model}` }) : undefined,
				Object.keys(extra).length ? extra : undefined,
				(s.backendId === 'codex' || s.hosted) && mayResume ? sid : undefined
			);
			s.chat.switching = false;
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
			if (this.#gone(s)) return;
			await this.#spawn(s, this.projectPathOf(id), undefined, {
				permission_mode: 'bypassPermissions',
				...(sid && canResume ? { resume: sid } : {})
			});
			s.chat.switching = false;
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
		// Back to before the first turn: a new conversation (a hosted session
		// would otherwise reopen the old one by id).
		if (!resumeAtUuid && s.hosted) s.chat.sessionId = '';
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			await this.#spawn(s, this.projectPathOf(id), undefined, {
				...(sid && resumeAtUuid ? { resume: sid, resume_session_at: resumeAtUuid } : {}),
				...(yolo ? { permission_mode: 'bypassPermissions' } : {})
			});
			s.chat.switching = false;
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	removeSession(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		// Closing a hosted session's tab removes it from every client's list.
		if (s) this.#share(s, { hidden: true });
		if (!s?.dormant && !s?.draft) closeSession(id).catch(() => {});
		unregisterAdapter(id);
		clearDraft(id);
		dropHeldOps(id);
		const p = this.projects.find((pr) => pr.sessions.some((s) => s.id === id));
		if (p) p.sessions = p.sessions.filter((s) => s.id !== id);
		if (this.activeId === id) this.activeId = this.allSessions[0]?.id ?? '';
	}

	/** Tear down a project and all its sessions (the page handles confirmation). */
	removeProject(p: Project) {
		for (const s of p.sessions) {
			if (!s.dormant && !s.draft) closeSession(s.id).catch(() => {});
			unregisterAdapter(s.id);
			clearDraft(s.id);
			dropHeldOps(s.id);
		}
		this.projects = this.projects.filter((x) => x.id !== p.id);
		if (!this.allSessions.some((s) => s.id === this.activeId)) this.activeId = this.allSessions[0]?.id ?? '';
	}

	/** Open the project's history: the JuCode conversations saved for its
	 *  directory, read from disk, as a picker in one of its chats (the active
	 *  one when it is in this project). Only a project with no chat at all gets
	 *  a new one to show it in. */
	async openHistory(p: Project) {
		const active = p.sessions.find((s) => s.id === this.activeId);
		const id = active?.id ?? p.sessions.find((s) => !s.archived)?.id ?? this.addSession(p);
		this.activeId = id;
		const chat = this.allSessions.find((s) => s.id === id)?.chat;
		if (!chat) return;
		try {
			const sessions = await jucodeSessions(p.path);
			chat.handle({
				type: 'resume_view',
				backend: 'jucode',
				items: sessions.map((x) => ({
					id: x.id,
					label: x.label || x.id,
					detail: new Date(x.updated_at * 1000).toLocaleString(),
					active: x.id === chat.sessionId
				}))
			});
		} catch (e) {
			chat.messages.push({ kind: 'system', text: t('shell.historyFail', { msg: String(e) }) });
		}
	}

	/** Open a saved conversation from a history picker in a new tab. */
	openSaved(project: Project, sid: string, title: string, backend: BackendId) {
		// Already open: switch to it (a second engine on the same conversation
		// would fight over it).
		const open = this.allSessions.find((s) => s.backendId === backend && s.chat.sessionId === sid);
		if (open) {
			if (open.archived) open.archived = false;
			this.activeId = open.id;
			return;
		}
		this.activeId = this.restoreSession(
			project,
			sid,
			title,
			backend,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			hostsNewSessions(backend)
		);
	}

	/** The tab was closed (or its workspace swapped out) while an async
	 *  engine switch was awaiting: spawning now would leave an engine nobody
	 *  owns, or replace the one a reopened tab just started. */
	#gone(s: Session): boolean {
		return !this.allSessions.includes(s);
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
		if (
			!s ||
			s.surface === 'tui' ||
			s.chat.switching ||
			this.#surfaceTransitions.has(id) ||
			!canHandOffToTui(s.backendId)
		)
			return;
		// Same rule serialize uses for `sid`: the engine persisted the
		// conversation only once a user turn exists (or it was restored).
		if (!isValidResumeSessionId(s.chat.sessionId) || !(s.chat.resumable || s.restored)) return;
		// Keep a second click from issuing another close that could resolve first
		// and expose the TUI while the original GUI child is still shutting down.
		this.#surfaceTransitions.add(id);
		// Intentional close — handleExit must not auto-restart the GUI engine
		// underneath the TUI.
		s.chat.switching = true;
		try {
			await closeSession(id);
		} catch {
			// A failed close cannot establish exclusive ownership. Leave the GUI
			// surface in place rather than starting a second process.
			s.chat.switching = false;
			return;
		} finally {
			this.#surfaceTransitions.delete(id);
		}
		// The tab/project may have been removed while the close was in flight.
		if (!this.allSessions.includes(s)) return;
		s.surface = 'tui';
		// TUI ownership is established: a late exit event from the closed GUI
		// child lands on handleExit's `surface === 'tui'` branch, and if the
		// engine was already dead no exit event arrives at all — so the flag
		// must be cleared here or it latches forever.
		s.chat.switching = false;
	}

	/** Bring a handed-off conversation back to the GUI. TuiPanel invokes this
	 *  only after `ptyClose` has completed, so flipping ownership and resuming
	 *  the GUI engine cannot overlap the native TUI process. */
	async returnToGui(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.surface !== 'tui') return;
		s.surface = 'gui';
		// Never carry a latched handoff flag back to the GUI — it would block
		// later openInTui calls and make handleExit swallow the next real crash.
		s.chat.switching = false;
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
			...(p.chats ? { chats: true } : {}),
			...(p.lastBackend && p.lastBackend !== 'jucode' ? { lastBackend: p.lastBackend } : {}),
			...(p.lastBackend === 'acp' && p.lastAcpAgent ? { lastAcpAgent: p.lastAcpAgent } : {}),
			tabs: p.sessions
				.map((s) => ({
					id: s.id,
					// A hosted session exists in the daemon from its first moment, so
					// its id is always worth keeping.
					...(s.chat.sessionId && (s.chat.resumable || s.restored || s.hosted)
						? { sid: s.chat.sessionId }
						: {}),
					...(s.hosted ? { hosted: true } : {}),
					...(s.gateway ? { gateway: true } : {}),
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
				if (p.chats === true) proj.chats = true;
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
					// Workspace data is user-editable. Invalid ids must never
					// reach either a GUI resume or the TUI pty argv.
					const sid =
						typeof t.sid === 'string' && isValidResumeSessionId(t.sid) ? t.sid : undefined;
					if (!sid && !t.id) continue;
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
					// With a conversation to resume, resume it; an empty window comes
					// back as a draft. Both keep the saved desktop id (pre-id files mint anew).
					// A tab handed to the TUI restores as a TUI surface (no engine).
					const surface = t.surface === 'tui' && sid ? ('tui' as const) : undefined;
					// A hosted conversation waits in the daemon: list it now and open
					// it when it is shown (ACP needs its agent spawn path below).
					const dormant = sid && t.hosted === true && !surface && backend !== 'acp';
					const id = dormant
						? this.#restoreDormant(proj, sid, t.title, backend, !!t.archived, chrome, t.id)
						: sid
						? this.restoreSession(
								proj,
								sid,
								t.title,
								backend,
								!!t.archived,
								chrome,
								t.id,
								acpAgent,
								surface,
								t.hosted === true,
								t.gateway === true
							)
						: this.#draftSaved(proj, t.id!, t.title, backend, !!t.archived, chrome, acpAgent);
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
