<script lang="ts">
	// Lines an edit added and removed: +47 −9, rolling to each new count.
	import AnimatedCount from '$lib/ui/AnimatedCount.svelte';

	let { add, del }: { add: number; del: number } = $props();
</script>

<span class="stat"><span class="add">+<AnimatedCount value={add} /></span><span class="del">−<AnimatedCount value={del} /></span></span>

<style>
	.stat {
		display: inline-flex;
		gap: 6px;
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.add {
		color: var(--ok);
	}
	.del {
		color: var(--err);
	}
</style>
