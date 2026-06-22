<script lang="ts">
	import { onMount } from 'svelte';
	import { GitBranch, RefreshCw, X } from 'lucide-svelte';
	import { git } from '$lib/protocol';

	let { cwd = '' }: { cwd?: string } = $props();
	const dir = () => cwd || undefined;

	let branch = $state('');
	let changes = $state<{ code: string; path: string }[]>([]);
	let commits = $state<string[]>([]);
	let error = $state('');
	let diff = $state<{ path: string; lines: { line: string; cls: string }[] } | null>(null);

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
				.map((l) => ({ code: l.slice(0, 2).trim() || '·', path: l.slice(3) }));
			const log = await git(['log', '--oneline', '-n', '30', '--no-color'], dir());
			commits = log.split('\n').filter(Boolean);
		} catch (e) {
			error = String(e);
		}
	}
	onMount(refresh);

	async function showDiff(path: string) {
		try {
			const text = await git(['diff', '--no-color', '--', path], dir());
			diff = { path, lines: classify(text || '(no unstaged changes)') };
		} catch (e) {
			diff = { path, lines: classify(String(e)) };
		}
	}
</script>

<div class="git">
	{#if error}
		<div class="err">{error.includes('not a git repository') ? 'Not a git repository' : error}</div>
	{:else}
		<div class="bar">
			<GitBranch size={14} class="bcol" />
			<span class="branch">{branch || 'detached'}</span>
			<button class="ico" onclick={refresh} aria-label="refresh"><RefreshCw size={13} /></button>
		</div>
		<div class="scroll">
			<div class="sec">Changes <span class="count">{changes.length}</span></div>
			{#each changes as c (c.path)}
				<button class="chg" onclick={() => showDiff(c.path)}>
					<span class="code" class:staged={['M', 'A', 'D', 'R'].includes(c.code[0])}>{c.code}</span>
					<span class="cpath">{c.path}</span>
				</button>
			{/each}
			{#if changes.length === 0}<div class="clean">working tree clean</div>{/if}

			<div class="sec">Commits</div>
			{#each commits as c (c)}
				<div class="commit">
					<span class="hash">{c.slice(0, 7)}</span>
					<span class="msg">{c.slice(8)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if diff}
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (diff = null)}>
		<div class="sheet" role="dialog" tabindex="-1" aria-label={diff.path}>
			<div class="sheet-head">
				<span class="sheet-name">{diff.path}</span>
				<button class="ico" onclick={() => (diff = null)} aria-label="close"><X size={15} /></button>
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
	.ico {
		display: inline-flex;
		padding: 5px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: 6px;
		cursor: pointer;
	}
	.ico:hover {
		background: var(--surface2);
		color: var(--text);
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
	.chg {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 6px 9px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.chg:hover {
		background: var(--surface2);
	}
	.code {
		font-family: var(--font-mono);
		font-size: 11px;
		width: 18px;
		color: var(--warn);
		flex-shrink: 0;
	}
	.code.staged {
		color: var(--ok);
	}
	.cpath {
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	.err {
		padding: 18px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
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
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
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
