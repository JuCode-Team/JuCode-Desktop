<script lang="ts">
	// The project's files as a tree: a folder opens and closes in place (its
	// entries read when first opened), a file opens in the editor. ← → close
	// and open the focused folder, ↑ ↓ move between rows. Refresh reads every
	// open folder again.
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import ArrowsInLineVerticalIcon from 'phosphor-svelte/lib/ArrowsInLineVerticalIcon';
	import { projectRoot, listDir, type FsEntry } from '$lib/protocol';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { pathExt } from '$lib/fileRefs';
	import { t } from '$lib/i18n';

	let { rootDir = '' }: { rootDir?: string } = $props();
	let root = $state('');
	let error = $state('');

	/** Each folder read so far, by path: its entries, or why it could not be read. */
	const dirs = new SvelteMap<string, FsEntry[] | { error: string }>();
	const open = new SvelteSet<string>();

	async function read(path: string) {
		try {
			dirs.set(path, await listDir(path, root));
		} catch (e) {
			if (path === root) error = String(e);
			else dirs.set(path, { error: String(e) });
		}
	}

	$effect(() => {
		const want = rootDir;
		let cancelled = false;
		(async () => {
			const r = want || (await projectRoot());
			if (cancelled) return;
			root = r;
			error = '';
			dirs.clear();
			open.clear();
			await read(r);
		})();
		return () => {
			cancelled = true;
		};
	});

	async function refresh() {
		error = '';
		await Promise.all([root, ...open].map(read));
	}

	function toggle(e: FsEntry, to = !open.has(e.path)) {
		if (!to) return void open.delete(e.path);
		open.add(e.path);
		if (!dirs.has(e.path)) read(e.path);
	}

	const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
	/** Text files open in the editor (beside the tree), images full size;
	 *  anything else says why it can't be shown. */
	async function openFile(e: FsEntry) {
		if (IMAGES.has(pathExt(e.path))) return imageViewer.open([{ path: e.path }]);
		try {
			await editorStore.open(e.path, root);
		} catch (err) {
			toast.error(`${e.name}: ${String(err)}`);
		}
	}

	/** The rows shown: every entry of an open folder, depth first. */
	type Row = { entry: FsEntry; depth: number } | { note: string; depth: number; err?: boolean };
	const rows = $derived.by(() => {
		const out: Row[] = [];
		const walk = (path: string, depth: number) => {
			const listed = dirs.get(path);
			if (!listed) return void out.push({ note: t('dock.files.loading'), depth });
			if (!Array.isArray(listed)) return void out.push({ note: listed.error, depth, err: true });
			if (!listed.length && depth > 0) return void out.push({ note: t('dock.files.empty'), depth });
			for (const entry of listed) {
				out.push({ entry, depth });
				if (entry.is_dir && open.has(entry.path)) walk(entry.path, depth + 1);
			}
		};
		if (root) walk(root, 0);
		return out;
	});
	const name = $derived(root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root);

	let list = $state<HTMLElement | null>(null);
	function onKey(ev: KeyboardEvent, e: FsEntry) {
		const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('button.ent') ?? [])];
		const i = buttons.indexOf(ev.currentTarget as HTMLButtonElement);
		if (ev.key === 'ArrowDown') buttons[i + 1]?.focus();
		else if (ev.key === 'ArrowUp') buttons[i - 1]?.focus();
		else if (ev.key === 'ArrowRight' && e.is_dir) toggle(e, true);
		else if (ev.key === 'ArrowLeft' && e.is_dir && open.has(e.path)) toggle(e, false);
		else return;
		ev.preventDefault();
	}
</script>

<div class="files">
	<div class="bar">
		<span class="crumb" title={root}>{name}</span>
		<IconButton size="sm" onclick={() => open.clear()} disabled={!open.size} label={t('dock.files.collapseAll')}><ArrowsInLineVerticalIcon size={13} /></IconButton>
		<IconButton size="sm" onclick={refresh} label={t('dock.files.refresh')}><ArrowsClockwiseIcon size={13} /></IconButton>
	</div>
	{#if error}
		<div class="err"><Notice mono>{error}</Notice></div>
	{:else}
		<div class="list" role="tree" bind:this={list}>
			{#each rows as r, i ('entry' in r ? r.entry.path : `note:${i}`)}
				{#if 'entry' in r}
					{@const e = r.entry}
					{@const isOpen = e.is_dir && open.has(e.path)}
					<button
						class="ent"
						class:active={!e.is_dir && editorStore.visible && editorStore.activePath === e.path}
						style:--depth={r.depth}
						role="treeitem"
						aria-expanded={e.is_dir ? isOpen : undefined}
						aria-selected={!e.is_dir && editorStore.activePath === e.path}
						title={e.path}
						onclick={() => (e.is_dir ? toggle(e) : openFile(e))}
						onkeydown={(ev) => onKey(ev, e)}
					>
						{#each { length: r.depth } as _, g (g)}<span class="guide" style:--g={g}></span>{/each}
						<span class="caret" class:open={isOpen} class:none={!e.is_dir}><CaretRightIcon size={11} /></span>
						{#if e.is_dir}
							{#if isOpen}<FolderOpenIcon size={15} class="fcol" />{:else}<FolderIcon size={15} class="fcol" />{/if}
						{:else}<FileTextIcon size={15} />{/if}
						<span class="ename">{e.name}</span>
					</button>
				{:else}
					<div class="note" class:err={r.err} style:--depth={r.depth}>{r.note}</div>
				{/if}
			{/each}
			{#if root && Array.isArray(dirs.get(root)) && rows.length === 0}<div class="empty">{t('dock.files.empty')}</div>{/if}
		</div>
	{/if}
</div>


<style>
	.files {
		--indent: 14px;
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 10px 8px 16px;
		border-bottom: 1px solid var(--hairline);
	}
	.crumb {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.list {
		flex: 1;
		overflow: auto;
		padding: 6px;
	}
	.ent {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 28px;
		padding: 0 8px 0 calc(6px + var(--depth) * var(--indent));
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		text-align: left;
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.ent:hover {
		background: var(--surface2);
	}
	.ent.active {
		background: var(--surface2);
		font-weight: 500;
	}
	.ent:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	/* One hairline per level, under each parent's caret. */
	.guide {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(6px + var(--g) * var(--indent) + 6px);
		width: 1px;
		background: var(--hairline);
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
	:global(.fcol) {
		color: var(--accent-bright);
	}
	.ename {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note {
		padding: 4px 8px 4px calc(6px + var(--depth) * var(--indent) + 17px);
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.note.err {
		color: var(--err);
		overflow-wrap: anywhere;
	}
	.empty {
		padding: 16px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		text-align: center;
	}
	.err {
		padding: 10px;
	}
</style>
