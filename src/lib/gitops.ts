// Git / GitHub 面板用到的纯逻辑（无框架依赖，便于单测）：
// 分支名校验、git 输出解析、gh CLI 输出解析。

/** 本地分支名校验，与 Rust 侧 is_valid_ref_name 保持一致（比 git 本身略严）。 */
export function isValidBranchName(name: string): boolean {
	if (!name || name.length > 250) return false;
	if (/^[-./]/.test(name)) return false;
	if (/[/.]$/.test(name) || name.endsWith('.lock')) return false;
	if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
	return /^[A-Za-z0-9._/-]+$/.test(name);
}

/** 解析 `git branch --format=%(refname:short)` 输出为本地分支列表。 */
export function parseBranches(out: string): string[] {
	return out
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.filter((b) => !b.startsWith('(')); // 跳过 detached HEAD 行
}

export interface SyncInfo {
	upstream: string | null;
	ahead: number;
	behind: number;
}

/** 解析 `git status -sb` 首行：`## main...origin/main [ahead 1, behind 2]`。 */
export function parseSyncStatus(out: string): SyncInfo {
	const none: SyncInfo = { upstream: null, ahead: 0, behind: 0 };
	const line = out.split('\n')[0] ?? '';
	if (!line.startsWith('## ')) return none;
	const m = line.match(/^## .+?\.\.\.(\S+?)(?: \[([^\]]+)\])?$/);
	if (!m) return none; // 无上游（`## main`）或初始提交前
	const ab = m[2] ?? '';
	const ahead = Number(ab.match(/ahead (\d+)/)?.[1] ?? 0);
	const behind = Number(ab.match(/behind (\d+)/)?.[1] ?? 0);
	return { upstream: m[1], ahead, behind };
}

/** 从 `gh --version` 输出提取版本号；非 gh 输出返回 null。 */
export function parseGhVersion(out: string): string | null {
	return out.match(/gh version (\d+\.\d+\.\d+)/)?.[1] ?? null;
}

/** `git remote -v` 输出中是否存在 GitHub 远端（https 或 ssh 均可）。 */
export function hasGitHubRemote(out: string): boolean {
	return out.split('\n').some((l) => /\bgithub\.com[/:]/.test(l));
}

export interface PrInfo {
	url: string;
	title: string;
	state: string;
	isDraft: boolean;
}

/** 解析 `gh pr view --json url,title,state,isDraft` 的 JSON 输出。 */
export function parsePrView(out: string): PrInfo | null {
	try {
		const v = JSON.parse(out) as Record<string, unknown>;
		if (v && typeof v.url === 'string' && v.url) {
			return {
				url: v.url,
				title: String(v.title ?? ''),
				state: String(v.state ?? ''),
				isDraft: v.isDraft === true
			};
		}
	} catch {
		// 非 JSON（gh 出错文本等）→ 视为没有 PR
	}
	return null;
}

/** 从 `gh pr create` 的输出中提取新建 PR 的 URL。 */
export function extractPrUrl(out: string): string | null {
	return out.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/)?.[0] ?? null;
}

/** 选默认 base 分支：优先 main / master / develop，否则第一个非当前分支。 */
export function defaultBaseBranch(branches: string[], current: string): string {
	for (const b of ['main', 'master', 'develop']) {
		if (b !== current && branches.includes(b)) return b;
	}
	return branches.find((b) => b !== current) ?? '';
}

// --- 并行任务（git worktree） ---

/**
 * 任务名 → slug：小写、非 [a-z0-9] 一律归并为 '-'、去首尾 '-'、限长 40。
 * 与 Rust 侧 is_valid_task_slug 约束一致（转不出内容时返回空串，由 UI 拦截）。
 */
export function slugifyTaskName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '');
}

export interface WorktreeEntry {
	path: string;
	head: string;
	/** 短分支名（去掉 refs/heads/ 前缀）；detached/bare 时为 null。 */
	branch: string | null;
	detached: boolean;
	bare: boolean;
	locked: boolean;
	/** 目录已丢失，可被 `worktree prune` 清理。 */
	prunable: boolean;
}

/** 解析 `git worktree list --porcelain` 输出（空行分隔的属性块）。 */
export function parseWorktreeList(out: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let cur: WorktreeEntry | null = null;
	for (const raw of out.split('\n')) {
		const line = raw.trimEnd();
		if (!line) {
			if (cur) entries.push(cur);
			cur = null;
			continue;
		}
		if (line.startsWith('worktree ')) {
			if (cur) entries.push(cur);
			cur = { path: line.slice(9), head: '', branch: null, detached: false, bare: false, locked: false, prunable: false };
		} else if (!cur) {
			continue;
		} else if (line.startsWith('HEAD ')) {
			cur.head = line.slice(5);
		} else if (line.startsWith('branch ')) {
			cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
		} else if (line === 'detached') {
			cur.detached = true;
		} else if (line === 'bare') {
			cur.bare = true;
		} else if (line === 'locked' || line.startsWith('locked ')) {
			cur.locked = true;
		} else if (line === 'prunable' || line.startsWith('prunable ')) {
			cur.prunable = true;
		}
	}
	if (cur) entries.push(cur);
	return entries;
}

export type TaskWorktree = WorktreeEntry & { slug: string };

/** 过滤出容器目录（`…/.jucode-worktrees/<repo>`）下的并行任务 worktree，并附上 slug。 */
export function taskWorktrees(entries: WorktreeEntry[], baseDir: string): TaskWorktree[] {
	const prefix = baseDir.replace(/\/+$/, '') + '/';
	return entries
		.filter((e) => !e.bare && e.path.startsWith(prefix))
		.map((e) => ({ ...e, slug: e.path.slice(prefix.length) }))
		.filter((e) => /^[a-z0-9][a-z0-9-]*$/.test(e.slug) && !e.slug.endsWith('-'));
}

/** 解析 `git rev-list --left-right --count base...branch`：left=落后 base，right=领先。 */
export function parseAheadBehind(out: string): { ahead: number; behind: number } {
	const m = out.trim().match(/^(\d+)\s+(\d+)$/);
	if (!m) return { ahead: 0, behind: 0 };
	return { behind: Number(m[1]), ahead: Number(m[2]) };
}

export type MergeBlocker = 'detached' | 'dirty' | 'noCommits' | null;

/**
 * 「合并回主仓库」前置条件（纯逻辑，便于单测）：
 * 必须在分支上、工作区干净、且相对 base 至少领先一个提交。返回 null 表示可合并。
 */
export function mergeBlocker(opts: { dirty: boolean; branch: string | null; ahead: number }): MergeBlocker {
	if (!opts.branch) return 'detached';
	if (opts.dirty) return 'dirty';
	if (opts.ahead <= 0) return 'noCommits';
	return null;
}

/** 「完成并清理」前置条件：工作区干净且分支已完全并入 base（ahead 为 0）。 */
export function canFinishTask(opts: { dirty: boolean; ahead: number }): boolean {
	return !opts.dirty && opts.ahead === 0;
}
