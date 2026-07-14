<script lang="ts">
	import { onMount } from 'svelte';
	import { GitBranch, RefreshCw, X, Plus, Minus, Undo2, ChevronDown, Check, ArrowUp, ArrowDown, LoaderCircle, GitPullRequest, ExternalLink, Sparkles } from 'lucide-svelte';
	import { ask } from '@tauri-apps/plugin-dialog';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { git, gh, generateText } from '$lib/protocol';
	import {
		isValidBranchName,
		parseBranches,
		parseSyncStatus,
		parseGhVersion,
		hasGitHubRemote,
		parsePrView,
		extractPrUrl,
		defaultBaseBranch,
		type SyncInfo,
		type PrInfo
	} from '$lib/gitops';
	import { t } from '$lib/i18n';
	import ParallelTasks from '$lib/ParallelTasks.svelte';
	import type { WorktreeMeta } from '$lib/types';

	let {
		cwd = '',
		worktree = null,
		llm = null,
		onOpenTask,
		onTaskRemoved
	}: {
		cwd?: string;
		/** 当前项目本身是并行任务 worktree 时的元数据。 */
		worktree?: WorktreeMeta | null;
		/** 一次性文案生成端点（无则隐藏 AI 生成按钮）。 */
		llm?: { provider: string; baseUrl: string; format: string; model: string } | null;
		onOpenTask?: (path: string, meta: WorktreeMeta) => void;
		onTaskRemoved?: (path: string) => void;
	} = $props();
	const dir = () => cwd || undefined;

	type Change = { x: string; y: string; path: string; staged: boolean; untracked: boolean };

	let branch = $state('');
	let changes = $state<Change[]>([]);
	let commits = $state<string[]>([]);
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let diff = $state<{ path: string; lines: { line: string; cls: string }[] } | null>(null);

	// 分支管理 / 远端同步
	let branches = $state<string[]>([]);
	let sync = $state<SyncInfo>({ upstream: null, ahead: 0, behind: 0 });
	let branchOpen = $state(false);
	let newBranch = $state('');
	let syncBusy = $state<'' | 'pull' | 'push' | 'fetch'>('');

	// GitHub PR（通过 gh CLI）
	type GhState = 'checking' | 'missing' | 'unauthed' | 'noRemote' | 'ready';
	let ghState = $state<GhState>('checking');
	let pr = $state<PrInfo | null>(null);
	let prForm = $state(false);
	let prTitle = $state('');
	let prBody = $state('');
	let prBase = $state('');
	let prDraft = $state(false);
	let prBusy = $state(false);
	let prError = $state('');
	let copied = $state('');

	const stagedCount = $derived(changes.filter((c) => c.staged).length);

	function classify(text: string) {
		return text.split('\n').map((line) => {
			let cls = 'ctx';
			if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
			else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
			else if (line.startsWith('@@')) cls = 'hunk';
			else if (line.startsWith('diff ') || line.startsWith('+++') || line.startsWith('---')) cls = 'meta';
			return { line, cls };
		});
	}

	async function refresh() {
		error = '';
		try {
			branch = (await git(['branch', '--show-current'], dir())).trim();
			branches = parseBranches(await git(['branch', '--format=%(refname:short)'], dir()));
			sync = parseSyncStatus(await git(['status', '-sb'], dir()));
			const st = await git(['status', '--porcelain=v1'], dir());
			changes = st
				.split('\n')
				.filter(Boolean)
				.map((l) => {
					const x = l[0] ?? ' ';
					const y = l[1] ?? ' ';
					return { x, y, path: l.slice(3), staged: x !== ' ' && x !== '?', untracked: x === '?' };
				});
			const log = await git(['log', '--oneline', '-n', '30', '--no-color'], dir());
			commits = log.split('\n').filter(Boolean);
		} catch (e) {
			error = String(e);
		}
	}
	onMount(() => {
		refresh();
		checkGh();
	});

	async function run(args: string[]) {
		busy = true;
		try {
			await git(args, dir());
			await refresh();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
	const stage = (c: Change) => run(['add', '--', c.path]);
	const unstage = (c: Change) => run(['restore', '--staged', '--', c.path]);
	const stageAll = () => run(['add', '-A']);
	async function discard(c: Change) {
		const ok = await ask(t('dock.git.discardConfirm', { path: c.path }), { title: t('dock.git.discardTitle'), kind: 'warning' });
		if (!ok) return;
		if (c.untracked) await run(['clean', '-fd', '--', c.path]);
		else await run(['restore', '--staged', '--worktree', '--', c.path]);
	}
	async function commit() {
		if (!message.trim() || !stagedCount) return;
		await run(['commit', '-m', message.trim()]);
		if (!error) message = '';
	}

	// ---- AI 生成 commit / PR 文案（一次性 LLM 调用，不进聊天流）----
	let genning = $state<'' | 'commit' | 'pr'>('');
	async function genCommit() {
		if (!llm || genning) return;
		genning = 'commit';
		error = '';
		try {
			const d = (await git(['diff', '--cached', '--no-color'], dir())) as string;
			if (!d.trim()) {
				error = t('dock.git.noStagedForAi');
				return;
			}
			const sys =
				'You write conventional git commit messages. Output ONLY the commit message: a concise summary line (≤72 chars, imperative mood), then optionally a blank line and short body bullets. No code fences, no surrounding quotes.';
			const out = await generateText(llm.provider, llm.baseUrl, llm.format, llm.model, sys, d.slice(0, 14000));
			if (out.trim()) message = out.trim();
		} catch (e) {
			error = String(e);
		} finally {
			genning = '';
		}
	}
	async function genPr() {
		if (!llm || genning) return;
		genning = 'pr';
		prError = '';
		try {
			const base = prBase || defaultBaseBranch(branches, branch);
			const d = (await git(['diff', '--no-color', `${base}...HEAD`], dir())) as string;
			if (!d.trim()) {
				prError = t('dock.git.noDiffForAi');
				return;
			}
			const sys =
				'You write GitHub pull-request descriptions. Output the PR title on the first line (≤72 chars, no prefix), then a blank line, then a markdown body: a one-line summary followed by bullet points of the notable changes. No code fences.';
			const out = await generateText(llm.provider, llm.baseUrl, llm.format, llm.model, sys, d.slice(0, 16000));
			const lines = out.trim().split('\n');
			const title = (lines.shift() ?? '').replace(/^#+\s*/, '').trim();
			if (title) prTitle = title;
			prBody = lines.join('\n').trim();
		} catch (e) {
			prError = String(e);
		} finally {
			genning = '';
		}
	}

	async function showDiff(c: Change) {
		try {
			if (c.untracked) {
				diff = { path: c.path, lines: classify(t('dock.git.untrackedDiff')) };
				return;
			}
			const args = c.staged && c.y === ' ' ? ['diff', '--cached', '--no-color', '--', c.path] : ['diff', '--no-color', '--', c.path];
			const text = await git(args, dir());
			diff = { path: c.path, lines: classify(text || t('dock.git.noDiff')) };
		} catch (e) {
			diff = { path: c.path, lines: classify(String(e)) };
		}
	}

	// --- 分支管理 ---
	async function switchBranch(name: string) {
		branchOpen = false;
		if (name === branch || busy) return;
		// 工作区有会丢失的改动时让 git 自己拒绝，其 stderr 原样展示。
		await run(['switch', name]);
		if (ghState === 'ready') loadPr();
	}
	async function createBranch() {
		const name = newBranch.trim();
		if (!name || busy) return;
		if (!isValidBranchName(name)) {
			error = t('dock.git.badBranchName');
			return;
		}
		branchOpen = false;
		newBranch = '';
		await run(['switch', '--create', name]);
		if (ghState === 'ready') loadPr();
	}

	// --- 远端同步 ---
	async function doSync(kind: 'pull' | 'push' | 'fetch') {
		if (busy || syncBusy) return;
		syncBusy = kind;
		error = '';
		try {
			if (kind === 'pull') await git(['pull', '--ff-only'], dir());
			else if (kind === 'fetch') await git(['fetch'], dir());
			else if (sync.upstream) await git(['push'], dir());
			else await git(['push', '-u', 'origin', branch], dir()); // 无上游：首推并建立跟踪
			await refresh();
			if (ghState === 'ready') loadPr();
		} catch (e) {
			error = String(e);
		} finally {
			syncBusy = '';
		}
	}

	// --- GitHub PR ---
	async function checkGh() {
		try {
			if (!parseGhVersion(await gh(['--version'], dir()))) {
				ghState = 'missing';
				return;
			}
		} catch {
			ghState = 'missing';
			return;
		}
		try {
			if (!hasGitHubRemote(await git(['remote', '-v'], dir()))) {
				ghState = 'noRemote';
				return;
			}
		} catch {
			ghState = 'noRemote';
			return;
		}
		try {
			await gh(['auth', 'status'], dir());
		} catch {
			ghState = 'unauthed';
			return;
		}
		ghState = 'ready';
		await loadPr();
	}
	async function loadPr() {
		try {
			pr = parsePrView(await gh(['pr', 'view', '--json', 'url,title,state,isDraft'], dir()));
		} catch {
			pr = null; // 当前分支还没有 PR
		}
	}
	async function openPrForm() {
		prError = '';
		prBody = '';
		prDraft = false;
		prBase = defaultBaseBranch(branches, branch);
		try {
			prTitle = (await git(['log', '-1', '--pretty=%s'], dir())).trim();
		} catch {
			prTitle = '';
		}
		prForm = true;
	}
	async function createPr() {
		if (!prTitle.trim() || prBusy) return;
		prBusy = true;
		prError = '';
		try {
			const args = ['pr', 'create', '--title', prTitle.trim(), '--body', prBody];
			if (prBase) args.push('--base', prBase);
			if (prDraft) args.push('--draft');
			const out = await gh(args, dir());
			const url = extractPrUrl(out);
			const created: PrInfo | null = url ? { url, title: prTitle.trim(), state: 'OPEN', isDraft: prDraft } : null;
			prForm = false;
			await loadPr();
			if (!pr && created) pr = created;
			await refresh(); // 创建 PR 可能顺带推送了分支
		} catch (e) {
			prError = String(e);
		} finally {
			prBusy = false;
		}
	}
	function copyCmd(cmd: string) {
		navigator.clipboard?.writeText(cmd).catch(() => {});
		copied = cmd;
		setTimeout(() => {
			if (copied === cmd) copied = '';
		}, 1500);
	}
</script>

<div class="git">
	{#if error && changes.length === 0 && !branch}
		<div class="err">{error.includes('not a git repository') ? t('dock.git.notRepo') : error}</div>
	{:else}
		<div class="bar">
			<GitBranch size={14} class="bcol" />
			<button class="branchbtn" onclick={() => (branchOpen = !branchOpen)} title={t('dock.git.switchBranch')} aria-expanded={branchOpen}>
				<span class="branch">{branch || 'detached'}</span>
				<ChevronDown size={12} />
			</button>
			{#if sync.upstream && (sync.ahead || sync.behind)}
				<span class="ab" title={t('dock.git.aheadBehind', { upstream: sync.upstream, ahead: sync.ahead, behind: sync.behind })}>
					{#if sync.ahead}<span class="up"><ArrowUp size={11} />{sync.ahead}</span>{/if}
					{#if sync.behind}<span class="down"><ArrowDown size={11} />{sync.behind}</span>{/if}
				</span>
			{/if}
			<IconButton size="sm" onclick={refresh} label="refresh"><RefreshCw size={13} /></IconButton>
		</div>
		{#if branchOpen}
			<div class="pop-catch" role="presentation" onclick={() => (branchOpen = false)}></div>
			<div class="pop" role="menu">
				<div class="poplist">
					{#each branches as b (b)}
						<button class="popitem" class:cur={b === branch} role="menuitem" onclick={() => switchBranch(b)} disabled={busy}>
							<span class="popname">{b}</span>
							{#if b === branch}<Check size={12} />{/if}
						</button>
					{/each}
				</div>
				<div class="popnew">
					<input
						bind:value={newBranch}
						placeholder={t('dock.git.newBranchPlaceholder')}
						onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), createBranch())}
					/>
					<Button size="sm" onclick={createBranch} disabled={!newBranch.trim() || busy}>{t('dock.git.createBranch')}</Button>
				</div>
			</div>
		{/if}
		<div class="syncrow">
			<Button size="sm" onclick={() => doSync('pull')} disabled={busy || !!syncBusy}>
				{#if syncBusy === 'pull'}<LoaderCircle size={13} class="gspin" />{:else}<ArrowDown size={13} />{/if}
				{t('dock.git.pull')}
			</Button>
			<Button size="sm" onclick={() => doSync('push')} disabled={busy || !!syncBusy}>
				{#if syncBusy === 'push'}<LoaderCircle size={13} class="gspin" />{:else}<ArrowUp size={13} />{/if}
				{t('dock.git.push')}{#if sync.ahead > 0}&nbsp;({sync.ahead}){/if}
			</Button>
			<Button size="sm" onclick={() => doSync('fetch')} disabled={busy || !!syncBusy}>
				{#if syncBusy === 'fetch'}<LoaderCircle size={13} class="gspin" />{:else}<RefreshCw size={13} />{/if}
				{t('dock.git.fetch')}
			</Button>
		</div>
		{#if error}
			<div class="oerr" role="button" tabindex="0" onclick={() => (error = '')} onkeydown={(e) => e.key === 'Enter' && (error = '')} title={t('dock.git.closeHint')}>{error}</div>
		{/if}
		<div class="scroll">
			{#if worktree}
				<!-- 当前项目是并行任务 worktree：生命周期操作放最上面 -->
				<ParallelTasks {cwd} {worktree} {onTaskRemoved} />
			{/if}
			<div class="sec">
				{t('dock.git.changes')} <span class="count">{changes.length}</span>
				{#if changes.length}<button class="seclink" onclick={stageAll} disabled={busy}>{t('dock.git.stageAll')}</button>{/if}
			</div>
			{#each changes as c (c.path)}
				<div class="chg">
					<span class="code" class:staged={c.staged}>{c.x === ' ' ? '·' : c.x}{c.y === ' ' ? '·' : c.y}</span>
					<button class="cpath" onclick={() => showDiff(c)} title={c.path}>{c.path}</button>
					<div class="acts">
						{#if c.staged}
							<IconButton size="sm" onclick={() => unstage(c)} disabled={busy} label="unstage" title={t('dock.git.unstage')}><Minus size={13} /></IconButton>
						{/if}
						{#if c.y !== ' ' || c.untracked}
							<IconButton size="sm" onclick={() => stage(c)} disabled={busy} label="stage" title={t('dock.git.stage')}><Plus size={13} /></IconButton>
						{/if}
						<IconButton size="sm" onclick={() => discard(c)} disabled={busy} label="discard" title={t('dock.git.discard')}><Undo2 size={13} /></IconButton>
					</div>
				</div>
			{/each}
			{#if changes.length === 0}<div class="clean">{t('dock.git.clean')}</div>{/if}

			<div class="sec">{t('dock.git.pr')}</div>
			{#if ghState === 'checking'}
				<div class="ghrow dim">{t('dock.git.ghChecking')}</div>
			{:else if ghState === 'missing'}
				<div class="ghrow">
					{t('dock.git.ghMissing')}
					<button class="cmd" onclick={() => copyCmd('brew install gh')} title={t('dock.git.copyCmd')}>
						{copied === 'brew install gh' ? t('common.copied') : 'brew install gh'}
					</button>
				</div>
			{:else if ghState === 'unauthed'}
				<div class="ghrow">
					{t('dock.git.ghUnauthed')}
					<button class="cmd" onclick={() => copyCmd('gh auth login')} title={t('dock.git.copyCmd')}>
						{copied === 'gh auth login' ? t('common.copied') : 'gh auth login'}
					</button>
				</div>
			{:else if ghState === 'noRemote'}
				<div class="ghrow dim">{t('dock.git.noGithubRemote')}</div>
			{:else if pr}
				<div class="prrow">
					<span class="prstate {pr.state.toLowerCase()}">{pr.isDraft ? 'DRAFT' : pr.state}</span>
					<button class="prlink" onclick={() => pr && openUrl(pr.url)} title={t('dock.git.prOpenHint')}>
						<span class="prtitle">{pr.title || pr.url}</span>
						<ExternalLink size={11} />
					</button>
				</div>
			{:else}
				<div class="prrow">
					<Button size="sm" onclick={openPrForm} disabled={busy}><GitPullRequest size={13} /> {t('dock.git.createPr')}</Button>
				</div>
			{/if}

			{#if !worktree}
				<!-- 主仓库：列出它名下的并行任务 worktree -->
				<ParallelTasks {cwd} {onOpenTask} {onTaskRemoved} />
			{/if}

			<div class="sec">{t('dock.git.history')}</div>
			{#each commits as c (c)}
				<div class="commit">
					<span class="hash">{c.slice(0, 7)}</span>
					<span class="msg">{c.slice(8)}</span>
				</div>
			{/each}
		</div>

		{#if stagedCount > 0}
			<div class="commitbar">
				{#if llm}
					<button class="ai-btn" onclick={genCommit} disabled={!!genning} title={t('dock.git.aiCommit')} aria-label="generate commit message">
						{#if genning === 'commit'}<LoaderCircle size={14} class="spin" />{:else}<Sparkles size={14} />{/if}
					</button>
				{/if}
				<input
					bind:value={message}
					placeholder={t('dock.git.commitPlaceholder')}
					onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), commit())}
				/>
				<Button size="sm" variant="primary" onclick={commit} disabled={!message.trim() || busy}>{t('dock.git.commit', { n: stagedCount })}</Button>
			</div>
		{/if}
	{/if}
</div>

{#if diff}
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (diff = null)}>
		<div class="sheet" role="dialog" tabindex="-1" aria-label={diff.path}>
			<div class="sheet-head">
				<span class="sheet-name">{diff.path}</span>
				<IconButton onclick={() => (diff = null)} label="close"><X size={15} /></IconButton>
			</div>
			<pre class="diff">{#each diff.lines as d (d)}<span class={d.cls}>{d.line}
</span>{/each}</pre>
		</div>
	</div>
{/if}

{#if prForm}
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && !prBusy && (prForm = false)}>
		<div class="sheet prsheet" role="dialog" tabindex="-1" aria-label={t('dock.git.prCreateTitle')}>
			<div class="sheet-head">
				<span class="sheet-name">{t('dock.git.prCreateTitle')}</span>
				<IconButton onclick={() => (prForm = false)} label="close"><X size={15} /></IconButton>
			</div>
			<div class="prform">
				{#if llm}
					<button class="ai-btn wide" onclick={genPr} disabled={!!genning}>
						{#if genning === 'pr'}<LoaderCircle size={13} class="spin" />{:else}<Sparkles size={13} />{/if}
						<span>{t('dock.git.aiPr')}</span>
					</button>
				{/if}
				<label class="pfield">
					<span>{t('dock.git.prTitleLabel')}</span>
					<input bind:value={prTitle} />
				</label>
				<label class="pfield">
					<span>{t('dock.git.prBodyLabel')}</span>
					<textarea bind:value={prBody} rows="5" placeholder={t('dock.git.prBodyPlaceholder')}></textarea>
				</label>
				<div class="prow">
					<label class="pfield base">
						<span>{t('dock.git.prBaseLabel')}</span>
						<select bind:value={prBase}>
							{#each branches.filter((b) => b !== branch) as b (b)}<option value={b}>{b}</option>{/each}
						</select>
					</label>
					<label class="pcheck"><input type="checkbox" bind:checked={prDraft} /> {t('dock.git.prDraft')}</label>
				</div>
				{#if prError}
					<div class="oerr" role="button" tabindex="0" onclick={() => (prError = '')} onkeydown={(e) => e.key === 'Enter' && (prError = '')} title={t('dock.git.closeHint')}>{prError}</div>
				{/if}
				<div class="practs">
					<Button size="sm" variant="primary" onclick={createPr} disabled={!prTitle.trim() || prBusy}>
						{#if prBusy}<LoaderCircle size={13} class="gspin" /> {t('dock.git.prCreating')}{:else}{t('dock.git.prSubmit')}{/if}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.git {
		display: flex;
		flex-direction: column;
		height: 100%;
		position: relative;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	:global(.bcol) {
		color: var(--accent-bright);
	}
	.branchbtn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		padding: 3px 6px;
		margin: -3px -6px;
		border-radius: var(--r-sm);
		text-align: left;
	}
	.branchbtn:hover {
		background: var(--surface2);
	}
	.branch {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 500;
	}
	.ab {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 11px;
		flex-shrink: 0;
	}
	.ab .up,
	.ab .down {
		display: inline-flex;
		align-items: center;
		gap: 1px;
	}
	.ab .up {
		color: var(--ok);
	}
	.ab .down {
		color: var(--warn);
	}
	.pop-catch {
		position: fixed;
		inset: 0;
		z-index: 49;
	}
	.pop {
		position: absolute;
		top: 40px;
		left: 10px;
		right: 10px;
		z-index: 50;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.poplist {
		max-height: 220px;
		overflow-y: auto;
		padding: 4px;
	}
	.popitem {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 12.5px;
		padding: 6px 8px;
		border-radius: var(--r-sm);
		text-align: left;
	}
	.popitem:hover {
		background: var(--surface2);
	}
	.popitem.cur {
		color: var(--accent-bright);
	}
	.popitem:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.popname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.popnew {
		display: flex;
		gap: 6px;
		padding: 7px;
		border-top: 1px solid var(--hairline);
	}
	.popnew input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 5px 8px;
		outline: none;
	}
	.popnew input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.syncrow {
		display: flex;
		gap: 6px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--hairline);
	}
	.syncrow :global(.b) {
		flex: 1;
	}
	:global(.gspin) {
		animation: gspin 0.9s linear infinite;
	}
	@keyframes gspin {
		to {
			transform: rotate(360deg);
		}
	}
	.ghrow {
		padding: 6px 9px;
		font-size: 12px;
		color: var(--dim);
		line-height: 1.7;
	}
	.ghrow.dim {
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.cmd {
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--accent-bright);
		font-family: var(--font-mono);
		font-size: 11.5px;
		padding: 1px 7px;
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.cmd:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.prrow {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 9px;
		min-width: 0;
	}
	.prstate {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.05em;
		padding: 1px 7px;
		border-radius: 999px;
		flex-shrink: 0;
		color: var(--dim);
		background: var(--surface2);
	}
	.prstate.open {
		color: var(--ok);
		background: color-mix(in oklab, var(--ok) 14%, transparent);
	}
	.prstate.merged {
		color: var(--accent-bright);
		background: color-mix(in oklab, var(--accent) 14%, transparent);
	}
	.prstate.closed {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 14%, transparent);
	}
	.prlink {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 12.5px;
		padding: 2px 0;
		text-align: left;
	}
	.prlink:hover {
		color: var(--accent-bright);
	}
	.prtitle {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.prsheet {
		width: min(440px, 92vw);
	}
	.prform {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px 14px;
		overflow-y: auto;
	}
	.pfield {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--dim);
	}
	.pfield input,
	.pfield textarea,
	.pfield select {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13px;
		padding: 7px 10px;
		outline: none;
		resize: vertical;
	}
	.pfield input:focus,
	.pfield textarea:focus,
	.pfield select:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.prow {
		display: flex;
		align-items: flex-end;
		gap: 12px;
	}
	.prow .base {
		flex: 1;
	}
	.pcheck {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--dim);
		padding-bottom: 8px;
		cursor: pointer;
	}
	.practs {
		display: flex;
		justify-content: flex-end;
	}
	.prform .oerr {
		margin: 0;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 6px 8px 14px;
	}
	.sec {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 8px 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.count {
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 999px;
		padding: 0 7px;
		font-size: 10px;
	}
	.seclink {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--accent-bright);
		font-size: 11px;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 5px;
	}
	.seclink:hover {
		background: var(--surface2);
	}
	.seclink:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.chg {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 4px 6px 4px 9px;
		border-radius: var(--r-sm);
	}
	.chg:hover {
		background: var(--surface2);
	}
	.code {
		font-family: var(--font-mono);
		font-size: 11px;
		width: 20px;
		color: var(--warn);
		flex-shrink: 0;
		letter-spacing: 1px;
	}
	.code.staged {
		color: var(--ok);
	}
	.cpath {
		flex: 1;
		min-width: 0;
		text-align: left;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 2px 0;
	}
	.cpath:hover {
		color: var(--accent-bright);
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		opacity: 0;
	}
	.chg:hover .acts {
		opacity: 1;
	}
	.clean {
		padding: 8px 9px;
		font-size: 12px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.commit {
		display: flex;
		gap: 9px;
		padding: 6px 9px;
		font-size: 13px;
	}
	.hash {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.msg {
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.commitbar {
		display: flex;
		align-items: stretch;
		gap: 8px;
		padding: 10px 12px;
		border-top: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	/* AI-generate affordance (commit message / PR text). */
	.ai-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 0 9px;
		border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--border));
		border-radius: var(--r-sm);
		background: var(--accent-soft);
		color: var(--accent-bright);
		cursor: pointer;
		flex-shrink: 0;
	}
	.ai-btn:hover {
		background: color-mix(in oklab, var(--accent) 18%, transparent);
	}
	.ai-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ai-btn.wide {
		width: 100%;
		padding: 7px 10px;
		font-size: 12.5px;
		margin-bottom: 2px;
	}
	.commitbar input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13px;
		padding: 7px 10px;
		outline: none;
	}
	.commitbar input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.commitbar input::placeholder {
		color: var(--dim2);
	}
	.err {
		padding: 18px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
	}
	.oerr {
		margin: 8px 12px 0;
		padding: 7px 10px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 30%, transparent);
		border-radius: var(--r-sm);
		white-space: pre-wrap;
		word-break: break-word;
		cursor: pointer;
	}
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 55;
	}
	.sheet {
		width: min(760px, 92vw);
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.sheet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.sheet-name {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.diff {
		margin: 0;
		padding: 12px 14px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		color: var(--text);
	}
	.diff .add {
		color: var(--ok);
		background: color-mix(in oklab, var(--ok) 10%, transparent);
		display: block;
	}
	.diff .del {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 10%, transparent);
		display: block;
	}
	.diff .hunk {
		color: var(--accent-bright);
		display: block;
	}
	.diff .meta {
		color: var(--dim);
		display: block;
	}
	.diff .ctx {
		display: block;
	}
</style>
