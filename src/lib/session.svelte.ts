import { AUTO_CONTINUE, ChatState, UNTITLED } from './chat.svelte';
import { acpAgentsList, closeSession, daemon, hostSession, sessionMeta, sessionHistory, projectRoot, chatsDir, writeConfig, git } from './protocol';
import type { EngineSpec } from './daemon';
import { canHandOffToTui, isValidResumeSessionId } from './tuiHandoff';
import { normalizeBackendId, type BackendId } from './backends';
import { createJucodeAdapter } from './backends/jucode';
import { clearDraft, dispatch, dropHeldOps, holdOps, ioFor, markDraft, registerAdapter, startDraft, unregisterAdapter } from './backends/router';
import { buildBackendOpts, defaultBackendFor } from './backends/settings';
import { toEngineMode } from './approval';
import { t } from '$lib/i18n';
import { saveComposerText } from './composerText';
import { toast } from './ui/toast.svelte';
import { telemetry } from './telemetry.svelte';
import { normalizeColor, parseTabIcon, type TabIcon } from './workbench/tabChrome';
import { CHATS_ENABLED, type Project, type Session, type WorktreeMeta } from './types';

/** Optional per-tab chrome persisted alongside the session id + title. */
export interface SavedTabChrome {
	color?: string;
	icon?: TabIcon;
}

