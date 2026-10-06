<script lang="ts" module>
	/** How to start a session on a requirement (the page carries it out):
	 *  `project` is a project's path. */
	export type StartHow = { project?: string; backend?: string; mode?: 'worktree' };
</script>

<script lang="ts">
	// 开始 on a requirement: one click starts in its project on the last
	// backend; the menu picks another project, a backend or a parallel task
	// (worktree). With no project yet, the click opens the menu.
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import { BACKEND_LABELS } from '$lib/backends';
	import type { Requirement } from '$lib/requirements.svelte';
	import { t } from '$lib/i18n';

	let {
		requirement,
		projects,
		size = 'sm',
		primary = false,
		onStart
	}: {
		requirement: Requirement;
		/** The projects to offer: the open workspace's. */
		projects: { id: string; path: string; name: string }[];
		size?: 'sm' | 'md';
		primary?: boolean;
		onStart: (how: StartHow) => void;
	} = $props();

	let open = $state(false);
	/** Its own project first, then the workspace's others. */
	const own = $derived(projects.find((p) => p.id === requirement.project));
	const offered = $derived([...(own ? [own] : []), ...projects.filter((p) => p !== own)]);
	const items = $derived<PopMenuItem[]>([
		...offered.slice(0, 6).map((p) => ({ key: `p:${p.path}`, label: t('shell.requirement.startIn', { project: p.name }), icon: FolderIcon })),
		...(own
			? [
					...(['jucode', 'claude', 'codex'] as const).map((b) => ({
						key: `b:${b}`,
						label: t('shell.requirement.startWith', { engine: BACKEND_LABELS[b] }),
						icon: CpuIcon
					})),
					{ key: 'worktree', label: t('shell.requirement.worktree'), desc: t('shell.requirement.worktreeDesc'), icon: GitBranchIcon }
				]
			: [])
	]);

	function pick(key: string) {
		open = false;
		if (key.startsWith('p:')) onStart({ project: key.slice(2) });
		else if (key.startsWith('b:')) onStart({ backend: key.slice(2) });
		else onStart({ mode: 'worktree' });
	}
	function main(e: MouseEvent) {
		e.stopPropagation();
		if (own) onStart({});
		else open = !open;
	}
</script>

<span class="split {size}" class:primary>
	<button class="go" onclick={main}>{t('shell.requirement.start')}</button>
	<button
		class="more"
		aria-label={t('shell.requirement.startMore')}
		title={t('shell.requirement.startMore')}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={(e) => (e.stopPropagation(), (open = !open))}><CaretDownIcon size={11} /></button
	>
	{#if open}
		<PopMenu {items} placement="down-left" onSelect={pick} onClose={() => (open = false)} />
	{/if}
</span>

<style>
	.split {
		position: relative;
		display: inline-flex;
		flex: none;
	}
	button {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--border-strong);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	button:hover {
		background: var(--surface2);
	}
	.go {
		padding: 3px 10px;
		border-radius: var(--r-sm) 0 0 var(--r-sm);
	}
	.more {
		padding: 3px 5px;
		border-left: none;
		border-radius: 0 var(--r-sm) var(--r-sm) 0;
	}
	.md .go {
		padding: 6px 14px;
		font-size: var(--fs-sm);
	}
	.md .more {
		padding: 6px 8px;
	}
	.primary button {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.primary .more {
		border-left: 1px solid color-mix(in oklab, var(--on-accent) 25%, transparent);
	}
	.primary button:hover {
		opacity: 0.88;
	}
</style>
