<script lang="ts">
	// The files a turn edited: one line, closed by default (most readers
	// don't need it); open, a row per file with its line counts.
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Collapse from '$lib/ui/Collapse.svelte';
	import DiffStat from '$lib/DiffStat.svelte';
	import { relativeTo, type EditedFile } from '$lib/turnSummary';
	import { t } from '$lib/i18n';

	let { files, root = '', onFile }: { files: EditedFile[]; root?: string; onFile?: (path: string) => void } = $props();

	let open = $state(false);
	const add = $derived(files.reduce((n, f) => n + f.add, 0));
	const del = $derived(files.reduce((n, f) => n + f.del, 0));
</script>

<div class="edited">
	<button class="head" class:open onclick={() => (open = !open)} aria-expanded={open}>
		<span class="chev"><ChevronRightIcon size={14} /></span>
		<span>{t('chat.edited.title', { n: files.length })}</span>
		<DiffStat {add} {del} />
	</button>
	<Collapse {open}>
		<div class="rows">
			{#each files as f (f.path)}
				<button class="row" data-file={f.path} title={f.path} onclick={() => onFile?.(f.path)}>
					<span class="path">{relativeTo(f.path, root)}</span>
					<DiffStat add={f.add} del={f.del} />
				</button>
			{/each}
		</div>
	</Collapse>
</div>

<style>
	.edited {
		margin-top: 10px;
	}
	.head {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 26px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.head:hover {
		color: var(--text);
	}
	.chev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-out);
	}
	.head.open .chev {
		transform: rotate(90deg);
	}
	.rows {
		display: flex;
		flex-direction: column;
		margin: 2px 0 0 21px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 26px;
		padding: 2px 8px;
		margin-left: -8px;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--dim);
		text-align: left;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.row:hover {
		background: var(--accent-soft);
		color: var(--text);
	}
	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
</style>
