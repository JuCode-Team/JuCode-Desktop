<script lang="ts">
	// An engine error in the conversation: what went wrong and what to do
	// (errorInfo.ts), with the one action that fixes it and the raw text on
	// demand. Errors it does not recognise show as they came.
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { slide } from 'svelte/transition';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import { describeError, stripEngineHint, type ErrorAction } from '$lib/errorInfo';

	let {
		text,
		backend = '',
		onAction,
		onDismiss
	}: {
		text: string;
		backend?: string;
		onAction?: (action: ErrorAction) => void;
		onDismiss?: () => void;
	} = $props();

	const info = $derived(describeError(text, backend));
	const subject = $derived(info?.subject ?? t('chat.err.thisTool'));
	let showRaw = $state(false);
</script>

{#if info}
	<div class="err" role="alert">
		<div class="head">
			<span class="ico"><WarningCircleIcon size={16} weight="bold" /></span>
			<span class="title">{t(`chat.err.${info.kind}.title`, { subject })}</span>
			{#if info.status}<span class="code">{info.status}</span>{/if}
			{#if onDismiss}
				<button class="x" aria-label={t('common.close')} onclick={onDismiss}><XIcon size={14} /></button>
			{/if}
		</div>
		<p class="hint">{t(`chat.err.${info.kind}.hint`, { subject })}</p>
		<div class="foot">
			{#if info.action && onAction}
				<Button size="sm" onclick={() => onAction(info.action!)}>{t(`chat.err.action.${info.action}`)}</Button>
			{/if}
			<button class="raw-toggle" class:open={showRaw} onclick={() => (showRaw = !showRaw)}>
				<CaretRightIcon size={12} />{showRaw ? t('chat.err.hideRaw') : t('chat.err.raw')}
			</button>
		</div>
		{#if showRaw}
			<pre class="raw selectable" transition:slide={{ duration: 160 }}>{stripEngineHint(text)}{#if info.requestId}

{t('chat.err.requestId')}: {info.requestId}{/if}</pre>
		{/if}
	</div>
{:else}
	<Notice mono {onDismiss}>{text}</Notice>
{/if}

<style>
	.err {
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--err) 7%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--err) 22%, transparent);
		animation: rise var(--t-fast) var(--ease-out);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--err);
	}
	.title {
		flex: 1;
		min-width: 0;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.code {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.x {
		display: inline-flex;
		flex-shrink: 0;
		padding: 2px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.x:hover {
		color: var(--text);
	}
	.hint {
		margin: 4px 0 0 24px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.55;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 10px 0 0 24px;
	}
	.raw-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.raw-toggle:hover {
		color: var(--text);
	}
	.raw-toggle :global(svg) {
		transition: transform var(--t-med) var(--ease-spring);
	}
	.raw-toggle.open :global(svg) {
		transform: rotate(90deg);
	}
	.raw {
		margin: 8px 0 0 24px;
		padding: 8px 10px;
		max-height: 160px;
		overflow: auto;
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
