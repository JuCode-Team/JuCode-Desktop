<script lang="ts">
	// A project's uncommitted changes: the branch, changed files, and one
	// file's diff at a time.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import Notice from '$lib/ui/Notice.svelte';
	import RemoteScreen from './RemoteScreen.svelte';
	import type { GitFile, GitStatus } from './store.svelte';
	import { useHost } from './connection.svelte';
	import { t } from '$lib/i18n';

	let { root, title, onBack }: { root: string; title: string; onBack: () => void } = $props();
	const remoteProjects = useHost().projects;

	let status = $state<GitStatus | null>(null);
	let file = $state<GitFile | null>(null);
	let diff = $state<{ diff: string; truncated: boolean } | null>(null);
	let error = $state('');
	let loading = $state(false);
	/** The file tapped last, marked while its diff loads. */
	let pending = $state<string | null>(null);

	async function refresh() {
		loading = true;
		error = '';
		try {
			status = await remoteProjects.gitStatus(root);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}
	void refresh();

	async function show(next: GitFile) {
		loading = true;
		pending = next.path;
		error = '';
		try {
			diff = await remoteProjects.gitDiff(root, next.path);
			file = next;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
			pending = null;
		}
	}

	function back() {
		if (file) {
			file = null;
			diff = null;
		} else onBack();
	}

	/** Colors a diff line by its first character. */
	function kind(line: string) {
		if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) return 'head';
		if (line.startsWith('@@')) return 'hunk';
		if (line.startsWith('+')) return 'add';
		if (line.startsWith('-')) return 'del';
		return '';
	}
</script>

{#snippet refreshAction()}
	{#if !file}
		<button class="act" onclick={refresh} disabled={loading} aria-label={t('shell.remote.refresh')}>
			<span class="refresh" class:spin={loading && !pending}><ArrowClockwiseIcon size={16} /></span>
		</button>
	{/if}
{/snippet}

<RemoteScreen {title} subtitle={file ? file.path : status?.branch} onBack={back} actions={refreshAction}>
	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if file && diff}
		{#if diff.truncated}<Notice tone="warn">{t('shell.remote.truncated')}</Notice>{/if}
		<div class="view">
		{#if !diff.diff.trim()}
			<p class="empty">{t('shell.remote.noDiff')}</p>
		{:else}
			<pre class="diff">{#each diff.diff.split('\n') as line, i (i)}<span class={kind(line)}>{line || ' '}</span>{/each}</pre>
		{/if}
		</div>
	{:else if status}
		{#if !status.repo}
			<p class="empty">{t('shell.remote.notRepo')}</p>
		{:else}
			<div class="view">
			{#each status.files as f (f.path)}
				<button class="row" class:pending={pending === f.path} disabled={loading} onclick={() => show(f)}>
					<span class="code">{#if pending === f.path}<CircleNotchIcon size={13} class="spin" />{:else}{f.status.trim() || '·'}{/if}</span>
					<span class="path">{f.path}</span>
				</button>
			{:else}
				<p class="empty">{t('shell.remote.clean')}</p>
			{/each}
			</div>
		{/if}
	{/if}
	{#if loading && !status}<p class="empty"><CircleNotchIcon size={14} class="spin" /></p>{/if}
</RemoteScreen>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 11px 4px;
		border: none;
		border-bottom: 1px solid var(--hairline);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.row:disabled {
		cursor: default;
	}
	.row:not(:disabled):active {
		background: var(--surface2);
	}
	.row.pending {
		background: var(--surface);
	}
	.refresh {
		display: inline-flex;
	}
	/* The file list or a diff replacing it fades in. */
	.view {
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.code {
		width: 22px;
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--warn);
	}
	.path {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		overflow-wrap: anywhere;
	}
	.diff {
		margin: 0 -16px;
		padding: 4px 8px;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: 1.55;
	}
	.diff span {
		display: block;
		white-space: pre;
	}
	.add {
		color: var(--ok);
	}
	.del {
		color: var(--err);
	}
	.hunk {
		color: var(--info);
	}
	.head {
		color: var(--dim);
	}
	.empty {
		color: var(--dim2);
		font-size: var(--fs-md);
	}
</style>
