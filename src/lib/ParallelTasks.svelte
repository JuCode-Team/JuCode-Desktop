<script lang="ts">
	// 并行任务（git worktree）区块，嵌在 Git 面板里，两种形态：
	//  · 当前项目是任务 worktree：展示分支/基于/领先落后 + 合并回主仓库 / 完成并清理 / 放弃任务；
	//  · 当前项目是主仓库：列出容器目录下的所有任务 worktree（脏标记、打开、快捷合并/清理）。
	import GitMergeIcon from '@lucide/svelte/icons/git-merge';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { git, worktreeBase, worktreeBaseOf } from '$lib/protocol';
	import {
		parseWorktreeList,
		taskWorktrees,
		parseAheadBehind,
		mergeBlocker,
		canFinishTask,
		type TaskWorktree,
		type MergeBlocker
	} from '$lib/gitops';
	import { t } from '$lib/i18n';
	import type { WorktreeMeta } from '$lib/types';

	let {
		cwd = '',
		worktree = null,
		onOpenTask,
		onTaskRemoved
	}: {
		cwd?: string;
		worktree?: WorktreeMeta | null;
		onOpenTask?: (path: string, meta: WorktreeMeta) => void;
		onTaskRemoved?: (path: string) => void;
	} = $props();

	let error = $state('');
	let busy = $state(false);
	/** The main repository a merge left conflicted (it can abort it). */
	let conflictIn = $state('');

	// --- 任务 worktree 形态 ---
	let dirty = $state(false);
	let curBranch = $state('');
	let resolvedBase = $state('');
	let ahead = $state(0);
	let behind = $state(0);
	let statLoaded = $state(false);

	// --- 主仓库形态 ---
	type Row = TaskWorktree & { dirty: boolean | null };
	let rows = $state<Row[]>([]);
	let mainBranch = $state('');
	let listAvailable = $state(true);

	const blocker: MergeBlocker = $derived(
		statLoaded ? mergeBlocker({ dirty, branch: curBranch || null, ahead }) : 'dirty'
	);
	const finishable = $derived(statLoaded && canFinishTask({ dirty, ahead }));

	async function refreshTask(meta: WorktreeMeta) {
		try {
			dirty = (await git(['status', '--porcelain=v1'], cwd)).trim() !== '';
			curBranch = (await git(['branch', '--show-current'], cwd)).trim();
			// 打开旧任务时 baseBranch 可能未知：退回主仓库当前分支。
			resolvedBase =
				meta.baseBranch || (await git(['branch', '--show-current'], meta.mainRepoPath)).trim();
			const ab = parseAheadBehind(
				await git(['rev-list', '--left-right', '--count', `${resolvedBase}...${meta.branch}`], cwd)
			);
			ahead = ab.ahead;
			behind = ab.behind;
			statLoaded = true;
		} catch (e) {
			error = String(e);
		}
	}

	async function refreshList() {
		try {
			const baseDir = await worktreeBase(cwd);
			const out = await git(['worktree', 'list', '--porcelain'], cwd);
			mainBranch = (await git(['branch', '--show-current'], cwd)).trim();
			const tasks = taskWorktrees(parseWorktreeList(out), baseDir);
			const withDirty = await Promise.all(
				tasks.map(async (e): Promise<Row> => {
					if (e.prunable) return { ...e, dirty: null };
					try {
						return { ...e, dirty: (await git(['status', '--porcelain=v1'], e.path)).trim() !== '' };
					} catch {
						return { ...e, dirty: null };
					}
				})
			);
			rows = withDirty;
			listAvailable = true;
		} catch {
			// 非 git 仓库 / 旧版 git：整块隐藏，不打扰。
			listAvailable = false;
			rows = [];
		}
	}

	function refresh() {
		error = '';
		if (worktree) refreshTask(worktree);
		else refreshList();
	}

	// 跟随激活项目切换刷新（cwd 变化时 GitPanel 不会重挂载本组件）。
	$effect(() => {
		cwd;
		worktree;
		refresh();
	});

	/** Merges `branch` into the main repository `repo`, which must be on
	 *  `base` (when known) with nothing uncommitted: a merge there lands on
	 *  whatever it has checked out. A conflict leaves it mid-merge, which
	 *  `abortMerge` undoes. */
	async function merge(repo: string, branch: string, base: string) {
		const [on, status] = await Promise.all([git(['branch', '--show-current'], repo), git(['status', '--porcelain=v1'], repo)]);
		if (status.trim()) throw new Error(t('dock.tasks.mainDirty'));
		if (base && on.trim() !== base) throw new Error(t('dock.tasks.mainElsewhere', { branch: on.trim() || 'HEAD', base }));
		try {
			await git(['merge', '--no-ff', '--no-edit', branch], repo);
		} catch (e) {
			if (/conflict/i.test(String(e))) {
				conflictIn = repo;
				throw new Error(`${t('dock.tasks.mergeConflict')}\n\n${String(e)}`);
			}
			throw e;
		}
	}
	async function abortMerge() {
		if (!conflictIn || busy) return;
		busy = true;
		try {
			await git(['merge', '--abort'], conflictIn);
			conflictIn = '';
			error = '';
			refresh();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	// --- 任务 worktree 操作（merge / cleanup 都在主仓库目录执行） ---
	async function mergeBack() {
		if (!worktree || busy || blocker) return;
		busy = true;
		error = '';
		try {
			await merge(worktree.mainRepoPath, worktree.branch, resolvedBase);
			refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** Removes worktree `path` and its branch from `repo`: the safe way
	 *  first (git refuses unmerged work), then, confirmed, by force. */
	async function removeTask(repo: string, path: string, branch: string | null): Promise<boolean> {
		try {
			await git(['worktree', 'remove', path], repo);
			if (branch) await git(['branch', '-d', branch], repo);
			return true;
		} catch (e) {
			busy = false;
			const force = await confirm({
				title: t('dock.tasks.forceCleanupTitle'),
				message: t('dock.tasks.forceCleanupConfirm', { msg: String(e) }),
				danger: true
			});
			if (!force) return false;
			busy = true;
			await git(['worktree', 'remove', '--force', path], repo).catch(() => {});
			if (branch) await git(['branch', '-D', branch], repo);
			return true;
		}
	}

	async function finishTask() {
		if (!worktree || busy || !finishable) return;
		const ok = await confirm({
			title: t('dock.tasks.finishTitle'),
			message: t('dock.tasks.finishConfirm', { slug: worktree.slug, branch: worktree.branch }),
			confirmLabel: t('dock.tasks.finish')
		});
		if (!ok) return;
		busy = true;
		error = '';
		try {
			if (await removeTask(worktree.mainRepoPath, cwd, worktree.branch)) onTaskRemoved?.(cwd);
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	async function abandonTask() {
		if (!worktree || busy) return;
		const ok = await confirm({
			title: t('dock.tasks.abandonTitle'),
			message: t('dock.tasks.abandonConfirm', { slug: worktree.slug, branch: worktree.branch }),
			confirmLabel: t('dock.tasks.abandon'),
			danger: true
		});
		if (!ok) return;
		busy = true;
		error = '';
		try {
			await git(['worktree', 'remove', '--force', cwd], worktree.mainRepoPath);
			await git(['branch', '-D', worktree.branch], worktree.mainRepoPath);
			onTaskRemoved?.(cwd);
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	// --- 主仓库列表操作 ---
	/** A row's base branch: as worktree_create kept it, else the main
	 *  repository's current one. */
	async function baseOf(r: Row): Promise<string> {
		return (r.branch && (await worktreeBaseOf(cwd, r.branch).catch(() => null))) || mainBranch;
	}

	async function openRow(r: Row) {
		if (!r.branch) return;
		onOpenTask?.(r.path, {
			isWorktree: true,
			mainRepoPath: cwd,
			branch: r.branch,
			baseBranch: await baseOf(r),
			slug: r.slug
		});
	}

	async function mergeRow(r: Row) {
		if (busy || r.dirty !== false || !r.branch) return;
		busy = true;
		error = '';
		try {
			await merge(cwd, r.branch, await baseOf(r));
			refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function removeRow(r: Row) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			if (await removeTask(cwd, r.path, r.branch)) {
				onTaskRemoved?.(r.path);
				refresh();
			}
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	async function prune() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await git(['worktree', 'prune'], cwd);
			refresh();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if worktree}
	<div class="sec">{t('dock.tasks.title')}</div>
	<div class="task-card">
		<div class="meta">
			<span class="mline"><GitBranchIcon size={12} /><span class="mono">{worktree.branch}</span></span>
			<span class="mline dim2 base">{t('dock.tasks.base')} <span class="mono">{resolvedBase || worktree.baseBranch}</span></span>
			{#if statLoaded}
				<span class="mline dim2">{t('dock.tasks.vsBase', { base: resolvedBase, ahead, behind })}</span>
				<span class="mline" class:warn={dirty} class:okc={!dirty}>{dirty ? t('dock.tasks.dirty') : t('dock.tasks.clean')}</span>
				{#if ahead === 0}
					<span class="mline okc"><CircleCheckIcon size={12} />{t('dock.tasks.merged', { base: resolvedBase })}</span>
				{/if}
			{/if}
		</div>
		{#if statLoaded && blocker}
			<div class="hint">
				{blocker === 'dirty'
					? t('dock.tasks.mergeBlockedDirty')
					: blocker === 'detached'
						? t('dock.tasks.mergeBlockedDetached')
						: t('dock.tasks.mergeBlockedNoCommits', { base: resolvedBase })}
			</div>
		{/if}
		<div class="acts">
			<Button size="sm" variant="primary" onclick={mergeBack} disabled={busy || !!blocker}>
				{#if busy}<LoaderCircleIcon size={14} class="spin" />{:else}<GitMergeIcon size={14} />{/if}
				{t('dock.tasks.merge')}
			</Button>
			<Button size="sm" onclick={finishTask} disabled={busy || !finishable} title={finishable ? '' : t('dock.tasks.finishBlocked')}>
				{t('dock.tasks.finish')}
			</Button>
			<Button size="sm" variant="danger" onclick={abandonTask} disabled={busy}>
				{t('dock.tasks.abandon')}
			</Button>
		</div>
		{#if error}
			<Notice mono onDismiss={() => (error = '')}>{error}</Notice>
		{/if}
		{#if conflictIn}
			<Button size="sm" onclick={abortMerge} disabled={busy}>{t('dock.tasks.abortMerge')}</Button>
		{/if}
	</div>
{:else if listAvailable}
	<div class="sec">
		{t('dock.tasks.title')} <span class="count">{rows.length}</span>
		<span class="grow"></span>
		<IconButton size="sm" onclick={refresh} label="refresh tasks" title={t('dock.tasks.refresh')}><RefreshCwIcon size={12} /></IconButton>
	</div>
	{#each rows as r (r.path)}
		<div class="trow">
			<GitBranchIcon size={12} class="tico" />
			<button class="tmain" onclick={() => openRow(r)} title={t('dock.tasks.openTitle')} disabled={r.prunable || !r.branch}>
				<span class="tslug">{r.slug}</span>
				<span class="tbranch mono">{r.branch ?? r.head.slice(0, 7)}</span>
			</button>
			{#if r.prunable}
				<span class="badge warn">{t('dock.tasks.prunable')}</span>
				<Button size="sm" onclick={prune} disabled={busy}>{t('dock.tasks.prune')}</Button>
			{:else}
				{#if r.dirty}
					<span class="state" title={t('dock.tasks.dirty')}><SquarePenIcon size={14} /></span>
				{:else if r.dirty === false}
					<span class="state" title={t('dock.tasks.clean')}><CircleCheckIcon size={14} /></span>
				{/if}
				<div class="racts">
					<IconButton size="sm" onclick={() => openRow(r)} disabled={busy || !r.branch} label="open task" title={t('dock.tasks.open')}><FolderOpenIcon size={14} /></IconButton>
					<IconButton size="sm" onclick={() => mergeRow(r)} disabled={busy || r.dirty !== false || !r.branch} label="merge task" title={t('dock.tasks.merge')}><GitMergeIcon size={14} /></IconButton>
					<IconButton size="sm" onclick={() => removeRow(r)} disabled={busy} label="remove task" title={t('dock.tasks.finish')}><TrashIcon size={14} /></IconButton>
				</div>
			{/if}
		</div>
	{/each}
	{#if rows.length === 0}
		<div class="tempty">{t('dock.tasks.empty')} · {t('dock.tasks.emptyHint')}</div>
	{/if}
	{#if error}
		<div class="terr"><Notice mono onDismiss={() => (error = '')}>{error}</Notice></div>
	{/if}
	{#if conflictIn}
		<div class="terr"><Button size="sm" onclick={abortMerge} disabled={busy}>{t('dock.tasks.abortMerge')}</Button></div>
	{/if}
{/if}

<style>
	.sec {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 8px 6px;
		font-size: var(--fs-2xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.count {
		color: var(--dim2);
		background: var(--surface2);
		border-radius: var(--r);
		padding: 0 7px;
		font-size: var(--fs-2xs);
	}
	.grow {
		flex: 1;
	}
	.task-card {
		margin: 0 6px;
		padding: 10px 11px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: var(--fs-xs);
	}
	.mline {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
	}
	.mline.dim2 {
		color: var(--dim2);
	}
	.mline.warn {
		color: var(--warn);
	}
	.mline.okc {
		color: var(--ok);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.5;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.terr {
		margin: 4px 6px 0;
	}
	.trow {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px 4px 9px;
		border-radius: var(--r);
		min-width: 0;
	}
	.trow:hover {
		background: var(--surface2);
	}
	:global(.tico) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.tmain {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		padding: 2px 0;
	}
	.tmain:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.tmain:hover:not(:disabled) .tslug {
		color: var(--accent-bright);
	}
	.tslug {
		font-size: var(--fs-sm);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tbranch {
		color: var(--dim2);
		font-size: var(--fs-2xs);
		flex-shrink: 1;
	}
	.badge {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		padding: 1px 7px;
		border-radius: var(--r);
		flex-shrink: 0;
	}
	.badge.warn {
		color: var(--warn);
	}
	.state {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.racts {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		opacity: 0;
	}
	.trow:hover .racts {
		opacity: 1;
	}
	.tempty {
		padding: 6px 9px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.mline.base {
		white-space: nowrap;
	}
</style>
