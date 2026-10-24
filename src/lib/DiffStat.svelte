<script lang="ts">
	// Lines an edit added and removed: +47 −9, rolling to each new count
	// while the agent is still making it (`live`).
	import AnimatedCount from '$lib/ui/AnimatedCount.svelte';

	let { add, del, live = false }: { add: number; del: number; live?: boolean } = $props();
</script>

<span class="stat"><span class="add">+<AnimatedCount value={add} {live} /></span><span class="del">−<AnimatedCount value={del} {live} /></span></span>

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
