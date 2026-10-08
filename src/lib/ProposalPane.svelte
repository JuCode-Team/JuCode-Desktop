<script lang="ts">
	// A proposed plan in a page of its own beside the chat. A pending plan
	// comes in one block at a time, as if written in front of the reader; an
	// approved or older one shows whole. The actions stay at the bottom.
	import { untrack } from 'svelte';
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import type { ApprovalMode } from '$lib/approval';
	import type { PlanAction } from '$lib/PlanCard.svelte';
	import { t } from '$lib/i18n';
	import Markdown from '$lib/Markdown.svelte';
	import PlanActions from '$lib/PlanActions.svelte';
	import { planBlocks } from '$lib/planPages.svelte';

	let {
		plan,
		actionable = false,
		defaultMode = 'edits',
		onAction
	}: {
		/** Undefined once the plan is gone from the conversation. */
		plan?: { id: string; title: string; text: string; status: string };
		/** Pending and the conversation's latest plan. */
		actionable?: boolean;
		defaultMode?: ApprovalMode;
		onAction?: (id: string, action: PlanAction) => void;
	} = $props();

	/** ms between blocks while a pending plan comes in. */
	const STEP = 70;
	const blocks = $derived(planBlocks(plan?.text ?? ''));
	// A plan already written when its page opens comes in block by block; one
	// being written grows as it streams; an approved one shows whole.
	let shown = $state(untrack(() => (plan?.status === 'pending' ? 0 : Number.MAX_SAFE_INTEGER)));
	$effect(() => {
		if (shown >= blocks.length) return;
		const timer = setTimeout(() => (shown += 1), STEP);
		return () => clearTimeout(timer);
	});

	let copied = $state(false);
	function copy() {
		if (!plan) return;
		navigator.clipboard?.writeText(plan.title ? `# ${plan.title}\n\n${plan.text}` : plan.text).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
</script>

<div class="page">
	{#if plan}
		<header>
			<span class="ico"><ClipboardTextIcon size={15} /></span>
			<span class="label">{t('chat.planCard.label')}</span>
			{#if plan.status === 'approved' || plan.status === 'revising' || plan.status === 'drafting'}
				<span class="tag {plan.status}">{t(`chat.planCard.status.${plan.status}`)}</span>
			{/if}
			<span class="grow"></span>
			<button class="copy" onclick={copy} aria-label={copied ? t('common.copied') : t('common.copy')} title={copied ? t('common.copied') : t('common.copy')}>
				{#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}
			</button>
		</header>
		<div class="scroll">
			<div class="doc">
				{#if plan.title}<h1>{plan.title}</h1>{/if}
				{#each blocks.slice(0, shown) as block, i (i)}
					<div class="block"><Markdown text={block} /></div>
				{/each}
				{#if plan.status === 'drafting'}<span class="caret" aria-hidden="true"></span>{/if}
			</div>
		</div>
		{#if actionable && plan.status === 'pending' && onAction}
			<footer><PlanActions id={plan.id} {defaultMode} {onAction} /></footer>
		{/if}
	{:else}
		<p class="gone">{t('chat.planCard.gone')}</p>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 10px 16px;
		color: var(--dim);
		border-bottom: 1px solid var(--hairline);
	}
	.ico {
		display: inline-flex;
	}
	.label {
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.grow {
		flex: 1;
	}
	.tag {
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
	.copy {
		display: inline-flex;
		padding: 5px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.copy:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.doc {
		max-width: 720px;
		margin: 0 auto;
		padding: 20px 24px 32px;
		font-size: var(--fs-sm);
	}
	h1 {
		margin: 0 0 16px;
		font-size: var(--fs-xl, 20px);
		font-weight: 600;
		line-height: 1.35;
	}
	.block {
		animation: rise var(--t-slow, 320ms) var(--ease-out) both;
	}
	.block + .block {
		margin-top: 10px;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	/* While the model writes the plan. */
	.caret {
		display: inline-block;
		width: 7px;
		height: 1.1em;
		margin-top: 6px;
		border-radius: 1px;
		background: var(--accent);
		animation: blink 1s steps(2, start) infinite;
	}
	@keyframes blink {
		to {
			visibility: hidden;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.block,
		.caret {
			animation: none;
		}
	}
	footer {
		padding: 10px 16px 14px;
		border-top: 1px solid var(--hairline);
	}
	.gone {
		margin: auto;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
</style>
