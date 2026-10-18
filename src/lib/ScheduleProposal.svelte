<script lang="ts">
	// A scheduled task the agent proposed (`propose_schedule`). Nothing exists
	// until the user creates it: the button opens the task dialog filled in
	// from the proposal; the task created keeps the proposal's id (`origin`),
	// so the card knows it was.
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Button from '$lib/ui/Button.svelte';
	import { summary } from '$lib/schedules';
	import type { Proposal } from '$lib/turnSummary';
	import { t } from '$lib/i18n';

	let {
		proposal,
		created = false,
		onCreate
	}: {
		proposal: Proposal;
		created?: boolean;
		/** Absent where tasks can't be created (the remote page). */
		onCreate?: (proposal: Proposal) => void;
	} = $props();
</script>

<div class="proposal">
	<span class="icon"><ClockIcon size={16} /></span>
	<div class="text">
		<span class="label">{t('chat.proposal.title')} · {summary(proposal)}</span>
		<span class="name">{proposal.name}</span>
		<span class="prompt">{proposal.prompt}</span>
	</div>
	{#if created}
		<span class="done"><CheckIcon size={14} />{t('chat.proposal.created')}</span>
	{:else if onCreate}
		<Button size="sm" onclick={() => onCreate(proposal)}>{t('chat.proposal.create')}</Button>
	{/if}
</div>

<style>
	.proposal {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
	}
	.icon {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: var(--panel);
		border: 1px solid var(--hairline);
		color: var(--dim);
	}
	.text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.label {
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.name {
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.prompt {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.5;
	}
	.done {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 5px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
</style>
