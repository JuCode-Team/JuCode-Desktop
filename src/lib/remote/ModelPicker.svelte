<script lang="ts">
	// Switch the session's model from the remote app, from the catalog the
	// engine sent (`model_view`): pick a model, then a reasoning effort when it
	// has any. Applied with `/model <model> [effort]`, as the desktop does.
	import { untrack } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import type { ModelOption } from '$lib/chat.svelte';
	import { t } from '$lib/i18n';

	let {
		models,
		activeEffort,
		onPick,
		onClose
	}: {
		models: ModelOption[];
		activeEffort: string;
		onPick: (model: string, effort: string) => void;
		onClose: () => void;
	} = $props();

	// The dialog starts on the active model and effort, then follows the user.
	let selected = $state(untrack(() => models.find((m) => m.active)?.model ?? models[0]?.model ?? ''));
	const row = $derived(models.find((m) => m.model === selected));
	const efforts = $derived(row?.reasoning_efforts ?? []);
	let effort = $state(untrack(() => activeEffort));
	$effect(() => {
		if (efforts.length && !efforts.includes(effort))
			effort = efforts.includes('medium') ? 'medium' : efforts[0];
	});
	const changed = $derived(!row?.active || (efforts.length > 0 && effort !== activeEffort));
</script>

<Modal title={t('shell.remote.model')} width={440} {onClose}>
	<div class="list">
		{#each models as m (m.model)}
			<button class="row" class:on={m.model === selected} onclick={() => (selected = m.model)}>
				<span class="name">{m.label || m.model}</span>
				{#if m.label && m.label !== m.model}<span class="id">{m.model}</span>{/if}
				{#if m.active}<CheckIcon size={14} />{/if}
			</button>
		{:else}
			<p class="empty">{t('shell.remote.noModels')}</p>
		{/each}
	</div>
	{#if efforts.length > 0}
		<div class="effort">
			<span class="caption">{t('shell.remote.effort')}</span>
			<Segmented bind:value={effort} options={efforts.map((e) => ({ value: e }))} />
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={onClose}>{t('common.cancel')}</Button>
		<Button variant="primary" disabled={!selected || !changed} onclick={() => onPick(selected, efforts.length ? effort : '')}>
			{t('shell.remote.switchModel')}
		</Button>
	{/snippet}
</Modal>

<style>
	.list {
		display: flex;
		flex-direction: column;
		max-height: 50vh;
		overflow-y: auto;
		margin: 0 -6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 8px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		text-align: left;
		font-size: var(--fs-md);
	}
	.row.on {
		background: var(--surface2);
	}
	.name {
		font-weight: 500;
	}
	.id {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row:not(:has(.id)) .name {
		flex: 1;
	}
	.effort {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 14px;
		overflow-x: auto;
	}
	.caption {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.empty {
		color: var(--dim2);
	}
</style>
