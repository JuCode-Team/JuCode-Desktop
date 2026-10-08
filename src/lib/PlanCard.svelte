<script lang="ts" module>
	import type { ApprovalMode } from '$lib/approval';
	export type PlanAction = { decision: 'approve'; mode: ApprovalMode } | { decision: 'revise' };
</script>

<script lang="ts">
	// A plan the agent proposes in plan mode, in the chat: one row with its
	// title and two lines of it; the plan itself reads in a page of its own
	// beside the chat (ProposalPane), opened from here. While it waits and is
	// the latest message, the approve / revise actions follow.
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import { t } from '$lib/i18n';
	import PlanActions from '$lib/PlanActions.svelte';

	let {
		id,
		title,
		text,
		status,
		actionable = false,
		defaultMode = 'edits',
		onAction,
		onOpen
	}: {
		id: string;
		title: string;
		text: string;
		status: string;
		/** Pending and the latest message: the approve / revise row shows. */
		actionable?: boolean;
		defaultMode?: ApprovalMode;
		onAction?: (id: string, action: PlanAction) => void;
		/** Shows the plan in its page beside the chat. */
		onOpen?: (id: string) => void;
	} = $props();

	/** The first lines of prose, without Markdown marks, for the row. */
	const gist = $derived(
		text
			.split('\n')
			.map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, '').replace(/[*_`]/g, '').trim())
			.filter(Boolean)
			.slice(0, 3)
			.join(' · ')
	);
</script>

<article class="plan" aria-label={t('chat.planCard.label')}>
	<button class="row" onclick={() => onOpen?.(id)} title={t('chat.planCard.openPage')}>
		<span class="ico"><ClipboardTextIcon size={16} /></span>
		<span class="txt">
			<span class="head">
				<span class="ptitle">{title || t('chat.planCard.label')}</span>
				{#if status === 'approved' || status === 'revising' || status === 'drafting'}
					<span class="tag {status}">{t(`chat.planCard.status.${status}`)}</span>
				{/if}
			</span>
			{#if gist}<span class="gist">{gist}</span>{/if}
		</span>
		<span class="open"><ArrowSquareOutIcon size={15} /></span>
	</button>
</article>
{#if actionable && status === 'pending' && onAction}
	<div class="act-row"><PlanActions {id} {defaultMode} {onAction} /></div>
{/if}

<style>
	.plan {
		max-width: 100%;
		border-radius: var(--r-xl);
		background: var(--panel);
		box-shadow: var(--shadow-float);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 14px;
		border: none;
		border-radius: inherit;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.row:hover {
		background: color-mix(in oklab, var(--text) 4%, transparent);
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim);
	}
	.txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.ptitle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.gist {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.tag {
		flex-shrink: 0;
		padding: 1px 8px;
		border-radius: var(--r-full);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.tag.approved {
		color: var(--ok);
		background: color-mix(in oklab, var(--ok) 12%, transparent);
	}
	.open {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim);
	}
	.act-row {
		margin-top: 10px;
	}
</style>
