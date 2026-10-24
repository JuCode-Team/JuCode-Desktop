import type { ChatState } from './chat.svelte';
import type { BackendId, EngineAdapter } from './backends/types';
import type { TabIcon } from './workbench/tabChrome';

/** The ACP agent behind an 'acp' session: a built-in preset the daemon
 *  starts by id (`preset`), or an entry of the desktop's registry. */
export interface AcpAgentRef {
	id: string;
	name: string;
	preset?: boolean;
}

export interface Session {
	id: string;
	chat: ChatState;
	/** The conversation it was forked from: its engine id, its title then,
	 *  and the user turns the fork took from it. */
	forkedFrom?: { sid: string; title: string; turns: number };
	/** Engine backend driving this session (persisted; 'jucode' default). */
	backendId: BackendId;
	/** Tab tag color (persisted with the session's saved tab). */
	color?: string;
	/** Tab icon: builtin id, slug/emoji, or sanitized SVG (persisted). */
	icon?: TabIcon;
	/** For 'acp' sessions: the launched agent (needed on every (re)spawn). */
	acpAgent?: AcpAgentRef;
	/** Per-session adapter instance (the jucode one; not persisted). */
	adapter: EngineAdapter;
	/** Archived threads are hidden from the sidebar by default (persisted); the
	 *  conversation isn't deleted and can be unarchived. */
	archived?: boolean;
	/** Opened by resuming a persisted conversation — the engine already holds
	 *  context, so the backend is locked even before any visible user turn. */
	restored?: boolean;
	/** claude: the mode its current engine was started in (`bypassPermissions`
	 *  for full-auto, else the desktop's engine mode name). */
	spawnedMode?: string;
	/** Which surface currently owns the conversation: the GUI chat (default,
	 *  undefined) or the native TUI resumed by session id. Exactly one process
	 *  holds the conversation at a time — the store closes the GUI engine
	 *  before flipping to 'tui', and TuiPanel closes its pty before asking the
	 *  store to flip back. */
	surface?: 'gui' | 'tui';
	/** A session listed from the daemon without an engine open here
	 *  yet; it opens when it is first shown (`SessionStore.wake`). */
	dormant?: boolean;
	/** A new session with no engine yet: its backend, model and effort are
	 *  only choices until the first message starts it (`markDraft`). */
	draft?: boolean;
	/** Listed above the project's other sessions (persisted, desktop only). */
	pinned?: boolean;
	/** Its working directory, when not its project's `path` (persisted). A
	 *  session of no project always has one. */
	cwd?: string;
	/** The worktree it works in, its own (as t3code has it): `cwd` is its
	 *  path (persisted). */
	worktree?: WorktreeMeta;
	/** A draft's choice of a new worktree from local branch `base`, made
	 *  when its first message is sent (SessionStore.#makeWorktree). */
	draftWorktree?: { base: string };
	/** When it last changed, as the daemon lists it (ms; not persisted). */
	updatedAt?: number;
	/** When the user last restored it from the archive (ms): auto-archive
	 *  counts from then (sidebar/autoArchive.ts). */
	keptAt?: number;
	/** Model and effort picked while a draft, applied when it starts. */
	draftPick?: { model?: string; effort?: string };
	/** Claude Code / Codex off the gateway: the custom provider a draft starts
	 *  on (Settings → its tool), '' for the tool's own login or config. Unset:
	 *  the tool's default provider. The daemon keeps a session on the one it
	 *  started on. */
	draftToolProvider?: string;
	/** Claude Code / Codex / an ACP preset with a gateway mode: runs through
	 *  the JuCode gateway on the user's JuCode login (only this session's
	 *  process; their own config is left alone). Unset: as it last ran (the daemon remembers it). */
	gateway?: boolean;
	/** Gateway sessions: the JuCode group its requests route to, applied by
	 *  the daemon's local gateway (unset: the model's default, else automatic). */
	group?: string;
	/** Claude Code: the model a restored session last ran on, until its engine
	 *  reports one (see SessionStore.#keepModel). */
	model?: string;
}

/** 并行任务（git worktree）项目的元数据，随项目布局持久化。 */
export interface WorktreeMeta {
	isWorktree: true;
	/** 主仓库根目录（merge / worktree remove 等操作在这里执行）。 */
	mainRepoPath: string;
	/** 任务分支（task/<slug>）。 */
	branch: string;
	/** 创建任务时的基础分支。 */
	baseBranch: string;
	slug: string;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	/** 附加目录（绝对路径，不含主目录 path）：引擎在主目录启动时也能读写这些目录。
	 *  随 workspaces.json 保存并同步给后台服务。 */
	dirs?: string[];
	/** Run in each new worktree of its sessions, in a terminal there (install
	 *  dependencies, copy .env…), with JUCODE_PROJECT_ROOT and
	 *  JUCODE_WORKTREE_PATH set. Saved with the workspace. */
	setup?: string;
	sessions: Session[];
	/** 并行任务 worktree 项目才有；普通项目为 undefined。 */
	worktree?: WorktreeMeta;
	/** 恢复时发现 worktree 目录已不存在：只读展示，仅可从列表移除。 */
	stale?: boolean;
	/** 本项目最近一次新建会话所用的引擎后端（新建会话的默认值）。 */
	lastBackend?: BackendId;
	/** lastBackend 为 'acp' 时：上次选择的 ACP agent（内置预设或注册表条目）。 */
	lastAcpAgent?: AcpAgentRef;
	/** 对话分组：path 为 ~/.jucode/chats，会话以对话模式（非编程）运行，只用 jucode 引擎。 */
	chats?: boolean;
	/** 未归属任何项目的会话所在的内部分组（id 为 LOOSE_ID，path 为空）：
	 *  只在侧栏「最近」列出，不保存进工作区，不同步给后台服务。 */
	loose?: boolean;
	/** 侧栏文件夹的颜色与自定义图标（同标签外观；随 workspaces.json 保存并同步给后台服务）。 */
	color?: string;
	icon?: TabIcon;
}

/** 对话功能本版本隐藏（之后由新的助手取代）：桌面端和远程网页都不显示、不新建对话。
 *  已有的对话分组仍留在 workspaces.json 和后台服务里，只是不列出。改回 true 即恢复。 */
export const CHATS_ENABLED = false;

/** The id of the group of sessions that belong to no project (Project.loose). */
export const LOOSE_ID = 'loose';
