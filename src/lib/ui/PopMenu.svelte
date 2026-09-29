<script lang="ts" module>
	import type { Check as IconType } from 'lucide-svelte';

	export type PopMenuItem = {
		key: string;
		label: string;
		/** Second line in gray under the label. */
		desc?: string;
		icon?: typeof IconType;
		checked?: boolean;
		/** Risky choice (e.g. full access): label, icon and check in the warning colour. */
		tone?: 'warn';
	};
</script>

<script lang="ts">
	// The app's list popover: an optional gray question on top, then rows of
	// icon · label (· gray description) with a check on the current choice.
	// Anchored to its positioned parent; `placement` says which way it opens.
	import { Check } from 'lucide-svelte';

	let {
		items,
		title,
		placement = 'down-right',
		onSelect,
		onClose
	}: {
		items: PopMenuItem[];
		title?: string;
		placement?: 'up-left' | 'up-right' | 'down-left' | 'down-right';
		onSelect: (key: string) => void;
		onClose: () => void;
	} = $props();

	const hasIcons = $derived(items.some((i) => i.icon));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<button class="pm-backdrop" aria-label="close menu" tabindex="-1" onclick={onClose}></button>
<div class="pop pm {placement}" role="menu">
	{#if title}<div class="pop-head">{title}</div>{/if}
	{#each items as it (it.key)}
		<button class="pop-row" class:warn={it.tone === 'warn'} class:two={!!it.desc} role="menuitemradio" aria-checked={!!it.checked} onclick={() => onSelect(it.key)}>
			{#if it.icon}<span class="pop-ico"><it.icon size={18} strokeWidth={1.5} /></span>{:else if hasIcons}<span class="pop-ico"></span>{/if}
			<span class="pop-txt">
				<span class="pop-label">{it.label}</span>
				{#if it.desc}<span class="pop-desc">{it.desc}</span>{/if}
			</span>
			{#if it.checked}<span class="pop-check"><Check size={16} strokeWidth={1.75} /></span>{/if}
		</button>
	{/each}
</div>

<style>
	.pm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.pm {
		position: absolute;
		z-index: 81;
		width: max-content;
		min-width: 200px;
		max-width: min(480px, calc(100vw - 32px));
	}
	.up-left {
		left: 0;
		bottom: calc(100% + 8px);
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.up-right {
		right: 0;
		bottom: calc(100% + 8px);
		transform-origin: bottom right;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.down-left {
		left: 0;
		top: calc(100% + 6px);
		transform-origin: top left;
		animation: drop-in var(--t-med) var(--ease-spring);
	}
	.down-right {
		right: 0;
		top: calc(100% + 6px);
		transform-origin: top right;
		animation: drop-in var(--t-med) var(--ease-spring);
	}
</style>
