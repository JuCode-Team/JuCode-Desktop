<script lang="ts">
	let {
		checked = $bindable(),
		label
	}: { checked: boolean; label?: string } = $props();
</script>

<button class="sw" class:on={checked} role="switch" aria-checked={checked} aria-label={label} onclick={() => (checked = !checked)}>
	<span class="knob"></span>
</button>

<style>
	.sw {
		width: 42px;
		height: 24px;
		border-radius: 999px;
		border: none;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		padding: 0;
		position: relative;
		flex-shrink: 0;
		transition: background var(--t-fast) var(--ease-out);
	}
	.sw.on {
		background: var(--accent);
		box-shadow: none;
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.sw.on .knob {
		transform: translateX(18px);
	}
</style>
