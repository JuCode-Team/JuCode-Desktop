<script lang="ts">
	// Lines an edit added and removed: +47 −9.
	let { add, del }: { add: number; del: number } = $props();
</script>

<span class="stat"><span class="add">+{add}</span><span class="del">−{del}</span></span>

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
