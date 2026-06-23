<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		size = 'md',
		active = false,
		disabled = false,
		title,
		label,
		onclick,
		children
	}: {
		size?: 'sm' | 'md';
		active?: boolean;
		disabled?: boolean;
		title?: string;
		label?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

<button class="ib {size}" class:active {disabled} {title} aria-label={label ?? title} {onclick}>
	{@render children()}
</button>

<style>
	.ib {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.12s, color 0.12s;
	}
	.md {
		padding: 7px;
	}
	.sm {
		padding: 5px;
	}
	.ib:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.ib.active {
		background: var(--surface2);
		color: var(--text);
	}
	.ib:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
