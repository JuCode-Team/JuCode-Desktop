import { AUTO_CONTINUE, ChatState, UNTITLED } from './chat.svelte';
import { acpAgentsList, closeSession, daemon, hostSession, sessionMeta, sessionHistory, projectRoot, chatsDir, writeConfig, git, worktreeCreate, worktreeRestore } from './protocol';
import { slugifyTaskName } from './gitops';
import { probeEngine } from './engineProbe';
import { DaemonError, type EngineSpec } from './daemon';
import { canHandOffToTui, isValidResumeSessionId, presetOf } from './tuiHandoff';
import { caps, normalizeBackendId, type BackendId } from './backends';
import { createJucodeAdapter } from './backends/jucode';
import { clearAsleep, clearDraft, dispatch, dropHeldOps, holdOps, ioFor, isAsleep, markAsleep, markDraft, registerAdapter, startDraft, unregisterAdapter } from './backends/router';
import { buildBackendOpts, defaultBackendFor } from './backends/settings';
import { toEngineMode } from './approval';
import { t } from '$lib/i18n';
import { prefs } from './prefs.svelte';
import { saveComposerText } from './composerText';
import { toast } from './ui/toast.svelte';
import { telemetry } from './telemetry.svelte';
import { normalizeColor, parseTabIcon, type TabIcon } from './workbench/tabChrome';
import { CHATS_ENABLED, LOOSE_ID, type AcpAgentRef, type Project, type Session, type WorktreeMeta } from './types';

/** Optional per-tab chrome persisted alongside the session id + title. */
export interface SavedTabChrome {
	color?: string;
	icon?: TabIcon;
}

// The persisted shape of a project + its open tabs. `id` is the desktop
// session id (stable across restore so layout chat tiles keep matching);
// `sid` is the engine conversation to resume, present only when the engine
// actually persisted one.
/** A saved session of a project or of a workspace's no-project group. */
export type SavedTab = {
	id?: string;
	sid?: string;
	title: string;
	backend?: string;
	/** backend 为 'acp' 时：驱动该会话的 ACP agent（内置预设或注册表条目，重启动/恢复时必需）。 */
	acpAgent?: AcpAgentRef;
	archived?: boolean;
	pinned?: boolean;
	/** The conversation was handed to the native TUI (resume by `sid`).
	 *  Omitted for the default GUI surface so old layouts stay clean. */
	surface?: 'tui';
	/** Claude Code / Codex / an ACP preset through the JuCode gateway (Session.gateway). */
	gateway?: boolean;
	/** Claude Code: the model it last ran on (Session.model). */
	model?: string;
	/** Its own working directory (Session.cwd). */
	cwd?: string;
	/** Session.forkedFrom. */
	forkedFrom?: { sid: string; title: string; turns: number };
	/** Session.keptAt. */
	keptAt?: number;
	/** Session.worktree. */
	worktree?: WorktreeMeta;
} & SavedTabChrome;

export interface SavedProject extends SavedTabChrome {
	id: string;
	name: string;
	path: string;
	tabs?: SavedTab[];
	/** 并行任务 worktree 项目的元数据（isWorktree/mainRepoPath/branch/baseBranch/slug）。 */
	worktree?: WorktreeMeta;
	/** 本项目最近一次新建会话所用的引擎后端（缺省 = jucode）。 */
	lastBackend?: string;
	/** lastBackend 为 'acp' 时：上次选择的 ACP agent。 */
	lastAcpAgent?: AcpAgentRef;
	/** 对话分组（见 Project.chats）。 */
	chats?: boolean;
	/** 附加目录（见 Project.dirs）。 */
	dirs?: string[];
	/** Project.setup. */
	setup?: string;
}

/** Waits between attempts to reach an unreachable daemon, ms (~4.5 min). */
const DAEMON_RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000, 30000, 30000];

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
/** A Unix, drive-letter or UNC absolute path (the daemon takes no other). */
const isAbsolute = (p: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p);

function savedTab(s: Session): SavedTab {
	return {
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
		...(s.cwd ? { cwd: s.cwd } : {}),
		...(s.forkedFrom ? { forkedFrom: s.forkedFrom } : {}),
		...(s.keptAt ? { keptAt: s.keptAt } : {}),
		...(s.worktree ? { worktree: s.worktree } : {}),
		...(s.color ? { color: s.color } : {}),
		...(s.icon ? { icon: s.icon } : {})
	};
}
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

/** A saved ACP agent (user-editable file), re-validated. */
function acpAgentRef(a: AcpAgentRef | undefined): AcpAgentRef | undefined {
	if (!a || typeof a.id !== 'string' || typeof a.name !== 'string') return undefined;
	return { id: a.id, name: a.name, ...(a.preset === true ? { preset: true } : {}) };
}

/** A project's sessions as the sidebar lists them: pinned first, each group
 *  in the project's own order (new sessions join at the start); archived
 *  ones are left out, and so are drafts: one joins the list with its first
 *  message, and until then only its tab shows it. */
