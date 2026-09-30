<script lang="ts">
	// A project's uncommitted changes: the branch, changed files, and one
	// file's diff at a time.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import Notice from '$lib/ui/Notice.svelte';
	import RemoteScreen from './RemoteScreen.svelte';
	import { remoteProjects, type GitFile, type GitStatus } from './store.svelte';
	import { t } from '$lib/i18n';

	let { root, title, onBack }: { root: string; title: string; onBack: () => void } = $props();

	let status = $state<GitStatus | null>(null);
	let file = $state<GitFile | null>(null);
	let diff = $state<{ diff: string; truncated: boolean } | null>(null);
	let error = $state('');
	let loading = $state(false);

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
		error = '';
		try {
			diff = await remoteProjects.gitDiff(root, next.path);
			file = next;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
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
	{#if !file}<button class="act" onclick={refresh} aria-label={t('shell.remote.refresh')}><ArrowClockwiseIcon size={16} /></button>{/if}
{/snippet}

<RemoteScreen {title} subtitle={file ? file.path : status?.branch} onBack={back} actions={refreshAction}>
	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if file && diff}
		{#if diff.truncated}<Notice tone="warn">{t('shell.remote.truncated')}</Notice>{/if}
		{#if !diff.diff.trim()}
			<p class="empty">{t('shell.remote.noDiff')}</p>
		{:else}
			<pre class="diff">{#each diff.diff.split('\n') as line, i (i)}<span class={kind(line)}>{line || ' '}</span>{/each}</pre>
		{/if}
	{:else if status}
		{#if !status.repo}
			<p class="empty">{t('shell.remote.notRepo')}</p>
		{:else}
			{#each status.files as f (f.path)}
				<button class="row" onclick={() => show(f)}>
					<span class="code">{f.status.trim() || '·'}</span>
					<span class="path">{f.path}</span>
				</button>
			{:else}
				<p class="empty">{t('shell.remote.clean')}</p>
			{/each}
		{/if}
	{/if}
	{#if loading}<p class="empty"><CircleNotchIcon size={14} class="spin" /></p>{/if}
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
