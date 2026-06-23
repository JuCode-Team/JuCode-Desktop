<script lang="ts">
	let {
		value = $bindable(),
		options
	}: { value: string; options: { value: string; label?: string }[] } = $props();
</script>

<div class="seg">
	{#each options as o (o.value)}
		<button class="opt" class:on={o.value === value} onclick={() => (value = o.value)}>{o.label ?? o.value}</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 10px;
	}
	.opt {
		flex: 1;
		padding: 6px 14px;
		border: none;
		background: none;
		color: var(--dim);
		font-size: 12.5px;
		font-family: var(--font-sans);
		border-radius: 7px;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.12s, background 0.12s;
	}
	.opt:hover {
		color: var(--text);
	}
	.opt.on {
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
	}
</style>