export function listedSessions(p: Project): Session[] {
	const live = p.sessions.filter((s) => !s.archived && !s.draft);
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
	/** Sessions of projects taken off this window (switching workspaces), by
	 *  daemon session id: they come back as they were, with the token totals,
	 *  context and timings that the daemon's replay does not carry. */
	#parked = new Map<string, Session>();
	/** Drafts taken off this window, by desktop id: they come back with
	 *  their picks (model, effort, folder). */
	#parkedDrafts = new Map<string, Session>();
	uid() {
		return `s${Date.now().toString(36)}-${(this.#counter++).toString(36)}`;
	}

	get allSessions() {
		return this.projects.flatMap((p) => p.sessions);
	}
	/** The group of sessions that belong to no project, once there is one. */
	get loose(): Project | undefined {
		return this.projects.find((p) => p.loose);
	}
	/** The loose group, added on first use. */
	looseGroup(): Project {
		if (!this.loose) this.projects.push({ id: LOOSE_ID, name: '', path: '', loose: true, sessions: [] });
		return this.loose!;
	}
	/** The projects of this workspace (not the chats or loose groups). */
	get workspaceProjects() {
		return this.projects.filter((p) => !p.chats && !p.loose);
	}
	/** Called before a new session is created in the daemon: resolves once
	 *  the daemon knows this window's projects (one just added included). */
	projectsSynced: () => Promise<void> = () => Promise.resolve();
	/** Projects the UI shows: a hidden chats group stays in the tree (and in
	 *  the saved and daemon lists) but is never listed or opened. */
	get shownProjects() {
		return this.projects.filter((p) => (CHATS_ENABLED || !p.chats) && !p.loose);
	}
	/** Sessions the UI shows: of shown projects and of no project. */
	get shownSessions() {
		return this.projects.filter((p) => CHATS_ENABLED || !p.chats).flatMap((p) => p.sessions);
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

	/** The project (or the loose group) holding session `id`. */
	ownerOf(id: string): Project | undefined {
		return this.projects.find((p) => p.sessions.some((s) => s.id === id));
	}

	/** The directory session `id` works in: its own, else its project's. */
	cwdOf(id: string): string | undefined {
		const p = this.ownerOf(id);
		return p?.sessions.find((s) => s.id === id)?.cwd || p?.path || undefined;
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
		// or stacking an error per attempt. An error the daemon replied with
		// (e.g. the engine's program not found) is shown as is.
		if (
			s &&
			s.surface !== 'tui' &&
			!(e instanceof DaemonError) &&
			chat.daemonRetries < DAEMON_RETRY_DELAYS.length
		) {
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
	 *  ACP agent backs the session, for spawn opts and display. `reuseId`
	 *  re-applies a persisted desktop id (layout chat tiles key on it) unless
	 *  this run already spawned it. */
	#newSession(backendId: BackendId, acpAgent?: AcpAgentRef, reuseId?: string): Session {
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
	 *  to reopen when it is not the session's own. The daemon translates
	 *  every engine into jucode
	 *  events, so the session's adapter is the jucode one. */
	async #spawn(
		s: Session,
		cwd: string | undefined,
		after?: () => void,
		extraOpts?: Record<string, unknown>,
		resume?: string
	) {
		// A session in a worktree deleted outside the app gets it back first.
		if (s.worktree && s.cwd) {
			holdOps(s.id);
			await this.#ensureWorktree(s);
		}
		return this.#spawnNow(s, s.cwd || cwd, after, extraOpts, resume);
	}

	/** A session's worktree, there again: checked out from its branch when
	 *  its folder went away; with its branch gone too, the session goes on in
	 *  its project's folder, saying so. */
	async #ensureWorktree(s: Session) {
		const wt = s.worktree!;
		const path = s.cwd!;
		try {
			await git(['rev-parse', '--show-toplevel'], path);
			return;
		} catch {
			/* gone: put it back */
		}
		try {
			await worktreeRestore(wt.mainRepoPath, path, wt.branch);
			s.chat.messages.push({ kind: 'system', text: t('chat.worktree.restored', { name: wt.slug }) });
		} catch (e) {
			s.chat.messages.push({ kind: 'error', text: t('chat.worktree.gone', { name: wt.slug, msg: String(e) }) });
			s.cwd = undefined;
			s.worktree = undefined;
		}
	}

	#spawnNow(
		s: Session,
		cwd: string | undefined,
		after?: () => void,
		extraOpts?: Record<string, unknown>,
		resume?: string
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
		// Whatever starts it (a wake, a provider switch, a restart), a session
		// asleep is not any more.
		clearAsleep(s.id);
		if (s.dormant) s.dormant = false;
		s.chat.restarting = true;
		// Background tasks belong to the engine process being replaced.
		s.chat.bgTasks = [];
		s.chat.taskOutputs = {};
		// What this chat already shows of a claude or ACP conversation is richer
		// than the daemon's replay of it.
		// A session coming back to this window takes the replay: its conversation
		// may have gone on meanwhile.
		if (
			(s.backendId === 'claude' || s.backendId === 'acp') &&
			!s.chat.rejoining &&
			s.chat.messages.some((m) => m.kind === 'user')
		)
			s.chat.keepNextTranscript = true;
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
							...(typeof extraOpts?.tool_provider === 'string' ? { tool_provider: extraOpts.tool_provider } : {}),
							...(extraOpts?.resume_session_at ? { resume_at: extraOpts.resume_session_at } : {}),
							...(extraOpts?.fork_from ? { fork_from: extraOpts.fork_from } : {}),
							// A restarted engine keeps the session's settings.
							...(s.chat.ultracode ? { ultracode: true } : {}),
							...(s.chat.fast ? { fast: true } : {}),
							...(s.chat.effort ? { effort: s.chat.effort } : {}),
							...(!prefs.thinkingSummaries ? { thinking: false } : {})
						}
					})
				: s.backendId === 'codex'
					? Promise.resolve({
							engine: 'codex',
							options: {
								approval_mode: mode,
								...gateway,
								...program,
								...(typeof extraOpts?.tool_provider === 'string' ? { tool_provider: extraOpts.tool_provider } : {}),
								// A restarted engine keeps the session's switches.
								...(s.chat.fast ? { fast: true } : {}),
								...(extraOpts?.fork_from ? { fork_from: extraOpts.fork_from, fork_turns: extraOpts.fork_turns } : {}),
								...(!prefs.thinkingSummaries ? { thinking: false } : {})
							}
						})
					: s.backendId === 'acp' && s.acpAgent?.preset
						? // A built-in agent: the daemon resolves its command from the id.
							Promise.resolve({
								engine: 'acp',
								options: {
									agent: s.acpAgent.id,
									approval_mode: mode,
									...gateway,
									...(extraOpts?.model ? { model: extraOpts.model } : {}),
									...(extraOpts?.effort ? { effort: extraOpts.effort } : {})
								}
							})
					: s.backendId === 'acp'
						? // A custom agent runs the command its registry entry names.
							acpAgentsList().then((agents) => {
								const entry = agents.find((a) => a.id === s.acpAgent?.id);
								if (!entry) throw new Error(`unknown ACP agent ${s.acpAgent?.id ?? ''}`);
								return {
									engine: 'acp',
									// The agent's own environment wins over the backend's.
									options: {
										command: entry.command,
										args: entry.args,
										env: { ...(base?.env ?? {}), ...entry.env },
										...(extraOpts?.model ? { model: extraOpts.model } : {}),
										...(extraOpts?.effort ? { effort: extraOpts.effort } : {})
									}
								};
							})
						: // JuCode's own engine takes no options, except a fork's.
							extraOpts?.fork_from
							? Promise.resolve({ engine: 'jucode', options: { fork_from: extraOpts.fork_from, fork_turns: extraOpts.fork_turns, ...(extraOpts.fork_cwd ? { fork_cwd: extraOpts.fork_cwd } : {}) } })
							: Promise.resolve(undefined);
		const reopen = resume ?? (s.chat.sessionId || undefined);
		const owner = this.ownerOf(s.id);
		// A new session names its project (a chat's is the chats folder's).
		const project = reopen || !owner || owner.chats ? undefined : owner.loose ? '' : owner.id;
		return engine
			.then((spec) => (project ? this.projectsSynced().then(() => spec) : spec))
			.then((spec) =>
				hostSession(s.id, cwd ?? '', reopen, chat, spec, project).then(() => {
					// A new session is named by the daemon (the engine's conversation id).
					if (!s.chat.sessionId) {
						s.chat.sessionId = daemon.sessionOf(s.id) ?? '';
						// A group picked while it was a draft goes in with its id.
						if (s.group) this.#share(s, { group: s.group });
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
	 *  falls back to the native engine). `cwd`: where it works, when not in
	 *  the project's folder (a session of no project needs one). */
	addSession(
		project: Project,
		firstMessage?: string,
		backend?: BackendId,
		acpAgent?: AcpAgentRef,
		cwd?: string
	) {
		// Only the jucode engine has a chat mode.
		let backendId = project.chats ? 'jucode' : (backend ?? defaultBackendFor(project.lastBackend));
		let agent = backendId === 'acp' ? (acpAgent ?? project.lastAcpAgent) : undefined;
		if (backendId === 'acp' && !agent) {
			backendId = 'jucode'; // no agent to launch — never spawn a bare 'acp'
			agent = undefined;
		}
		const s = this.#newSession(backendId, agent);
		if (cwd && !samePath(cwd, project.path)) s.cwd = cwd;
		// Listed among the latest until the daemon says when it last changed.
		s.updatedAt = Date.now();
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

	/** A new session of no project, working in `cwd`. */
	addLooseSession(cwd: string, backend?: BackendId) {
		return this.addSession(this.looseGroup(), undefined, backend, undefined, cwd);
	}

	/** A new session that opens in its backend's TUI: its engine starts at
	 *  once (the TUI takes over the daemon session), and the TUI starts the
	 *  conversation. */
	addTuiSession(project: Project, backend: BackendId, cwd?: string) {
		const id = this.addSession(project, undefined, backend, undefined, cwd);
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
		// Its menus from what the agent offers now, when that was not known
		// lately (engineProbe): the draft takes the answer while still a draft.
		if (s.backendId === 'jucode') return;
		const { id, chat } = s;
		void probeEngine(s.backendId, s.acpAgent).then((changed) => {
			const now = this.allSessions.find((x) => x.id === id);
			if (changed && now?.draft && now.chat === chat) chat.seedFromProfile();
		});
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
		// An ACP agent takes no /model before its conversation opens: the
		// picks are start options it applies once open.
		const acp = s.backendId === 'acp';
		// The model and effort picked while a draft go first; the held first
		// message follows.
		const applyPick = () => {
			if (acp || !pick || !model) return;
			const effort = pick.effort ?? '';
			dispatch(s.id, { op: 'command', input: effort ? `/model ${model} ${effort}` : `/model ${model}` });
		};
		// Claude Code / Codex off the gateway: the custom provider picked (the
		// daemon takes the tool's default otherwise, and keeps it after).
		const provider = s.draftToolProvider;
		s.draftToolProvider = undefined;
		const startOpts =
			acp && pick
				? { ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) }
				: provider !== undefined && !s.gateway
					? { tool_provider: provider }
					: undefined;
		const go = () =>
			this.#spawn(s, s.cwd || project.path, applyPick, startOpts)
				.then(() => {
					// Renamed while a draft, before it had a daemon session.
					if (s.chat.title !== UNTITLED) this.#share(s, { title: s.chat.title });
				})
				.catch((e) => this.#engineFailed(s.chat, e));
		const want = s.draftWorktree;
		s.draftWorktree = undefined;
		if (!want) return void go();
		void this.#makeWorktree(s, project, want.base).then((made) => {
			if (made) void go();
		});
	}

	/** Gives a new worktree its name from the session's first message (the
	 *  page sets it: a one-shot model call). */
	static nameWorktree: ((message: string) => Promise<string>) | null = null;
	/** A session's new worktree is ready (the page runs the project's setup
	 *  script in it). */
	static onWorktree: ((s: Session, project: Project) => void) | null = null;

	/** The worktree a draft chose, made as its first message goes: named
	 *  from that message (else from the time), from `base`. When it cannot be
	 *  made the session is a draft again, its message back in the composer. */
	async #makeWorktree(s: Session, project: Project, base: string): Promise<boolean> {
		const first = s.chat.messages.find((m) => m.kind === 'user');
		const text = first?.kind === 'user' ? first.text : '';
		const note = { kind: 'system' as const, text: t('chat.worktree.creating') };
		s.chat.messages.push(note);
		const named = SessionStore.nameWorktree && text ? await Promise.race([SessionStore.nameWorktree(text).catch(() => ''), new Promise<string>((r) => setTimeout(() => r(''), 8000))]) : '';
		const slug = slugifyTaskName(named) || `task-${Date.now().toString(36)}`;
		try {
			const wt = await worktreeCreate(project.path, slug, base, prefs.worktreeFromOrigin);
			s.cwd = wt.path;
			s.worktree = { isWorktree: true, mainRepoPath: project.path, branch: wt.branch, baseBranch: wt.base, slug: wt.slug };
			s.chat.messages = s.chat.messages.map((m) => (m === note ? { kind: 'system', text: t('chat.worktree.created', { name: wt.slug, branch: wt.branch, base: wt.base }) } : m));
			SessionStore.onWorktree?.(s, project);
			return true;
		} catch (e) {
			s.chat.messages = s.chat.messages.filter((m) => m !== note && m !== first);
			s.chat.messages.push({ kind: 'error', text: t('chat.worktree.failed', { msg: String(e) }) });
			s.draftWorktree = { base };
			this.#makeDraft(s);
			if (text) s.chat.pendingFill = text;
			return false;
		}
	}

	/** A draft goes on in a new worktree from local branch `base` (made with
	 *  its first message), or (null) where it was. */
	setDraftWorktree(id: string, base: string | null) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s?.draft) return;
		s.draftWorktree = base ? { base } : undefined;
		s.worktree = undefined;
		if (base) s.cwd = undefined;
	}

	/** A draft goes on in an existing worktree. */
	useWorktree(id: string, path: string, meta: WorktreeMeta) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s?.draft) return;
		s.draftWorktree = undefined;
		s.cwd = path;
		s.worktree = meta;
	}

	/**
	 * Switch a fresh session (no user turn yet) to a different engine backend,
	 * in place: same tab, same session id. There is no conversation to carry
	 * over, so the old engine is torn down and a new adapter + child is brought
	 * up; ChatState is rebuilt because everything it holds is engine-specific
	 * (model catalog, commands, session id…). No-op once the first user message
	 * has been sent — the conversation can't move engines.
	 */
	async switchBackend(id: string, backend: BackendId, acpAgent?: AcpAgentRef) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (
			s.backendId === backend &&
			(backend !== 'acp' || (s.acpAgent?.id === acpAgent?.id && !!s.acpAgent?.preset === !!acpAgent?.preset))
		)
			return;
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
	#redraft(s: Session, backend: BackendId, acpAgent?: AcpAgentRef) {
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
		s.keptAt = Date.now();
		this.#share(s, { archived: false });
	}

	/** Pin or unpin a session. Desktop only: the daemon keeps no such flag. */
	setPinned(id: string, pinned: boolean) {
		const s = this.allSessions.find((x) => x.id === id);
		if (s) s.pinned = pinned || undefined;
	}

	/** A new conversation not started yet (a draft) moves to another
	 *  project: it starts there, in that project's directory. Moved out of
	 *  any project (LOOSE_ID), it keeps the directory it had. */
	moveDraft(id: string, projectId: string) {
		const from = this.ownerOf(id);
		const to = projectId === LOOSE_ID ? this.looseGroup() : this.projects.find((p) => p.id === projectId && !p.chats && !p.stale && !p.loose);
		const s = from?.sessions.find((x) => x.id === id);
		if (!from || !to || !s?.draft || from === to) return;
		s.cwd = to.loose ? s.cwd || from.path : undefined;
		from.sessions = from.sessions.filter((x) => x !== s);
		to.sessions.unshift(s);
		if (!to.loose) to.lastBackend = s.backendId;
	}

	/** A draft starts in `dir` instead of its project's folder. */
	setDraftCwd(id: string, dir: string) {
		const p = this.ownerOf(id);
		const s = p?.sessions.find((x) => x.id === id);
		if (!p || !s?.draft || !isAbsolute(dir)) return;
		s.cwd = samePath(dir, p.path) ? undefined : dir;
	}

	/** A session moves to another project of this window, or out of any
	 *  (LOOSE_ID); it keeps working where it did. A draft goes with
	 *  `moveDraft`. */
	moveToProject(id: string, projectId: string) {
		const from = this.ownerOf(id);
		const s = from?.sessions.find((x) => x.id === id);
		if (s?.draft) return this.moveDraft(id, projectId);
		const to = projectId === LOOSE_ID ? this.looseGroup() : this.workspaceProjects.find((p) => p.id === projectId && !p.stale);
		if (!from || !s || !to || from === to) return;
		this.#place(s, from, to, s.cwd || from.path);
		this.#share(s, { project: to.loose ? '' : to.id });
	}

	/** Moves `s` from `from` to the start of `to`, working in `cwd`. */
	#place(s: Session, from: Project, to: Project, cwd: string | undefined) {
		s.cwd = cwd && !samePath(cwd, to.path) ? cwd : undefined;
		from.sessions = from.sessions.filter((x) => x !== s);
		to.sessions.unshift(s);
	}

	/** A daemon session another client moved: to `projectId` of this window
	 *  (null: of no project), working in `cwd`. */
	followProject(id: string, projectId: string | null, cwd: string) {
		const from = this.ownerOf(id);
		const s = from?.sessions.find((x) => x.id === id);
		const to = projectId === null ? this.looseGroup() : this.workspaceProjects.find((p) => p.id === projectId);
		if (!from || !s || !to || from === to) return;
		this.#place(s, from, to, cwd);
	}

	/** Takes a session off this window without ending it (it moved to a
	 *  project of another workspace): it comes back as it was there. */
	park(id: string) {
		const p = this.ownerOf(id);
		const s = p?.sessions.find((x) => x.id === id);
		if (!p || !s) return;
		if (!s.dormant && !s.draft) daemon.detach(s.id);
		unregisterAdapter(s.id);
		this.#keep(s);
		p.sessions = p.sessions.filter((x) => x !== s);
		if (this.activeId === id) this.activeId = this.shownSessions.find((x) => !x.archived)?.id ?? '';
	}

	/** A session's title, archive state or removal goes to the daemon, which
	 *  every other client follows. */
	#share(s: Session, changes: { title?: string; archived?: boolean; hidden?: boolean; group?: string; project?: string }) {
		if (s.chat.sessionId) sessionMeta(s.chat.sessionId, changes).catch(() => {});
	}

	/** A session taken off this window, kept to come back as it was: the
	 *  ops held for its engine stay, and go once it is back and started. A
	 *  draft starts anew when it is back (`#draftSaved`). */
	#keep(s: Session) {
		if (s.draft) {
			clearDraft(s.id);
			this.#parkedDrafts.set(s.id, s);
		} else if (s.chat.sessionId) this.#parked.set(s.chat.sessionId, s);
		// Nothing to come back by.
		else clearDraft(s.id);
	}

	/** A kept session of daemon session `sid`, back in this window. */
	#unpark(sid: string): Session | undefined {
		const s = this.#parked.get(sid);
		if (!s) return;
		this.#parked.delete(sid);
		registerAdapter(s.id, s.adapter);
		s.chat.rejoining = true;
		return s;
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
			/** `acp`: the built-in agent it runs. */
			agent?: string | null;
			group?: string | null;
			gateway?: boolean;
			/** Where it works (left out: the project's folder). */
			cwd?: string;
			/** The worktree it works in, when the daemon made one. */
			worktree?: WorktreeMeta;
		},
		reuseId?: string,
		atStart = false
	): string {
		const cwd = rec.cwd && !samePath(rec.cwd, project.path) ? rec.cwd : undefined;
		const parked = this.#unpark(rec.session);
		if (parked) {
			parked.cwd = cwd;
			if (rec.worktree) parked.worktree = rec.worktree;
			parked.dormant = true;
			parked.archived = !!rec.archived;
			if (rec.title) parked.chat.title = rec.title;
			if (atStart) project.sessions.unshift(parked);
			else project.sessions.push(parked);
			return parked.id;
		}
		const agent = rec.engine === 'acp' && rec.agent ? { id: rec.agent, name: rec.agent, preset: true } : undefined;
		const s = this.#newSession(normalizeBackendId(rec.engine), agent, reuseId);
		if (rec.gateway) s.gateway = true;
		if (cwd) s.cwd = cwd;
		if (rec.worktree) s.worktree = rec.worktree;
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

	/** Opens a dormant session's engine (through the daemon); resolves once
	 *  it is up. */
	wake(id: string): Promise<void> | undefined {
		const s = this.allSessions.find((x) => x.id === id);
		const path = this.cwdOf(id);
		if (!s?.dormant || !path) return;
		return this.#spawn(s, path, undefined, this.#keepModel(s), s.chat.sessionId).catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Drops a session another client removed, without telling the daemon. */
	forget(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (!s.dormant && !s.draft) closeSession(id).catch(() => {});
		unregisterAdapter(id);
		clearDraft(id);
		saveComposerText(id, '');
		ChatState.forgetRunTime(id);
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
		dirs?: unknown;
	}) {
		if (this.projects.some((x) => x.id === project.id || samePath(x.path, project.path))) return;
		const p: Project = { id: project.id, name: project.name, path: project.path, sessions: [] };
		if (project.chats) p.chats = true;
		this.setProjectDirs(p, project.dirs);
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

	/** A new session that goes on from session `id`'s first `keep` turns,
	 *  beside it in its project, or in a worktree made for it (`worktree`:
	 *  its directory, already checked out, opened as a project of its own);
	 *  the original stays as it is. The engine
	 *  forks its conversation (`fork_from`): Claude Code resumes it at the
	 *  turn's last reply as a new one, Codex forks the thread through the
	 *  turn, JuCode copies the session's turns. Until the engine replays it,
	 *  the new session shows the turns copied from this one. */
	forkSession(id: string, keep: number, worktree?: { path: string; meta: WorktreeMeta }) {
		const src = this.allSessions.find((x) => x.id === id);
		const project = this.ownerOf(id);
		const from = src?.chat.sessionId;
		if (!src || !project || !from || !caps(src.chat).fork) return;
		// Claude Code resumes at a reply's id: one not known here (a reply
		// from before replies carried it) would fork the whole conversation.
		const at = src.backendId === 'claude' ? src.chat.claudeRewindTarget(keep) : null;
		if (src.backendId === 'claude' && !at && keep < src.chat.userTurns) {
			toast.error(t('chat.msg.forkUnknown'));
			return;
		}
		const s = this.#newSession(src.backendId);
		const fromCwd = this.cwdOf(id);
		// In a worktree, its own (in the same project); else where the original works.
		if (worktree) {
			s.cwd = worktree.path;
			s.worktree = worktree.meta;
		} else if (src.cwd) {
			s.cwd = src.cwd;
			if (src.worktree) s.worktree = src.worktree;
		}
		s.forkedFrom = { sid: from, title: src.chat.title, turns: keep };
		if (src.gateway !== undefined) s.gateway = src.gateway;
		if (src.model) s.model = src.model;
		s.chat.approvalMode = src.chat.approvalMode;
		s.chat.title = t('chat.msg.forkTitle', { title: src.chat.title || UNTITLED });
		// Its engine goes on from this conversation: no other backend.
		s.restored = true;
		s.updatedAt = Date.now();
		let users = 0;
		const upTo = src.chat.messages.findIndex((m) => m.kind === 'user' && users++ === keep);
		s.chat.messages = $state.snapshot(src.chat.messages.slice(0, upTo < 0 ? undefined : upTo)) as typeof src.chat.messages;
		project.sessions.splice(project.sessions.indexOf(src) + 1, 0, s);
		this.activeId = s.id;
		// JuCode keeps sessions by directory: a fork elsewhere reads it from the original's.
		const fork =
			src.backendId === 'claude'
				? { fork_from: from, ...(at ? { resume_session_at: at } : {}) }
				: { fork_from: from, fork_turns: keep, ...(worktree && fromCwd ? { fork_cwd: fromCwd } : {}) };
		this.#spawn(s, this.cwdOf(s.id), undefined, { ...this.#keepModel(src), ...fork })
			.then(() => this.renameSession(s.id, s.chat.title))
			.catch((e) => this.#engineFailed(s.chat, e));
		return s.id;
	}

	/** Set a project's extra directories (only absolute paths; none clears).
	 *  An unchanged list is left as it is, so the daemon's echo saves nothing. */
	setProjectDirs(p: Project, dirs: unknown) {
		const list = Array.isArray(dirs)
			? [...new Set(dirs.filter((d): d is string => typeof d === 'string' && isAbsolute(d)))]
			: [];
		const next = list.length ? list : undefined;
		if (JSON.stringify(next) !== JSON.stringify(p.dirs)) p.dirs = next;
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
		acpAgent?: AcpAgentRef,
		surface?: 'tui',
		gateway?: boolean,
		model?: string,
		cwd?: string
	) {
		const s = this.#unpark(sid) ?? this.#newSession(backend, backend === 'acp' ? acpAgent : undefined, reuseId);
		if (gateway) s.gateway = true;
		if (model) s.model = model;
		if (cwd && !samePath(cwd, project.path)) s.cwd = cwd;
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
		this.#spawn(s, s.cwd || project.path, undefined, this.#keepModel(s), sid).catch((e) => this.#engineFailed(s.chat, e));
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
		acpAgent?: AcpAgentRef
	) {
		const kept = this.#parkedDrafts.get(reuseId);
		if (kept) {
			this.#parkedDrafts.delete(reuseId);
			registerAdapter(kept.id, kept.adapter);
			markDraft(kept.id, () => this.#startDraft(kept.id));
			project.sessions.push(kept);
			return kept.id;
		}
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

	/** Show daemon session `sid` (one the daemon hosts in `cwd`) in its
	 *  open tab or a new one, in its `project` (null: none; left out or not
	 *  in this window: the project whose folder is `cwd`, else none).
	 *  `title`, `engine`, `gateway`, `agent`: the daemon's record of it.
	 *  `activate`: false lists it without switching to it. */
	openDaemonSession(cwd: string, sid: string, title?: string | null, engine?: string, gateway?: boolean, agent?: string | null, activate = true, project?: string | null) {
		const open = this.allSessions.find((s) => s.chat.sessionId === sid);
		if (open) {
			open.archived = false;
			if (activate) this.activeId = open.id;
			return open.id;
		}
		const home =
			(project === null ? this.looseGroup() : undefined) ??
			(project ? this.workspaceProjects.find((p) => p.id === project) : undefined) ??
			this.workspaceProjects.find((p) => samePath(p.path, cwd) && !p.worktree) ??
			this.looseGroup();
		// The daemon holds the conversation and reopens it on its own engine.
		const preset = engine === 'acp' && agent ? { id: agent, name: agent, preset: true } : undefined;
		const s = this.#newSession(normalizeBackendId(engine), preset);
		if (gateway) s.gateway = true;
		if (title) s.chat.title = title;
		s.restored = true;
		s.chat.sessionId = sid;
		if (cwd && !samePath(cwd, home.path)) s.cwd = cwd;
		home.sessions.push(s);
		if (activate) this.activeId = s.id;
		this.#spawn(s, s.cwd || home.path, undefined, undefined, sid).catch((e) => this.#engineFailed(s.chat, e));
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
		this.#spawn(s, this.cwdOf(id), undefined, this.#keepModel(s)).catch((e) => this.#engineFailed(s.chat, e));
	}

	/** Claude Code reopened by id comes back on its default model, not the one
	 *  the conversation ran on: start it on that one. A model pick within the
	 *  session goes through `/model` (or the tool profile) instead. */
	#keepModel(s: Session): Record<string, unknown> | undefined {
		const model = s.backendId === 'claude' ? s.chat.model || s.model : '';
		return model ? { model } : undefined;
	}

	/** Another client sent to a session asleep here, and the daemon opened it
	 *  again: this one follows it (watches it) again too. */
	followReopened(sid: string) {
		const s = this.allSessions.find((x) => x.chat.sessionId === sid);
		if (s && isAsleep(s.id)) void this.wake(s.id);
	}

	/** The daemon closed this session's engine because nothing went on in it
	 *  (30 minutes, or more engines open than it keeps). The session stays as
	 *  it is on screen, without an engine, until the user sends something,
	 *  which opens it again, resuming (see `markAsleep`). */
	sleep(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		// Closed while this client was switching or handing it to the TUI:
		// that flow brings the engine back itself.
		if (s.surface === 'tui' || s.chat.switching) return this.handleExit(id);
		s.dormant = true;
		s.chat.engineState = 'ready';
		s.chat.restarting = false;
		markAsleep(id, () => this.wake(id));
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
			await this.#spawn(s, this.cwdOf(id));
			s.chat.switching = false;
		} catch (e) {
			s.chat.switching = false;
			this.#engineFailed(s.chat, e);
		}
	}

	/** A Claude Code / Codex draft starts on custom provider `provider` (on
	 *  its default `model`), or on the tool's own login or config (''). */
	setDraftToolProvider(id: string, provider: string, model?: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s?.draft || (s.backendId !== 'claude' && s.backendId !== 'codex')) return;
		s.gateway = false;
		s.draftToolProvider = provider;
		if (model) {
			s.draftPick = { ...s.draftPick, model };
			s.chat.model = model;
			s.chat.modelLabel = '';
		}
	}

	/** Run this Claude Code / Codex session (or an ACP agent with a gateway
	 *  mode) through the JuCode gateway (`jucode`, optionally on `model`) or
	 *  the provider in the user's own config (`system`). Only this session's
	 *  process changes; other sessions on the machine keep their config. */
	async applyToolProfile(id: string, mode: 'system' | 'jucode', model?: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s) return;
		if (s.backendId !== 'claude' && s.backendId !== 'codex' && !(s.backendId === 'acp' && s.chat.agentGateway)) return;
		s.gateway = mode === 'jucode';
		// A draft starts that way with its first message.
		if (s.draft) {
			if (model) {
				s.draftPick = { ...s.draftPick, model };
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
				this.cwdOf(id),
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
			await this.#spawn(s, this.cwdOf(id), undefined, { permission_mode: 'full-auto', ...this.#keepModel(s) });
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
				this.cwdOf(id),
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
		// A message sent again goes with its files (an image message is not
		// sent again: `plain`).
		const send = (text: string, hidden: boolean, files?: string[]) => {
			c.messages.push({ kind: 'system', text: note });
			if (hidden) c.autoContinue(text);
			else c.optimisticUser(text, undefined, true, files);
			dispatch(id, { op: 'user_message', content: text, ...(files?.length ? { files } : {}) });
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
			send(plain.text, false, plain.files);
			return;
		}
		if (!output && (auto || plain) && s.backendId === 'codex') {
			// The daemon holds the message until the rollback is done.
			dispatch(id, { op: 'command', input: '/rewind 1' });
			if (plain) c.truncateToUserTurn(plain.index);
			send(plain ? plain.text : AUTO_CONTINUE, !plain, plain?.files);
			return;
		}
		// Claude Code: a "continue" is not undone. The reply before it may end
		// in a tool call whose result would be cut off by resuming there.
		if (!output && plain && s.backendId === 'claude') {
			// Resumed at the reply before the failed turn (a respawn).
			await this.rewindClaudeSession(id, c.claudeRewindTarget(plain.index), plain.index);
			if (this.#gone(s)) return;
			send(plain.text, false, plain.files);
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
		saveComposerText(id, '');
		ChatState.forgetRunTime(id);
		const p = this.projects.find((pr) => pr.sessions.some((s) => s.id === id));
		if (p) p.sessions = p.sessions.filter((s) => s.id !== id);
		// The one in front instead: a live session of the same project, else
		// of any, before a draft (which shows, not starts) or a settled one.
		const live = (x: Session) => !x.draft && !x.archived;
		if (this.activeId === id) this.activeId = (p?.sessions.find(live) ?? this.shownSessions.find(live) ?? p?.sessions.find((x) => !x.archived))?.id ?? '';
	}

	/** Move a whole project next to another, preserving its sessions. */
	moveProject(id: string, targetId: string, after: boolean) {
		const p = this.projects.find((x) => x.id === id);
		if (!p || id === targetId) return;
		const rest = this.projects.filter((x) => x !== p);
		const i = rest.findIndex((x) => x.id === targetId);
		if (i < 0) return;
		rest.splice(after ? i + 1 : i, 0, p);
		this.projects = rest;
	}

	/** Tear down a project and all its sessions (the page handles
	 *  confirmation; the daemon archives them, of no project now). */
	removeProject(p: Project) {
		this.#dropProject(p, true);
	}

	/** Takes the project off this window without ending its sessions: they
	 *  keep running in the daemon (a reply under way finishes) and reopen,
	 *  where they are, when the project comes back (switching workspaces). */
	detachProject(p: Project) {
		this.#dropProject(p, false);
	}

	#dropProject(p: Project, close: boolean) {
		for (const s of p.sessions) {
			if (!s.dormant && !s.draft) {
				if (close) closeSession(s.id).catch(() => {});
				else daemon.detach(s.id);
			}
			unregisterAdapter(s.id);
			if (close) {
				clearDraft(s.id);
				dropHeldOps(s.id);
			} else this.#keep(s);
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

	/** The JuCode conversations saved in `dir` (the project's folder), as
	 *  history picker rows. */
	async historyItems(p: Project, chat: ChatState, dir = p.path) {
		const sessions = (await sessionHistory(dir)).filter((x) => x.engine === 'jucode');
		return sessions.map((x) => ({
			id: x.session,
			label: x.title || x.session,
			detail: new Date(x.updated_at).toLocaleString(),
			active: x.session === chat.sessionId
		}));
	}

	/** Open a saved conversation from a history picker in a new tab; `cwd`:
	 *  the folder it was saved in, when not the project's. */
	openSaved(project: Project, sid: string, title: string, backend: BackendId, cwd?: string) {
		// Already open: switch to it (a second engine on the same conversation
		// would fight over it).
		const open = this.allSessions.find((s) => s.backendId === backend && s.chat.sessionId === sid);
		if (open) {
			if (open.archived) open.archived = false;
			this.activeId = open.id;
			return;
		}
		this.activeId = this.restoreSession(project, sid, title, backend, false, undefined, undefined, undefined, undefined, undefined, undefined, cwd);
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
	 *  TUI can resume, so a fresh empty chat and a registered ACP agent's
	 *  session are a no-op. */
	openInTui(id: string) {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || s.surface === 'tui' || s.chat.switching || !canHandOffToTui(s.backendId, presetOf(s.acpAgent))) return;
		if (!isValidResumeSessionId(s.chat.sessionId) || !(s.chat.resumable || s.restored)) return;
		// Asleep: the daemon hands over an open session only.
		if (isAsleep(id)) return void this.wake(id)?.then(() => this.openInTui(id));
		if (!daemon.sessionOf(id)) return;
		s.surface = 'tui';
	}

	/** The daemon connection came back while this conversation was in its
	 *  TUI: open and watch it again. A session still in its TUI is only
	 *  watched (its snapshot names the terminal); one whose TUI ended with
	 *  the daemon starts its engine. */
	rewatch(id: string): Promise<void> {
		const s = this.allSessions.find((x) => x.id === id);
		if (!s || daemon.sessionOf(id)) return Promise.resolve();
		return this.#spawn(s, this.cwdOf(id)).catch((e) => this.#engineFailed(s.chat, e));
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
		return this.projects.filter((p) => !p.loose).map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			...(p.worktree ? { worktree: p.worktree } : {}),
			...(p.chats ? { chats: true } : {}),
			...(p.dirs?.length ? { dirs: p.dirs } : {}),
			...(p.setup ? { setup: p.setup } : {}),
			...(p.lastBackend && p.lastBackend !== 'jucode' ? { lastBackend: p.lastBackend } : {}),
			...(p.lastBackend === 'acp' && p.lastAcpAgent ? { lastAcpAgent: p.lastAcpAgent } : {}),
			...(p.color ? { color: p.color } : {}),
			...(p.icon ? { icon: p.icon } : {}),
			tabs: p.stale ? (this.#staleTabs.get(p.id) ?? []) : p.sessions.map(savedTab)
		}));
	}

	/** The sessions of no project, saved with the workspace they show in. */
	serializeLoose(): SavedTab[] {
		return this.loose?.sessions.map(savedTab) ?? [];
	}

	/** Restores saved tabs into `proj` (dormant, resumed or as drafts). */
	#restoreTabs(proj: Project, tabs: SavedTab[]) {
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
			const savedAgent = acpAgentRef(t.acpAgent);
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
						t.model,
						// A session of no project has no folder but its own to start in.
						typeof t.cwd === 'string' && isAbsolute(t.cwd) ? t.cwd : undefined
					)
				: this.#draftSaved(proj, t.id!, t.title, backend, !!t.archived, chrome, acpAgent);
			const s = proj.sessions.find((x) => x.id === id)!;
			if (t.pinned === true) s.pinned = true;
			if (typeof t.cwd === 'string' && isAbsolute(t.cwd) && !samePath(t.cwd, proj.path)) s.cwd = t.cwd;
			if (typeof t.forkedFrom?.sid === 'string')
				s.forkedFrom = { sid: t.forkedFrom.sid, title: String(t.forkedFrom.title ?? ''), turns: Number(t.forkedFrom.turns) || 0 };
			if (typeof t.keptAt === 'number') s.keptAt = t.keptAt;
			const wt = t.worktree;
			if (s.cwd && wt && typeof wt.branch === 'string' && typeof wt.mainRepoPath === 'string' && typeof wt.slug === 'string')
				s.worktree = { isWorktree: true, mainRepoPath: wt.mainRepoPath, branch: wt.branch, baseBranch: String(wt.baseBranch ?? ''), slug: wt.slug };
		}
	}

	/** Restore saved projects + their open conversations and the
	 *  workspace's sessions of no project (`loose`), or seed a default
	 *  project on first run. Sets `loaded` when done. A worktree project whose
	 *  directory has vanished (task finished elsewhere / dir deleted) is kept in
	 *  the list as `stale` — no sessions are spawned into a dead cwd — so the
	 *  sidebar can offer a remove-from-list affordance instead of crashing. */
	async restore(saved: SavedProject[], loose: SavedTab[] = []) {
		if (loose.length) this.#restoreTabs(this.looseGroup(), loose);
		if (saved.length || loose.length) {
			for (const p of saved) {
				// The same project twice (a file an older version wrote while a
				// daemon list raced the restore): one entry, both entries' tabs.
				const known = this.projects.find((x) => x.id === p.id || samePath(x.path, p.path));
				if (known) {
					if (known.stale) this.#staleTabs.set(known.id, [...(this.#staleTabs.get(known.id) ?? []), ...(p.tabs ?? [])]);
					else this.#restoreTabs(known, p.tabs ?? []);
					continue;
				}
				const proj: Project = { id: p.id, name: p.name, path: p.path, sessions: [] };
				if (p.chats === true) proj.chats = true;
				this.setProjectDirs(proj, p.dirs);
				if (typeof p.setup === 'string' && p.setup.trim()) proj.setup = p.setup;
				this.setProjectChrome(proj, p);
				if (p.lastBackend) proj.lastBackend = normalizeBackendId(p.lastBackend);
				const lastAgent = proj.lastBackend === 'acp' ? acpAgentRef(p.lastAcpAgent) : undefined;
				if (lastAgent) proj.lastAcpAgent = lastAgent;
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
			this.addSession(this.projects.at(-1)!);
		}
		this.loaded = true;
	}
}
