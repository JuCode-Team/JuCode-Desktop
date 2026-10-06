<script lang="ts">
	// The project a requirement belongs to, as a chip that opens the list:
	// the workspace's projects, then 未归属.
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import { projectLabel } from './labels';
	import { t } from '$lib/i18n';

	let {
		value,
		projects,
		placement = 'down-right',
		onChange
	}: {
		/** A project's id; '' for none. */
		value: string;
		projects: { id: string; name: string }[];
		placement?: 'down-left' | 'down-right';
		onChange: (project: string) => void;
	} = $props();

	let open = $state(false);
	const items = $derived<PopMenuItem[]>([
		...projects.map((p) => ({ key: p.id, label: p.name, checked: p.id === value })),
		{ key: '', label: t('shell.requirement.noProject'), checked: !value }
	]);
</script>

<span class="pick">
	<button
		class="chip"
		class:none={!value}
		title={t('shell.requirement.project')}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={(e) => (e.stopPropagation(), (open = !open))}
	>
		<FolderIcon size={12} /><span class="name">{projectLabel(value, projects)}</span><CaretDownIcon size={10} />
	</button>
	{#if open}
		<PopMenu {items} {placement} onSelect={(k) => ((open = false), onChange(k))} onClose={() => (open = false)} />
	{/if}
</span>

<style>
	.pick {
		position: relative;
		display: inline-flex;
		min-width: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 200px;
		padding: 2px 8px;
		border: none;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.chip:hover {
		color: var(--text);
	}
	.chip.none {
		color: var(--dim2);
	}
	.name {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
