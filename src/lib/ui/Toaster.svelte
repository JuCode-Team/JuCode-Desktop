<script lang="ts">
	// Renders ui/toast.svelte.ts: a stack centred under the title bar. The
	// newest notice is in front; older ones tuck in behind it and fan out while
	// the pointer is over the stack.
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { T_FAST, T_MED, motionMs } from './motion';
	import { toast, type ToastTone } from './toast.svelte';
	import { t } from '$lib/i18n';

	const ICONS: Record<ToastTone, typeof InfoIcon> = { info: InfoIcon, success: CheckCircleIcon, warn: WarningIcon, error: WarningCircleIcon };
	/** Offset of each stacked notice (collapsed) and the gap when fanned out. */
	const PEEK = 8;
	const GAP = 8;

	let expanded = $state(false);
	let heights = $state<Record<number, number>>({});

	function offset(i: number): number {
		if (!expanded) return i * PEEK;
		let y = 0;
		for (let k = 0; k < i; k++) y += (heights[toast.items[k].id] ?? 44) + GAP;
		return y;
	}
</script>

{#if toast.items.length}
	<div
		class="toaster"
		role="region"
		aria-live="polite"
		onpointerenter={() => (expanded = true)}
		onpointerleave={() => (expanded = false)}
	>
		{#each toast.items as it, i (it.id)}
			{@const Icon = ICONS[it.tone]}
			<div
				class="toast {it.tone}"
				role={it.tone === 'error' ? 'alert' : 'status'}
				bind:offsetHeight={heights[it.id]}
				style:z-index={toast.items.length - i}
				style:transform="translate(-50%, {offset(i)}px) scale({expanded ? 1 : 1 - i * 0.04})"
				style:opacity={!expanded && i > 2 ? 0 : 1}
				in:fly={{ y: -8, duration: motionMs(T_MED), easing: cubicOut }}
				out:fly={{ y: -6, duration: motionMs(T_FAST), easing: cubicOut }}
			>
				<span class="ico"><Icon size={18} /></span>
				<span class="msg selectable">{it.message}</span>
				{#if it.action}
					<button
						class="act"
						onclick={() => {
							it.action?.run();
							toast.dismiss(it.id);
						}}>{it.action.label}</button
					>
				{/if}
				<button class="close" aria-label={t('common.close')} onclick={() => toast.dismiss(it.id)}><XIcon size={16} /></button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toaster {
		position: fixed;
		top: 56px;
		left: 50%;
		z-index: 200;
		width: 0;
	}
	.toast {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		width: max-content;
		max-width: min(560px, calc(100vw - 48px));
		min-height: 44px;
		padding: 8px 10px 8px 14px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		color: var(--text);
		font-size: var(--fs-sm);
		transform-origin: top center;
		transition:
			transform var(--t-med) var(--ease-out),
			opacity var(--t-med) var(--ease-out);
	}
	/* Errors tint the card; other tones colour only their icon. */
	.toast.error {
		background: color-mix(in oklab, var(--err) 12%, var(--panel));
		color: var(--err);
	}
	.toast.warn .ico {
		color: var(--warn);
	}
	.toast.success .ico {
		color: var(--ok);
	}
	.toast.info .ico {
		color: var(--dim);
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
	}
	.msg {
		min-width: 0;
		line-height: 1.4;
	}
	.act {
		flex-shrink: 0;
		padding: 4px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: color-mix(in oklab, currentColor 12%, transparent);
		color: inherit;
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.close {
		display: inline-flex;
		flex-shrink: 0;
		padding: 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
	}
	.close:hover {
		opacity: 1;
		background: color-mix(in oklab, currentColor 10%, transparent);
	}
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: none;
		}
	}
</style>
