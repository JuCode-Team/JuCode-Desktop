<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		variant = 'secondary',
		size = 'md',
		disabled = false,
		full = false,
		title,
		onclick,
		children
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		disabled?: boolean;
		full?: boolean;
		title?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

<button class="b {variant} {size}" class:full {disabled} {title} {onclick}>{@render children()}</button>

<style>
	.b {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
		font-family: var(--font-sans);
		white-space: nowrap;
		transition: background 0.12s, border-color 0.12s, opacity 0.12s;
	}
	.md {
		font-size: 13px;
		padding: 9px 14px;
	}
	.sm {
		font-size: 12px;
		padding: 6px 10px;
	}
	.full {
		width: 100%;
	}
	.b:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
		background: var(--surface2);
	}
	.b:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
	.primary:hover:not(:disabled) {
		background: color-mix(in oklab, var(--accent) 88%, #fff);
		border-color: transparent;
	}
	.ghost {
		background: none;
		border-color: transparent;
		color: var(--dim);
	}
	.ghost:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
		border-color: transparent;
	}
	.danger {
		background: none;
		border-color: color-mix(in oklab, var(--err) 35%, var(--border));
		color: var(--err);
	}
	.danger:hover:not(:disabled) {
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border-color: color-mix(in oklab, var(--err) 50%, transparent);
	}
</style>
