<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		selected = false,
		onclick,
		title,
		children
	}: { selected?: boolean; onclick?: (e: MouseEvent) => void; title?: string; children: Snippet } = $props();
</script>

<button class="chip" class:on={selected} {title} {onclick}>{@render children()}</button>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--dim);
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
	}
	.chip:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.chip.on {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}
	.chip.on:hover {
		color: var(--on-accent);
	}
</style>
