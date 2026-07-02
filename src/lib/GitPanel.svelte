<script lang="ts">
	import { onMount } from 'svelte';
	import { GitBranch, RefreshCw, X, Plus, Minus, Undo2 } from 'lucide-svelte';
	import { ask } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { git } from '$lib/protocol';
	import { t } from '$lib/i18n';

	let { cwd = '' }: { cwd?: string } = $props();
	const dir = () => cwd || undefined;

	type Change = { x: string; y: string; path: string; staged: boolean; untracked: boolean };

	let branch = $state('');
	let changes = $state<Change[]>([]);
	let commits = $state<string[]>([]);
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let diff = $state<{ path: string; lines: { line: string; cls: string }[] } | null>(null);

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
	onMount(refresh);

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
</script>

<div class="git">
	{#if error && changes.length === 0 && !branch}
		<div class="err">{error.includes('not a git repository') ? t('dock.git.notRepo') : error}</div>
	{:else}
		<div class="bar">
			<GitBranch size={14} class="bcol" />
			<span class="branch">{branch || 'detached'}</span>
			<IconButton size="sm" onclick={refresh} label="refresh"><RefreshCw size={13} /></IconButton>
		</div>
		{#if error}
			<div class="oerr" role="button" tabindex="0" onclick={() => (error = '')} onkeydown={(e) => e.key === 'Enter' && (error = '')} title={t('dock.git.closeHint')}>{error}</div>
		{/if}
		<div class="scroll">
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

<style>
	.git {
		display: flex;
		flex-direction: column;
		height: 100%;
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
	.branch {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 500;
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
		gap: 8px;
		padding: 10px 12px;
		border-top: 1px solid var(--hairline);
		flex-shrink: 0;
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
