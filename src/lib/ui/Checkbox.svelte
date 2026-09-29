<script lang="ts">
	// The app's checkbox: a rounded box that fills with the accent and a check.
	// Wraps a real (visually hidden) input, so labels, keyboard and forms work.
	import type { Snippet } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';

	let {
		checked = $bindable(false),
		disabled = false,
		onchange,
		children
	}: {
		checked?: boolean;
		disabled?: boolean;
		onchange?: (checked: boolean) => void;
		children?: Snippet;
	} = $props();
</script>

<label class="cb" class:disabled>
	<input type="checkbox" bind:checked {disabled} onchange={() => onchange?.(checked)} />
	<span class="box" aria-hidden="true">{#if checked}<CheckIcon size={12} weight="bold" />{/if}</span>
	{#if children}<span class="txt">{@render children()}</span>{/if}
</label>

<style>
	.cb {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		cursor: pointer;
	}
	.cb.disabled {
		opacity: 0.5;
		cursor: default;
	}
	input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.box {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		background: var(--surface);
		color: var(--on-accent);
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	input:checked + .box {
		border-color: var(--accent);
		background: var(--accent);
	}
	input:focus-visible + .box {
		box-shadow: 0 0 0 2px var(--brand);
	}
	.box :global(svg) {
		animation: fade var(--t-fast) var(--ease-out);
	}
	.txt {
		min-width: 0;
	}
</style>
