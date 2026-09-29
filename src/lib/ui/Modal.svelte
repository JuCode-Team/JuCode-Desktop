<script lang="ts">
	// The app's modal: scrim, a centred sheet with an optional title row and
	// footer, focus kept inside, Escape and a scrim click close it. Callers
	// render it inside {#if}; entrance and exit use ui/motion.
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { t } from '$lib/i18n';
	import { scrim, sheet } from './motion';

	let {
		title,
		icon,
		label,
		width = 460,
		placement = 'center',
		dismissible = true,
		padded = true,
		onClose,
		children,
		footer
	}: {
		title?: string;
		icon?: Snippet;
		/** Accessible name when there is no visible title. */
		label?: string;
		width?: number;
		/** 'top' for palettes and pickers that list results under a search box. */
		placement?: 'center' | 'top';
		/** False while a request is in flight: Escape and the scrim do nothing. */
		dismissible?: boolean;
		/** False for sheets that lay out their own body (palettes, settings). */
		padded?: boolean;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && dismissible) {
			e.stopPropagation();
			onClose();
		}
	}
</script>

<div
	class="scrim {placement}"
	role="presentation"
	transition:scrim|global
	onclick={(e) => e.target === e.currentTarget && dismissible && onClose()}
	onkeydown={onKey}
>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label={title ?? label}
		tabindex="-1"
		style:width="min({width}px, calc(100vw - 48px))"
		transition:sheet|global
		use:focusTrap
	>
		{#if title}
			<div class="head">
				<span class="title">{#if icon}{@render icon()}{/if}{title}</span>
				<button class="x" aria-label={t('common.close')} disabled={!dismissible} onclick={onClose}><X size={18} strokeWidth={1.5} /></button>
			</div>
		{/if}
		<div class="body" class:padded>{@render children()}</div>
		{#if footer}<div class="foot">{@render footer()}</div>{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--scrim);
	}
	.scrim.top {
		align-items: flex-start;
		padding-top: 12vh;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		max-height: 84vh;
		overflow: hidden;
		border-radius: var(--r-xl);
		background: var(--panel);
		box-shadow: var(--shadow-modal);
		outline: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 16px 4px 22px;
	}
	.title {
		display: inline-flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 10px;
		color: var(--text);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.x {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.x:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.body {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
	}
	.body.padded {
		gap: 14px;
		padding: 14px 22px 20px;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 22px 20px;
	}
</style>
