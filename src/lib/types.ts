import type { ChatState } from './chat.svelte';
import type { BackendId, EngineAdapter } from './backends/types';

export interface Session {
	id: string;
	chat: ChatState;
	/** Engine backend driving this session (persisted; 'jucode' default). */
	backendId: BackendId;
	/** Per-session adapter instance (stateful for codex/claude; not persisted). */
	adapter: EngineAdapter;
	/** Archived threads are hidden from the sidebar by default (persisted); the
	 *  conversation isn't deleted and can be unarchived. */
	archived?: boolean;
	/** Opened by resuming a persisted conversation — the engine already holds
	 *  context, so the backend is locked even before any visible user turn. */
	restored?: boolean;
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
	sessions: Session[];
	/** 并行任务 worktree 项目才有；普通项目为 undefined。 */
	worktree?: WorktreeMeta;
	/** 恢复时发现 worktree 目录已不存在：只读展示，仅可从列表移除。 */
	stale?: boolean;
	/** 本项目最近一次新建会话所用的引擎后端（新建会话的默认值）。 */
	lastBackend?: BackendId;
}
