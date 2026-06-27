<script lang="ts">
	import { ChevronDown, Check } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	type Opt = { value: string; label?: string } & Record<string, unknown>;
	let {
		value = $bindable(),
		options,
		placeholder = '选择…',
		item,
		onChange
	}: {
		value: string;
		options: Opt[];
		placeholder?: string;
		item?: Snippet<[Opt]>;
		onChange?: (value: string) => void;
	} = $props();

	let open = $state(false);
	const sel = $derived(options.find((o) => o.value === value));
	function pick(v: string) {
		value = v;
		open = false;
		onChange?.(v);
	}
</script>

<div class="select">
	<button class="trigger" class:open onclick={() => (open = !open)}>
		<span class="cur">
			{#if sel}
				{#if item}{@render item(sel)}{:else}{sel.label ?? sel.value}{/if}
			{:else}
				<span class="ph">{placeholder}</span>
			{/if}
		</span>
		<span class="chev" class:up={open}><ChevronDown size={15} /></span>
	</button>
	{#if open}
		<button class="backdrop" aria-label="close" onclick={() => (open = false)}></button>
		<div class="menu">
			{#each options as o (o.value)}
				<button class="opt" class:on={o.value === value} onclick={() => pick(o.value)}>
					<span class="opt-c">{#if item}{@render item(o)}{:else}{o.label ?? o.value}{/if}</span>
					{#if o.value === value}<Check size={14} class="opt-chk" />{/if}
				</button>
			{/each}
			{#if options.length === 0}<div class="opt-empty">无可选项</div>{/if}
		</div>
	{/if}
</div>

<style>
	.select {
		position: relative;
		width: 100%;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 9px 11px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.12s;
	}
	.trigger:hover,
	.trigger.open {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.cur {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}
	.ph {
		color: var(--dim2);
	}
	.chev {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
		transition: transform 0.14s;
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 30;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 5px);
		left: 0;
		right: 0;
		z-index: 31;
		max-height: 240px;
		overflow-y: auto;
		padding: 5px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		animation: rise 0.12s ease;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 9px;
		border: none;
		background: none;
		color: var(--text);
		font-size: 13px;
		border-radius: var(--r-sm);
		cursor: pointer;
		text-align: left;
	}
	.opt:hover {
		background: var(--surface2);
	}
	.opt.on {
		background: var(--accent-soft);
	}
	.opt-c {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}
	:global(.opt-chk) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.opt-empty {
		padding: 10px;
		font-size: 12px;
		color: var(--dim2);
		text-align: center;
	}
</style>
