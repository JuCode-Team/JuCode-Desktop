<script lang="ts">
	// A full-screen page of the remote app: a header with a back button and
	// optional actions over a scrolling body. Pages stack on top of each other.
	// Without `onBack` it is a tab's own page in the wide pane (nothing under it).
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import { t } from '$lib/i18n';

	let {
		title,
		subtitle,
		onBack,
		actions,
		children
	}: {
		title: string;
		subtitle?: string;
		onBack?: () => void;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="screen">
	<header>
		{#if onBack}
			<button class="back" onclick={onBack} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={18} /></button>
		{/if}
		<span class="heading">
			<span class="title">{title}</span>
			{#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
		</span>
		{@render actions?.()}
	</header>
	<div class="body">{@render children()}</div>
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 52px;
		padding: calc(env(safe-area-inset-top) + 8px) 12px 8px;
		border-bottom: 1px solid var(--hairline);
		background: var(--panel);
	}
	.back {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.back:hover,
	header :global(.act:hover:not(:disabled)) {
		background: var(--surface2);
	}
	.back:active,
	header :global(.act:active:not(:disabled)) {
		transform: scale(0.92);
	}
	.heading {
		flex: 1;
		padding-left: 4px;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title,
	.subtitle {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title {
		font-weight: 600;
		font-size: var(--fs-lg);
	}
	.subtitle {
		font-size: var(--fs-xs);
		color: var(--dim);
		font-family: var(--font-mono);
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 16px calc(env(safe-area-inset-bottom) + 16px);
	}
	header :global(.act) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	header :global(.act:disabled) {
		opacity: 0.5;
		cursor: default;
	}
</style>
