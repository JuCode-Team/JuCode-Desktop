<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		size = 'md',
		active = false,
		label,
		title,
		children,
		...rest
	}: {
		size?: 'xs' | 'sm' | 'md';
		active?: boolean;
		label?: string;
		title?: string;
		children: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<button class="ib {size}" class:active aria-label={label ?? title} {title} {...rest}>
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
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.ib:active:not(:disabled) {
		transform: scale(0.9);
	}
	.md {
		padding: 7px;
	}
	.sm {
		padding: 5px;
	}
	.xs {
		padding: 2px;
		border-radius: 5px;
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
