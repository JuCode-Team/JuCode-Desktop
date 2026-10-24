<script lang="ts">
	// Where a new conversation goes, asked before it opens (⌘N, the title
	// bar's +, the palette, the tray): the projects, no project, or a folder
	// to add. The conversation can still move while it is a draft
	// (NewSessionPicker).
	import { tick } from 'svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import SquareDashedIcon from '@lucide/svelte/icons/square-dashed';
	import Modal from '$lib/ui/Modal.svelte';
	import ProjectBadge from '$lib/sidebar/ProjectBadge.svelte';
	import { t } from '$lib/i18n';
	import { binding, keysLabel, matches } from '$lib/shortcuts';
	import { LOOSE_ID, type Project } from '$lib/types';

	let {
		projects,
		current,
		loose,
		onPick,
		onOpenFolder,
		onClose
	}: {
		projects: Project[];
		/** The project picked when nothing else is: the active one. */
		current?: string;
		/** A conversation of no project has a folder to work in (the active
		 *  one's, or a project's): else it is not offered. */
		loose: boolean;
		/** null: no project. */
		onPick: (p: Project | null) => void;
		onOpenFolder: () => void;
		onClose: () => void;
	} = $props();

	type Row = { key: string; label: string; desc?: string; project?: Project; run: () => void };

	let query = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	const short = (path: string) => path.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
	const done = (fn: () => void) => () => {
		onClose();
		fn();
	};

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? projects.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(q)) : projects;
	});
	const rows = $derived<Row[]>([
		...shown.map((p) => ({ key: p.id, label: p.name, desc: short(p.path), project: p, run: done(() => onPick(p)) })),
		...(loose ? [{ key: LOOSE_ID, label: t('shell.noProject'), run: done(() => onPick(null)) }] : []),
		{ key: 'open', label: t('shell.startPicker.openFolder'), run: done(onOpenFolder) }
	]);
	let idx = $state(0);
	// The active project first in line, else the first match.
	$effect(() => {
		const at = rows.findIndex((r) => r.key === current);
		idx = query.trim() || at < 0 ? 0 : at;
	});
	$effect(() => {
		tick().then(() => inputEl?.focus());
	});
	const digit = (n: number) => keysLabel({ ...binding('sessionN'), key: String(n) });

	function onKey(e: KeyboardEvent) {
		const n = matches(e, 'sessionN');
		if (typeof n === 'number' && n > 0) {
			// The window's own ⌘1…9 switches conversations: not while this is open.
			e.preventDefault();
			e.stopPropagation();
			if (shown[n - 1]) rows[n - 1]!.run();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			idx = Math.min(idx + 1, rows.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			idx = Math.max(idx - 1, 0);
		} else if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			rows[idx]?.run();
		}
	}
</script>

<Modal label={t('shell.projectPick.label')} width={560} placement="top" padded={false} {onClose}>
	<div class="search">
		<SearchIcon size={16} />
		<input bind:this={inputEl} bind:value={query} onkeydown={onKey} placeholder={t('shell.projectPick.search')} />
	</div>
	<div class="rows">
		<div class="group">{t('shell.projects')}</div>
		{#each rows as r, i (r.key)}
			<button class="row" class:sel={i === idx} onclick={r.run} onmouseenter={() => (idx = i)}>
				<span class="ico">
					{#if r.project}<ProjectBadge project={r.project} size={18} />{:else if r.key === LOOSE_ID}<SquareDashedIcon size={16} />{:else}<FolderPlusIcon size={16} />{/if}
				</span>
				<span class="text">
					<span class="label">{r.label}</span>
					{#if r.desc}<span class="desc">{r.desc}</span>{/if}
				</span>
				{#if r.project && i < 9}<span class="keys">{digit(i + 1)}</span>{/if}
			</button>
		{/each}
	</div>
	<div class="foot">{t('shell.projectPick.foot')}</div>
</Modal>

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 13px 16px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
	}
	.search input {
		flex: 1;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-lg);
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.rows {
		max-height: calc(64vh - 90px);
		overflow-y: auto;
		padding: 6px;
	}
	.group {
		padding: 8px 11px 4px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		text-align: left;
		padding: 8px 11px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: var(--fs-sm);
	}
	.row.sel {
		background: var(--surface2);
	}
	.ico {
		display: inline-flex;
		justify-content: center;
		width: 18px;
		flex-shrink: 0;
		color: var(--dim);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.label,
	.desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.desc {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.keys {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		flex-shrink: 0;
	}
	.foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		text-align: center;
	}
</style>
