<script lang="ts">
	// A requirement's number, as it shows next to its sessions and in lists.
	let { id, title }: { id: string; title?: string } = $props();
</script>

<span class="rq" {title}>{id}</span>

<style>
	.rq {
		flex: none;
		padding: 0 4px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.5;
		white-space: nowrap;
	}
</style>
