<script lang="ts">
	// Browse a project's files read-only: folders (git-ignored entries
	// hidden) and a highlighted view of one file.
	import hljs from '$lib/hljs';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FileIcon from 'phosphor-svelte/lib/FileIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Notice from '$lib/ui/Notice.svelte';
	import RemoteScreen from './RemoteScreen.svelte';
	import { baseName, type DirListing, type FileContent } from './store.svelte';
	import { useHost } from './connection.svelte';
	import { t } from '$lib/i18n';

	let {
		root,
		title,
		file: target,
		line,
		onBack
	}: {
		root: string;
		title: string;
		/** A file to show right away (one a reply named), at `line`. */
		file?: string;
		line?: number;
		onBack: () => void;
	} = $props();
	const remoteProjects = useHost().projects;

	let listing = $state<DirListing | null>(null);
	let file = $state<FileContent | null>(null);
	let error = $state('');
	let loading = $state(false);
	/** The row tapped last, marked while its folder or file loads. */
	let pending = $state<string | null>(null);

	async function load<T>(work: () => Promise<T>, path: string): Promise<T | null> {
		loading = true;
		pending = path;
		error = '';
		try {
			return await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return null;
		} finally {
			loading = false;
			pending = null;
		}
	}

	async function openDir(path: string) {
		const next = await load(() => remoteProjects.list(path), path);
		if (next) {
			listing = next;
			file = null;
		}
	}

	async function openFile(path: string) {
		const next = await load(() => remoteProjects.read(path), path);
		if (next) file = next;
	}

	$effect(() => {
		void openDir(root).then(() => {
			if (target) void openFile(target);
		});
	});

	// The named line, scrolled to and marked once its file shows.
	let codeEl = $state<HTMLDivElement | null>(null);
	let markEl = $state<HTMLDivElement | null>(null);
	let mark = $state<number | null>(null);
	$effect(() => {
		if (!line || !file || !codeEl || file.path !== target) return;
		const pre = codeEl.querySelector('pre.src');
		if (!pre) return;
		const style = getComputedStyle(pre);
		mark = parseFloat(style.paddingTop) + (line - 1) * (parseFloat(style.lineHeight) || 18);
	});
	$effect(() => markEl?.scrollIntoView({ block: 'center' }));

	const rootPath = $derived(root.replace(/[\\/]+$/, ''));
	const relative = (path: string) => path.slice(rootPath.length).replace(/^[\\/]/, '') || undefined;
	const parent = $derived.by(() => {
		if (!listing || listing.path === rootPath) return null;
		return listing.path.slice(0, listing.path.search(/[\\/][^\\/]*$/));
	});

	const highlighted = $derived.by(() => {
		if (!file?.text) return '';
		const ext = baseName(file.path).split('.').pop()?.toLowerCase() ?? '';
		const language = hljs.getLanguage(ext) ? ext : 'plaintext';
		// Large files stay plain: highlighting them would stall a phone.
		if (file.text.length > 200_000) return hljs.highlight(file.text, { language: 'plaintext' }).value;
		return hljs.highlight(file.text, { language }).value;
	});
	const lineCount = $derived(file?.text ? file.text.replace(/\n$/, '').split('\n').length : 0);

	function back() {
		if (file) file = null;
		else if (parent) void openDir(parent);
		else onBack();
	}

	function size(bytes: number) {
		return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<RemoteScreen {title} subtitle={file ? relative(file.path) : listing ? relative(listing.path) : undefined} onBack={back}>
	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if file}
		<div class="view">
		{#if file.binary}
			<p class="empty">{t('shell.remote.binaryFile', { size: size(file.size) })}</p>
		{:else}
			{#if file.truncated}<Notice tone="warn">{t('shell.remote.truncated')}</Notice>{/if}
			<div class="code" bind:this={codeEl}>
				{#if mark !== null && file.path === target}<div class="mark" bind:this={markEl} style:top="{mark}px"></div>{/if}
				<pre class="gutter">{Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}</pre>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlight.js output escapes the source -->
				<pre class="src hljs">{@html highlighted}</pre>
			</div>
		{/if}
		</div>
	{:else if listing}
		{#key listing.path}
		<div class="view">
		{#if parent}
			<button class="row" class:pending={pending === parent} disabled={loading} onclick={() => openDir(parent!)}>
				{#if pending === parent}<CircleNotchIcon size={16} class="spin" />{:else}<ArrowUpIcon size={16} />{/if}
				<span class="name">..</span>
			</button>
		{/if}
		{#each listing.entries as entry (entry.name)}
			{@const path = `${listing.path}/${entry.name}`}
			<button class="row" class:pending={pending === path} disabled={loading} onclick={() => (entry.dir ? openDir(path) : openFile(path))}>
				{#if pending === path}<CircleNotchIcon size={16} class="spin" />{:else if entry.dir}<FolderIcon size={16} />{:else}<FileIcon size={16} />{/if}
				<span class="name">{entry.name}</span>
				{#if !entry.dir}<span class="size">{size(entry.size)}</span>{/if}
			</button>
		{:else}
			<p class="empty">{t('shell.remote.emptyFolder')}</p>
		{/each}
		{#if listing.truncated}<p class="empty">{t('shell.remote.truncated')}</p>{/if}
		</div>
		{/key}
	{/if}
	{#if loading && !listing}<p class="empty"><CircleNotchIcon size={14} class="spin" /></p>{/if}
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
		font-size: var(--fs-md);
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
		color: var(--text);
		background: var(--surface);
	}
	.row :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	/* A folder or file replacing the last one fades in. */
	.view {
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.size {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	/* The line a reply named. */
	.mark {
		position: absolute;
		left: 0;
		right: 0;
		height: 1.55em;
		background: color-mix(in oklab, var(--accent) 16%, transparent);
		pointer-events: none;
	}
	.code {
		position: relative;
		display: flex;
		margin: 0 -16px;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: 1.55;
	}
	.code pre {
		margin: 0;
		padding: 4px 8px;
	}
	.gutter {
		flex-shrink: 0;
		text-align: right;
		color: var(--dim2);
		border-right: 1px solid var(--hairline);
		user-select: none;
	}
	.src {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		color: var(--text);
	}
	.empty {
		color: var(--dim2);
		font-size: var(--fs-md);
	}
	.src :global(.hljs-comment),
	.src :global(.hljs-quote) {
		color: var(--dim2);
		font-style: italic;
	}
	.src :global(.hljs-keyword),
	.src :global(.hljs-selector-tag),
	.src :global(.hljs-built_in),
	.src :global(.hljs-name),
	.src :global(.hljs-tag) {
		color: var(--accent-bright);
	}
	.src :global(.hljs-string),
	.src :global(.hljs-attr),
	.src :global(.hljs-symbol),
	.src :global(.hljs-bullet) {
		color: var(--ok);
	}
	.src :global(.hljs-number),
	.src :global(.hljs-literal),
	.src :global(.hljs-regexp) {
		color: var(--warn);
	}
	.src :global(.hljs-title),
	.src :global(.hljs-section),
	.src :global(.hljs-type) {
		color: var(--info);
	}
	.src :global(.hljs-meta) {
		color: var(--dim);
	}
</style>