// The persisted shape of a project + its open tabs. `id` is the desktop
// session id (stable across restore so layout chat tiles keep matching);
// `sid` is the engine conversation to resume, present only when the engine
// actually persisted one.
export interface SavedProject extends SavedTabChrome {
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
		pinned?: boolean;
		/** The conversation was handed to the native TUI (resume by `sid`).
		 *  Omitted for the default GUI surface so old layouts stay clean. */
		surface?: 'tui';
		/** Claude Code / Codex through the JuCode gateway (Session.gateway). */
		gateway?: boolean;
		/** Claude Code: the model it last ran on (Session.model). */
		model?: string;
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

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

/** A project's sessions as the sidebar lists them: pinned first, each group
 *  in the project's own order (new sessions join at the start); archived
 *  ones are left out. */
export function listedSessions(p: Project): Session[] {
	const live = p.sessions.filter((s) => !s.archived);
	return [...live.filter((s) => s.pinned), ...live.filter((s) => !s.pinned)];
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
	/** The saved tabs of stale projects, by project id: kept so they are saved
	 *  back as they were, should the worktree come back. */
	#staleTabs = new Map<string, SavedProject['tabs']>();
	uid() {
		return `s${Date.now().toString(36)}-${(this.#counter++).toString(36)}`;
	}

	get allSessions() {
		return this.projects.flatMap((p) => p.sessions);
	}
	/** Projects the UI shows: a hidden chats group stays in the tree (and in
	 *  the saved and daemon lists) but is never listed or opened. */
	get shownProjects() {
		return this.userProjects.filter((p) => CHATS_ENABLED || !p.chats);
	}
	/** Every project but the hidden ones that host agent sessions (see
	 *  Project.agents): what is saved, synced and matched by path. */
	get userProjects() {
		return this.projects.filter((p) => !p.agents);
	}
	get shownSessions() {
		return this.shownProjects.flatMap((p) => p.sessions);
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
		telemetry.track('error:engine');
		chat.engineState = 'exited';
		chat.restarting = false;
		const s = this.allSessions.find((x) => x.chat === chat);
		// The daemon can't be reached (restarting, being upgraded): keep trying
		// for about 4.5 minutes, backing off, without spending the crash budget
		// or stacking an error per attempt.
		if (s && s.surface !== 'tui' && chat.daemonRetries < DAEMON_RETRY_DELAYS.length) {
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
		chat.bindRunKey(id);
		if (acpAgent) {
			chat.acpAgentId = acpAgent.id;
			chat.acpAgentName = acpAgent.name;
		}
		const adapter = createJucodeAdapter();
		registerAdapter(id, adapter);
		return { id, chat, backendId, adapter, ...(acpAgent ? { acpAgent } : {}) };
	}

	/** Opens `s` in the daemon: its session when it has one (restart,
	 *  restore, provider switch), else a new one; then runs `after`, then what
	 *  the user sent meanwhile. `extraOpts` carries per-start choices (claude's
	 *  `permission_mode`, `resume_session_at`); `resume` names the conversation
	 *  to reopen when it is not the session's own; `agent` starts it as that
	 *  long-lived agent. The daemon translates every engine into jucode
	 *  events, so the session's adapter is the jucode one. */
	#spawn(
		s: Session,
		cwd: string | undefined,
		after?: () => void,
		extraOpts?: Record<string, unknown>,
		resume?: string,
		agent?: string
	) {
		// Sessions of the chats group run as chats (engine-side chat prompt).
		const chat = this.projects.some((p) => p.chats && p.sessions.some((x) => x.id === s.id));
		const base = buildBackendOpts(s.backendId);
		// claude reports its permission mode only when the first turn starts; an
		// engine started in another mode than the desktop's would then be
		// restarted mid-turn (yolo can't be set live), losing a turn it had not
		// saved yet. Start it in the desktop's mode.
		const mode = String(extraOpts?.permission_mode ?? toEngineMode(s.chat.approvalMode));
		if (s.backendId === 'claude') s.spawnedMode = mode === 'full-auto' ? 'bypassPermissions' : mode;
		// Ops sent until the engine is up wait for it instead of reaching no
		// engine (or the one being replaced).
		holdOps(s.id);
		s.chat.restarting = true;
		// Background tasks belong to the engine process being replaced.
		s.chat.bgTasks = [];
		s.chat.taskOutputs = {};
		// What this chat already shows of a claude conversation is richer than
		// the daemon's replay of it.
		if (s.backendId === 'claude' && s.chat.messages.some((m) => m.kind === 'user')) s.chat.keepNextTranscript = true;
		const program = {
			...(base?.bin_override ? { bin: base.bin_override } : {}),
			...(base?.env ? { env: base.env } : {})
		};
		// This session alone talks to the JuCode gateway (see Session.gateway).
		const gateway = s.gateway !== undefined ? { jucode_gateway: s.gateway } : {};
		const engine: Promise<EngineSpec | undefined> =
			s.backendId === 'claude'
				? Promise.resolve({
						engine: 'claude',
						options: {
							approval_mode: mode,
							...gateway,
							...program,
							...(extraOpts?.model ? { model: extraOpts.model } : {}),
							...(extraOpts?.resume_session_at ? { resume_at: extraOpts.resume_session_at } : {}),
							// A restarted engine keeps the session's settings.
							...(s.chat.ultracode ? { ultracode: true } : {}),
							...(s.chat.fast ? { fast: true } : {}),
							...(s.chat.effort ? { effort: s.chat.effort } : {}),
							...(s.chat.thinkingSummaries === false ? { thinking: false } : {})
						}
					})
				: s.backendId === 'codex'
					? Promise.resolve({
							engine: 'codex',
							options: {
								approval_mode: mode,
								...gateway,
								...program,
								// A restarted engine keeps the session's switches.
								...(s.chat.fast ? { fast: true } : {}),
								...(s.chat.thinkingSummaries === false ? { thinking: false } : {})
							}
						})
					: s.backendId === 'acp'
						? // An ACP agent runs the command its registry entry names.
							acpAgentsList().then((agents) => {
								const entry = agents.find((a) => a.id === s.acpAgent?.id);
								if (!entry) throw new Error(`unknown ACP agent ${s.acpAgent?.id ?? ''}`);
								return {
									engine: 'acp',
									// The agent's own environment wins over the backend's.
									options: { command: entry.command, args: entry.args, env: { ...(base?.env ?? {}), ...entry.env } }
								};
							})
						: Promise.resolve(undefined);
		return engine
			.then((spec) =>
				hostSession(s.id, cwd ?? '', resume ?? (s.chat.sessionId || undefined), agent, chat, spec).then(() => {
					// A new session is named by the daemon (the engine's conversation id).
					if (!s.chat.sessionId) {
						s.chat.sessionId = daemon.sessionOf(s.id) ?? '';
						// A group picked while it was a draft goes in with its id.
						if (s.group) this.#share(s, { group: s.group });
						// Started on a requirement: it works on it from now on.
						if (s.requirement && s.chat.sessionId) {
							const requirement = s.requirement;
							s.requirement = undefined;
							daemon
								.request({ op: 'requirement_link', requirement, session: s.chat.sessionId })
								.catch((e) => toast.error(String(e)));
						}
					}
				})
			)
			.then(() => {
				s.adapter.onStart(ioFor(s.id), {
					cwd: cwd ?? '',
					approvalMode: s.chat.approvalMode,
					sessionId: s.id,
					...(resume ? { resume } : {})
				});
				// The start's own follow-up (a model pick, a first message) goes
				// first, then whatever the user sent meanwhile.
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
		// At the start: the sidebar lists a project's first sessions only.
		project.sessions.unshift(s);
		this.activeId = s.id;
		if (firstMessage) {
			s.chat.optimisticUser(firstMessage);
			dispatch(s.id, { op: 'user_message', content: firstMessage });
		}
		return s.id;
	}

	/** A new session that opens in its backend's TUI: its engine starts at
	 *  once (the TUI takes over the daemon session), and the TUI starts the
	 *  conversation. */
	addTuiSession(project: Project, backend: BackendId) {
		const id = this.addSession(project, undefined, backend);
		const s = this.allSessions.find((x) => x.id === id);
		if (s && canHandOffToTui(s.backendId)) {
			s.surface = 'tui';
			startDraft(id);
		}
		return id;
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
		telemetry.track(`session_start:${s.backendId}`);
		project.lastBackend = s.backendId;
		if (s.backendId === 'acp' && s.acpAgent) project.lastAcpAgent = s.acpAgent;
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
		this.#spawn(s, project.path, applyPick)
			.then(() => {
				// Renamed while a draft, before it had a daemon session.
				if (s.chat.title !== UNTITLED) this.#share(s, { title: s.chat.title });
			})
			.catch((e) => this.#engineFailed(s.chat, e));
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
		chat.bindRunKey(id);
		chat.switching = true;
		unregisterAdapter(id);
		const adapter = createJucodeAdapter();
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
		try {
			await this.#spawn(s, project?.path);
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
		chat.bindRunKey(s.id);
		chat.title = s.chat.title;
		const agent = backend === 'acp' ? acpAgent : undefined;
		if (agent) {
			chat.acpAgentId = agent.id;
			chat.acpAgentName = agent.name;
		}
		const adapter = createJucodeAdapter();
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
				this.shownSessions.find((x) => x.id !== id && !x.archived);
			this.activeId = next?.id ?? '';
		}
	}

	/** Route a gateway session's requests to `group` ('' : automatic); its
	 *  next request goes there (the daemon's local gateway applies it). */
	/** Whether a session has a gateway group of its own: Claude Code / Codex,
	 *  whose requests the daemon's local gateway routes (a draft shares its
	 *  pick when it starts). */
	takesSessionGroup(s: Session): boolean {
		return s.backendId === 'claude' || s.backendId === 'codex';
	}

	setSessionGroup(id: string, group: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		s.group = group || undefined;
		this.#share(s, { group });
	}

	/** Restore an archived thread to the normal list. */
	unarchiveSession(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		s.archived = false;
		this.#share(s, { archived: false });
	}

	/** Pin or unpin a session. Desktop only: the daemon keeps no such flag. */
	setPinned(id: string, pinned: boolean) {
		const s = this.allSessions.find((x) => x.id === id);
		if (s) s.pinned = pinned || undefined;
	}

	/** Moves a session next to `targetId` in its project's order (a sidebar
	 *  drag); the two are expected in the same pinned group. */
	moveSession(id: string, targetId: string, after: boolean) {
		const p = this.projects.find((pr) => pr.sessions.some((x) => x.id === id));
		const s = p?.sessions.find((x) => x.id === id);
		if (!p || !s || id === targetId) return;
		const rest = p.sessions.filter((x) => x !== s);
		const i = rest.findIndex((x) => x.id === targetId);
		if (i < 0) return;
		rest.splice(after ? i + 1 : i, 0, s);
		p.sessions = rest;
	}

	/** A session's title, archive state or removal goes to the daemon, which
	 *  every other client follows. */
	#share(s: Session, changes: { title?: string; archived?: boolean; hidden?: boolean; group?: string }) {
		if (s.chat.sessionId) sessionMeta(s.chat.sessionId, changes).catch(() => {});
	}

	/** Lists a daemon session in `project` without opening it here; it opens
	 *  when it is first shown. Returns the desktop id. */
	listDormant(
		project: Project,
		rec: {
			session: string;
			title?: string | null;
			archived?: boolean;
			engine?: string;
			group?: string | null;
			gateway?: boolean;
		},
		reuseId?: string,
		atStart = false
	): string {
		const s = this.#newSession(normalizeBackendId(rec.engine), undefined, reuseId);
		if (rec.gateway) s.gateway = true;
		s.dormant = true;
		s.restored = true;
		s.archived = !!rec.archived;
		s.group = rec.group || undefined;
		if (rec.gateway) s.gateway = true;
		s.chat.sessionId = rec.session;
		if (rec.title) s.chat.title = rec.title;
		s.chat.engineState = 'ready';
		if (atStart) project.sessions.unshift(s);
		else project.sessions.push(s);
		return s.id;
	}

	#restoreDormant(
		project: Project,
		sid: string,
		title: string,
		backend: BackendId,
		archived: boolean,
		chrome: SavedTabChrome,
		reuseId?: string,
		gateway?: boolean,
		model?: string
	): string {
		const id = this.listDormant(project, { session: sid, title, archived, engine: backend, gateway }, reuseId);
		const s = project.sessions.find((x) => x.id === id)!;
		if (model) s.model = model;
		if (chrome.color) s.color = chrome.color;
		if (chrome.icon) s.icon = chrome.icon;
		return id;
	}

	/** Opens a dormant session's engine (through the daemon). */
	wake(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		const path = this.projectPathOf(id);
		if (!s?.dormant || !path) return;
		s.dormant = false;
		this.#spawn(s, path, undefined, this.#keepModel(s), s.chat.sessionId).catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Drops a session another client removed, without telling the daemon. */
	forget(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (!s.dormant && !s.draft) closeSession(id).catch(() => {});
		unregisterAdapter(id);
		clearDraft(id);
		saveComposerText(id, '');
		dropHeldOps(id);
		const p = this.projects.find((pr) => pr.sessions.includes(s));
		if (p) p.sessions = p.sessions.filter((x) => x !== s);
		if (this.activeId === id) this.activeId = this.shownSessions.find((x) => !x.archived)?.id ?? '';
	}

	/** Adds a project another client created, with no sessions of its own. */
	addProjectShell(project: {
		id: string;
		name: string;
		path: string;
		chats?: boolean;
		worktree?: WorktreeMeta;
		color?: unknown;
		icon?: unknown;
	}) {
		if (this.userProjects.some((x) => x.id === project.id || samePath(x.path, project.path))) return;
		const p: Project = { id: project.id, name: project.name, path: project.path, sessions: [] };
		if (project.chats) p.chats = true;
		if (project.worktree) p.worktree = project.worktree;
		this.setProjectChrome(p, project);
		this.projects.push(p);
	}

	/** Explicit rename; the daemon keeps it over its own titles. A draft's
	 *  rename goes to the daemon when the draft starts. */
	renameSession(id: string, title: string) {
		const s = this.allSessions.find((x) => x.id === id);
		const trimmed = title.trim();
		if (!s || !trimmed) return;
		s.chat.title = trimmed;
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

	/** Set or clear a project folder's color / icon (null or invalid clears).
	 *  An unchanged icon is left as it is, so the daemon's echo saves nothing. */
	setProjectChrome(p: Project, chrome: { color?: unknown; icon?: unknown }) {
		if (chrome.color !== undefined) p.color = normalizeColor(chrome.color);
		if (chrome.icon === undefined) return;
		const icon = parseTabIcon(chrome.icon);
		if (JSON.stringify(icon) !== JSON.stringify(p.icon)) p.icon = icon;
	}

	/** Re-open a persisted conversation in a new session: the daemon reopens
	 *  it by id (one it never hosted, from the directory and the backend) and
	 *  replays its transcript. */
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
		gateway?: boolean,
		model?: string
	) {
		const s = this.#newSession(backend, backend === 'acp' ? acpAgent : undefined, reuseId);
		if (gateway) s.gateway = true;
		if (model) s.model = model;
		if (title) s.chat.title = title;
		s.archived = archived;
		if (chrome?.color) s.color = chrome.color;
		if (chrome?.icon) s.icon = chrome.icon;
		// The engine resumes persisted context — the backend can't be switched
		// even while the replayed transcript is still empty.
		s.restored = true;
		project.sessions.push(s);
		// Known before the engine confirms it: a tab saved (or restarted) before
		// the resumed engine reports its id must keep pointing at the saved
		// conversation, or it comes back as a fresh session next time.
		s.chat.sessionId = sid;
		// The conversation was handed to the native TUI when it was persisted:
		// render the TuiPanel (which resumes by id) and never start the GUI
		// engine beside it — one process per conversation. `returnToGui`
		// starts the engine again later.
		this.#spawn(s, project.path, undefined, this.#keepModel(s), sid).catch((e) => this.#engineFailed(s.chat, e));
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
		this.#makeDraft(s);
		project.sessions.push(s);
		return s.id;
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
	/** `title`: the daemon's for an existing conversation; a new one is named
	 *  by the daemon after its first message. */
	openAgentSession(agent: { id: string; name: string; cwd: string }, sid?: string, title?: string | null) {
		const open = sid && this.allSessions.find((s) => s.chat.sessionId === sid);
		if (open) {
			open.archived = false;
			this.activeId = open.id;
			return open.id;
		}
		// An agent's sessions live in its hidden host (the workbench shows
		// them); a plain hosted session (no agent id) opens in its project.
		let project = agent.id ? this.#agentHost(agent.cwd) : this.userProjects.find((p) => p.path === agent.cwd && !p.worktree);
		if (!project) {
			project = { id: this.uid(), name: base(agent.cwd), path: agent.cwd, sessions: [] };
			this.projects.push(project);
		}
		const s = this.#newSession('jucode');
		if (title) s.chat.title = title;
		if (agent.id) s.chat.agent = agent.id;
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
		s.chat.engineState = 'connecting';
		const text = force
			? t('shell.restarting')
			: reason
				? t('shell.autoRestartingWhy', { reason })
				: t('shell.autoRestarting');
		if (spend) s.chat.messages.push({ kind: 'system', text });
		// The daemon reopens the session's conversation. A resume target the
		// engine can't find ("No conversation found …") makes it exit at once,
		// which would crash-loop re-resuming the same doomed id; when the engine
		// flagged that, forget the id and come up fresh (one-shot: the fresh
		// session gets a new id that CAN be resumed on a later crash).
		if (s.chat.resumeBroken) s.chat.sessionId = '';
		s.chat.resumeBroken = false;
		this.#spawn(s, this.projectPathOf(id), undefined, this.#keepModel(s)).catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Claude Code reopened by id comes back on its default model, not the one
	 *  the conversation ran on: start it on that one. A model pick within the
	 *  session goes through `/model` (or the tool profile) instead. */
	#keepModel(s: Session): Record<string, unknown> | undefined {
		const model = s.backendId === 'claude' ? s.chat.model || s.model : '';
		return model ? { model } : undefined;
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
		// engine back itself; the daemon still reports the close.
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
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({ kind: 'system', text: t('shell.switchingTo', { provider: provider.id, model }) });
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			await this.#spawn(s, this.projectPathOf(id));
			s.chat.switching = false;
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
		// The other profile has other models: what it ran on is not kept.
		s.model = undefined;
		s.chat.model = model ?? '';
		// The TUI surface picks it up when the conversation returns here.
		if (s.surface === 'tui') return;
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.messages.push({
			kind: 'system',
			text: mode === 'jucode' ? t('shell.toolSwitch.toJucode') : t('shell.toolSwitch.toSystem')
		});
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			s.chat.resumeBroken = false;
			await this.#spawn(
				s,
				this.projectPathOf(id),
				model ? () => dispatch(id, { op: 'command', input: `/model ${model}` }) : undefined
			);
			s.chat.switching = false;
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	/**
	 * Switch a claude session INTO yolo (bypassPermissions) by starting it
	 * again: the runtime `set_permission_mode bypassPermissions` control frame
	 * isn't honored (no system/status follow-up), so the daemon reopens the
	 * conversation with `--dangerously-skip-permissions`. Every other mode
	 * switches live and never comes here (see approval.needsClaudeYoloRespawn).
	 */
	async respawnClaudeYolo(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.backendId !== 'claude') return;
		// The close below is intentional — don't let handleExit treat it as a crash.
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			await this.#spawn(s, this.projectPathOf(id), undefined, { permission_mode: 'full-auto', ...this.#keepModel(s) });
			s.chat.switching = false;
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	/**
	 * Rewind a claude conversation to the `userIndex`-th user turn. claude has no
	 * live rewind control frame, so — mirroring the yolo respawn — the daemon
	 * reopens the conversation truncated at the previous turn's assistant message
	 * (`--resume-session-at <uuid>`), and our projected transcript is truncated
	 * to match. A null uuid (rewind to the first turn) starts a new conversation.
	 */
	async rewindClaudeSession(id: string, resumeAtUuid: string | null, userIndex: number) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.backendId !== 'claude') return;
		s.chat.switching = true;
		s.chat.engineState = 'connecting';
		s.chat.truncateToUserTurn(userIndex);
		// Back to before the first turn: a new conversation (the session would
		// otherwise reopen the old one by id).
		if (!resumeAtUuid) s.chat.sessionId = '';
		try {
			await closeSession(id);
			if (this.#gone(s)) return;
			await this.#spawn(
				s,
				this.projectPathOf(id),
				undefined,
				{ ...this.#keepModel(s), ...(resumeAtUuid ? { resume_session_at: resumeAtUuid } : {}) }
			);
			s.chat.switching = false;
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	/** Picks a failed turn back up in place (autoRetry.ts decides when).
	 *  `started`: the engine had begun the turn. JuCode runs the conversation
	 *  again as it stands. A turn that produced nothing is undone and its
	 *  message sent again where the engine can undo (Codex, Claude Code); one
	 *  that did produce something, or that cannot be undone, gets a "continue"
	 *  shown as a note, not as a message. */
	async retryTurn(id: string, note: string, started: boolean) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.dormant || s.draft || s.chat.busy) return;
		const c = s.chat;
		c.clearFailure();
		const last = c.lastUserTurn();
		const output = c.turnHadOutput();
		const auto = c.lastTurnAuto;
		// The note goes in after any undo, which drops what follows the turn.
		const send = (text: string, hidden: boolean) => {
			c.messages.push({ kind: 'system', text: note });
			if (hidden) c.autoContinue(text);
			else c.optimisticUser(text, undefined, true);
			dispatch(id, { op: 'user_message', content: text });
		};
		if (s.backendId === 'jucode') {
			c.messages.push({ kind: 'system', text: note });
			dispatch(id, { op: 'continue' });
			return;
		}
		const plain = !auto && last && !last.images ? last : null;
		// The message never reached the engine: send it again as it was.
		if (!started && plain) {
			c.truncateToUserTurn(plain.index);
			send(plain.text, false);
			return;
		}
		if (!output && (auto || plain) && s.backendId === 'codex') {
			// The daemon holds the message until the rollback is done.
			dispatch(id, { op: 'command', input: '/rewind 1' });
			if (plain) c.truncateToUserTurn(plain.index);
			send(plain ? plain.text : AUTO_CONTINUE, !plain);
			return;
		}
		// Claude Code: a "continue" is not undone. The reply before it may end
		// in a tool call whose result would be cut off by resuming there.
		if (!output && plain && s.backendId === 'claude') {
			// Resumed at the reply before the failed turn (a respawn).
			await this.rewindClaudeSession(id, c.claudeRewindTarget(plain.index), plain.index);
			if (this.#gone(s)) return;
			send(plain.text, false);
			return;
		}
		send(AUTO_CONTINUE, true);
	}

	removeSession(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		// Closing a session's tab removes it from every client's list.
		if (s) this.#share(s, { hidden: true });
		if (!s?.dormant && !s?.draft) closeSession(id).catch(() => {});
		unregisterAdapter(id);
		clearDraft(id);
		dropHeldOps(id);
		const p = this.projects.find((pr) => pr.sessions.some((s) => s.id === id));
		if (p) p.sessions = p.sessions.filter((s) => s.id !== id);
		if (this.activeId === id) this.activeId = this.shownSessions[0]?.id ?? '';
	}

	/** The hidden project an agent working in `cwd` hosts its sessions in. */
	#agentHost(cwd: string): Project {
		let host = this.projects.find((p) => p.agents && p.path === cwd);
		if (!host) {
			host = { id: this.uid(), name: base(cwd), path: cwd, sessions: [], agents: true };
			this.projects.push(host);
		}
		return host;
	}

	/** An agent's session opened before agent sessions moved to the workbench
	 *  (it sits in a user project): move it to its agent's hidden host. */
	adoptAgentSession(id: string, cwd: string) {
		const from = this.projects.find((p) => !p.agents && p.sessions.some((s) => s.id === id));
		if (!from) return;
		const s = from.sessions.find((x) => x.id === id)!;
		from.sessions = from.sessions.filter((x) => x.id !== id);
		this.#agentHost(cwd).sessions.push(s);
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
		this.#staleTabs.delete(p.id);
		if (!this.allSessions.some((s) => s.id === this.activeId)) this.activeId = this.shownSessions[0]?.id ?? '';
	}

	/** Open the project's history: the JuCode conversations saved for its
	 *  directory, as the daemon lists them, as a picker in one of its chats (the active
	 *  one when it is in this project). Only a project with no chat at all gets
	 *  a new one to show it in. */
	async openHistory(p: Project) {
		const active = p.sessions.find((s) => s.id === this.activeId);
		const id = active?.id ?? p.sessions.find((s) => !s.archived)?.id ?? this.addSession(p);
		this.activeId = id;
		const chat = this.allSessions.find((s) => s.id === id)?.chat;
		if (!chat) return;
		try {
			chat.handle({ type: 'resume_view', backend: 'jucode', history: true, items: await this.historyItems(p, chat) });
		} catch (e) {
			chat.messages.push({ kind: 'system', text: t('shell.historyFail', { msg: String(e) }) });
		}
	}

	/** The JuCode conversations saved for the project, as history picker rows. */
	async historyItems(p: Project, chat: ChatState) {
		const sessions = (await sessionHistory(p.path)).filter((x) => x.engine === 'jucode');
		return sessions.map((x) => ({
			id: x.session,
			label: x.title || x.session,
			detail: new Date(x.updated_at).toLocaleString(),
			active: x.session === chat.sessionId
		}));
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
		this.activeId = this.restoreSession(project, sid, title, backend);
	}

	/** The tab was closed (or its workspace swapped out) while an async
	 *  engine switch was awaiting: spawning now would leave an engine nobody
	 *  owns, or replace the one a reopened tab just started. */
	#gone(s: Session): boolean {
		return !this.allSessions.includes(s);
	}

	/** Hand a conversation to its engine's own TUI (same chat tile, `surface`
	 *  flips to 'tui'): the tile renders a TuiPanel on the daemon's terminal
	 *  for this session, and the daemon stops the engine while the TUI runs
	 *  (one process per conversation) with the session's gateway and mode.
	 *  The session stays open for every client. Requires a conversation the
	 *  TUI can resume, so a fresh empty chat and ACP sessions are a no-op. */
	openInTui(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.surface === 'tui' || s.chat.switching || !canHandOffToTui(s.backendId)) return;
		if (!isValidResumeSessionId(s.chat.sessionId) || !(s.chat.resumable || s.restored)) return;
		if (!daemon.sessionOf(id)) return;
		s.surface = 'tui';
	}

	/** Back to the GUI once the TUI has exited: the daemon has started the
	 *  engine again, and its transcript (what the TUI added included)
	 *  replaces what this chat showed. */
	returnToGui(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.surface !== 'tui') return;
		s.surface = 'gui';
		s.chat.switching = false;
		s.chat.keepNextTranscript = false;
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
		return this.userProjects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			...(p.worktree ? { worktree: p.worktree } : {}),
			...(p.chats ? { chats: true } : {}),
			...(p.lastBackend && p.lastBackend !== 'jucode' ? { lastBackend: p.lastBackend } : {}),
			...(p.lastBackend === 'acp' && p.lastAcpAgent ? { lastAcpAgent: p.lastAcpAgent } : {}),
			...(p.color ? { color: p.color } : {}),
			...(p.icon ? { icon: p.icon } : {}),
			tabs: p.stale
				? (this.#staleTabs.get(p.id) ?? [])
				: p.sessions.map((s) => ({
					id: s.id,
					// A session exists in the daemon from its first moment, so its id
					// is always worth keeping.
					...(s.chat.sessionId ? { sid: s.chat.sessionId } : {}),
					...(s.gateway ? { gateway: true } : {}),
					...(s.backendId === 'claude' && (s.chat.model || s.model) ? { model: s.chat.model || s.model } : {}),
					title: s.chat.title,
					...(s.backendId !== 'jucode' ? { backend: s.backendId } : {}),
					...(s.backendId === 'acp' && s.acpAgent ? { acpAgent: s.acpAgent } : {}),
					...(s.archived ? { archived: true } : {}),
					...(s.pinned ? { pinned: true } : {}),
					...(s.color ? { color: s.color } : {}),
					...(s.icon ? { icon: s.icon } : {}),
				}))
		}));
	}

	/** Restores saved tabs into `proj` (dormant, resumed or as drafts). */
	#restoreTabs(proj: Project, tabs: NonNullable<SavedProject['tabs']>) {
		for (const t of tabs) {
			// Workspace data is user-editable. Invalid ids must never
			// reach either a GUI resume or the TUI pty argv.
			const sid =
				typeof t.sid === 'string' && isValidResumeSessionId(t.sid) ? t.sid : undefined;
			if (!sid && !t.id) continue;
			// Already open: the same tab in a duplicated project entry.
			if (this.allSessions.some((s) => (t.id && s.id === t.id) || (sid && s.chat.sessionId === sid))) continue;
			// Tabs saved before multi-backend support carry no backend field →
			// jucode (normalizeBackendId maps unknown/missing to the default).
			// Chrome fields are re-validated here (the file is user-editable).
			let backend = normalizeBackendId(t.backend);
			// An 'acp' tab needs its agent back to respawn; older files carry
			// none on the tab → fall back to the project's last agent. Without
			// any, never start a bare 'acp' (there is no command to run).
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
				icon: parseTabIcon(t.icon)
			};
			// With a conversation to resume, resume it; an empty window comes
			// back as a draft. Both keep the saved desktop id (pre-id files mint anew).
			// A tab left in the TUI comes back in the GUI: its terminal ended
			// with the connection, and the daemon resumed the engine.
			const surface = undefined;
			// The conversation waits in the daemon: list it now and open it
			// when it is shown (ACP needs its agent start path below).
			const dormant = sid && !surface && backend !== 'acp';
			const id = dormant
				? this.#restoreDormant(proj, sid, t.title, backend, !!t.archived, chrome, t.id, t.gateway === true, t.model)
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
						t.gateway === true,
						t.model
					)
				: this.#draftSaved(proj, t.id!, t.title, backend, !!t.archived, chrome, acpAgent);
			if (t.pinned === true) proj.sessions.find((s) => s.id === id)!.pinned = true;
		}
	}

	/** Restore saved projects + their open conversations, or seed a default
	 *  project on first run. Sets `loaded` when done. A worktree project whose
	 *  directory has vanished (task finished elsewhere / dir deleted) is kept in
	 *  the list as `stale` — no sessions are spawned into a dead cwd — so the
	 *  sidebar can offer a remove-from-list affordance instead of crashing. */
	async restore(saved: SavedProject[]) {
		if (saved.length) {
			for (const p of saved) {
				// The same project twice (a file an older version wrote while a
				// daemon list raced the restore): one entry, both entries' tabs.
				const known = this.userProjects.find((x) => x.id === p.id || samePath(x.path, p.path));
				if (known) {
					if (known.stale) this.#staleTabs.set(known.id, [...(this.#staleTabs.get(known.id) ?? []), ...(p.tabs ?? [])]);
					else this.#restoreTabs(known, p.tabs ?? []);
					continue;
				}
				const proj: Project = { id: p.id, name: p.name, path: p.path, sessions: [] };
				if (p.chats === true) proj.chats = true;
				this.setProjectChrome(proj, p);
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
				if (proj.stale) {
					this.#staleTabs.set(proj.id, p.tabs ?? []);
					continue;
				}
				// Pushed proxies are new objects: restore into the tree's copy.
				this.#restoreTabs(this.projects[this.projects.length - 1], p.tabs ?? []);
			}
			const first = this.shownSessions.find((s) => !s.archived)?.id;
			const firstLive = this.shownProjects.find((p) => !p.stale);
			this.activeId = first || (firstLive && this.addSession(firstLive)) || '';
		} else {
			const root = await projectRoot();
			this.projects.push({ id: this.uid(), name: base(root), path: root, sessions: [] });
			this.addSession(this.projects[0]);
		}
		this.loaded = true;
	}
}
