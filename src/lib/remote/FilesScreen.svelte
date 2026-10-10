<script lang="ts">
	// Browse a project's files read-only, as a tree: a folder opens and
	// closes in place (read when first opened; git-ignored entries hidden),
	// a file shows highlighted.
	import hljs from '$lib/hljs';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
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

	/** Each folder read so far, by path: its listing, or why it could not be read. */
	const dirs = new SvelteMap<string, DirListing | { error: string }>();
	const open = new SvelteSet<string>();
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

	async function readDir(path: string) {
		pending = path;
		try {
			dirs.set(path, await remoteProjects.list(path));
		} catch (e) {
			dirs.set(path, { error: e instanceof Error ? e.message : String(e) });
		} finally {
			if (pending === path) pending = null;
		}
	}
	function toggle(path: string) {
		if (open.has(path)) return void open.delete(path);
		open.add(path);
		if (!dirs.has(path)) void readDir(path);
	}

	async function openFile(path: string) {
		const next = await load(() => remoteProjects.read(path), path);
		if (next) file = next;
	}

	$effect(() => {
		dirs.clear();
		open.clear();
		void readDir(rootPath).then(() => {
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
	/** The rows shown: every entry of an open folder, depth first. */
	type Row = { path: string; name: string; dir: boolean; size: number; depth: number } | { note: string; depth: number; err?: boolean };
	const rows = $derived.by(() => {
		const out: Row[] = [];
		const walk = (path: string, depth: number) => {
			const listed = dirs.get(path);
			if (!listed) return void out.push({ note: '', depth });
			if ('error' in listed) return void out.push({ note: listed.error, depth, err: true });
			if (!listed.entries.length) return void out.push({ note: t('shell.remote.emptyFolder'), depth });
			for (const entry of listed.entries) {
				const child = `${listed.path}/${entry.name}`;
				out.push({ path: child, name: entry.name, dir: entry.dir, size: entry.size, depth });
				if (entry.dir && open.has(child)) walk(child, depth + 1);
			}
			if (listed.truncated) out.push({ note: t('shell.remote.truncated'), depth });
		};
		walk(rootPath, 0);
		return out;
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
		else onBack();
	}

	function size(bytes: number) {
		return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<RemoteScreen {title} subtitle={file ? relative(file.path) : undefined} onBack={back}>
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
	{:else}
		<div class="view tree" role="tree">
			{#each rows as r, i ('path' in r ? r.path : `note:${i}`)}
				{#if 'path' in r}
					{@const isOpen = r.dir && open.has(r.path)}
					<button
						class="row"
						class:pending={pending === r.path}
						style:--depth={r.depth}
						role="treeitem"
						aria-expanded={r.dir ? isOpen : undefined}
						aria-selected={false}
						disabled={loading}
						onclick={() => (r.dir ? toggle(r.path) : openFile(r.path))}
					>
						<span class="caret" class:open={isOpen} class:none={!r.dir}><CaretRightIcon size={12} /></span>
						{#if pending === r.path}<CircleNotchIcon size={16} class="spin" />{:else if r.dir}{#if isOpen}<FolderOpenIcon size={16} />{:else}<FolderIcon size={16} />{/if}{:else}<FileIcon size={16} />{/if}
						<span class="name">{r.name}</span>
						{#if !r.dir}<span class="size">{size(r.size)}</span>{/if}
					</button>
				{:else if r.note}
					<p class="note" class:err={r.err} style:--depth={r.depth}>{r.note}</p>
				{:else}
					<p class="note" style:--depth={r.depth}><CircleNotchIcon size={14} class="spin" /></p>
				{/if}
			{/each}
		</div>
	{/if}
</RemoteScreen>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 10px 4px 10px calc(4px + var(--depth, 0) * 16px);
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
	.caret {
		display: inline-flex;
		flex: none;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.caret.none {
		visibility: hidden;
	}
	.note {
		margin: 0;
		padding: 8px 4px 8px calc(4px + var(--depth, 0) * 16px + 20px);
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.note.err {
		color: var(--err);
		overflow-wrap: anywhere;
	}
</style>
