<script lang="ts">
	// Inline notice in the flow of a panel or dialog: the error of a failed
	// operation, a warning about the current state, or neutral info. Tool and
	// command output (mono) keeps its line breaks. Transient feedback about an
	// action belongs in ui/toast instead.
	import type { Snippet } from 'svelte';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { t } from '$lib/i18n';

	let {
		tone = 'error',
		mono = false,
		onDismiss,
		children
	}: {
		tone?: 'error' | 'warn' | 'info';
		/** Command or tool output: monospace, line breaks kept. */
		mono?: boolean;
		onDismiss?: () => void;
		children: Snippet;
	} = $props();

	const Icon = $derived(tone === 'error' ? WarningCircleIcon : tone === 'warn' ? WarningIcon : InfoIcon);
</script>

<div class="notice {tone}" role={tone === 'error' ? 'alert' : 'status'}>
	<span class="ico"><Icon size={16} /></span>
	<div class="txt selectable" class:mono>{@render children()}</div>
	{#if onDismiss}
		<button class="x" aria-label={t('common.close')} onclick={onDismiss}><XIcon size={14} /></button>
	{/if}
</div>

<style>
	.notice {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 10px;
		border-radius: var(--r-md);
		font-size: var(--fs-xs);
		line-height: 1.5;
		animation: rise var(--t-fast) var(--ease-out);
	}
	.error {
		background: color-mix(in oklab, var(--err) 11%, transparent);
		color: var(--err);
	}
	.warn {
		background: color-mix(in oklab, var(--warn) 12%, transparent);
		color: var(--warn);
	}
	.info {
		background: var(--surface2);
		color: var(--dim);
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		margin-top: 1px;
	}
	.txt {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.txt.mono {
		font-family: var(--font-mono);
		white-space: pre-wrap;
		max-height: 160px;
		overflow-y: auto;
	}
	.x {
		display: inline-flex;
		flex-shrink: 0;
		padding: 2px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
	}
	.x:hover {
		opacity: 1;
	}
</style>
