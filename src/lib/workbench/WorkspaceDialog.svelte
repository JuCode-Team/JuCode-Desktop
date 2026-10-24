<script lang="ts">
	// A new workspace, on purpose: a workspace is the top partition (work that
	// should not see other work), switched a few times a day, not a folder per
	// project. So it takes a step: what it is for, a name of the user's own,
	// which projects move into it; past a few workspaces, a reminder first.
	import LayersIcon from '@lucide/svelte/icons/layers';
	import Button from '$lib/ui/Button.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import ProjectBadge from '$lib/sidebar/ProjectBadge.svelte';
	import { t } from '$lib/i18n';
	import type { Project } from '$lib/types';

	/** Workspaces past which the dialog reminds before making another. */
	const MANY = 3;

	let {
		count,
		projects,
		onCreate,
		onClose
	}: {
		/** Workspaces there are already. */
		count: number;
		/** The current workspace's projects, which may move into the new one. */
		projects: Project[];
		onCreate: (name: string, move: Project[]) => void;
		onClose: () => void;
	} = $props();

	let name = $state('');
	let picked = $state<string[]>([]);
	const ready = $derived(name.trim().length > 0);

	function toggle(id: string, on: boolean) {
		picked = on ? [...picked, id] : picked.filter((x) => x !== id);
	}
	function create() {
		if (ready) onCreate(name.trim(), projects.filter((p) => picked.includes(p.id)));
	}
</script>

<Modal title={t('shell.workspace.create.title')} width={500} {onClose}>
	{#snippet icon()}<LayersIcon size={16} />{/snippet}
	<p class="hint">{t('shell.workspace.create.hint')}</p>
	{#if count >= MANY}
		<Notice>{t('shell.workspace.create.many', { n: count })}</Notice>
	{/if}
	<form class="field" onsubmit={(e) => (e.preventDefault(), create())}>
		<span class="label">{t('shell.workspace.create.name')}</span>
		<TextField bind:value={name} placeholder={t('shell.workspace.create.namePlaceholder')} />
	</form>
	{#if projects.length}
		<div class="field">
			<span class="label">{t('shell.workspace.create.move')}</span>
			<div class="projects">
				{#each projects as p (p.id)}
					<Checkbox checked={picked.includes(p.id)} onchange={(on) => toggle(p.id, on)}>
						<span class="proj"><ProjectBadge project={p} size={14} />{p.name}</span>
					</Checkbox>
				{/each}
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<Button size="sm" onclick={onClose}>{t('common.cancel')}</Button>
		<Button size="sm" variant="primary" disabled={!ready} onclick={create}>{t('shell.workspace.create.confirm')}</Button>
	{/snippet}
</Modal>

<style>
	.hint {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim);
		line-height: 1.6;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.label {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.projects {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 200px;
		overflow-y: auto;
	}
	.proj {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
