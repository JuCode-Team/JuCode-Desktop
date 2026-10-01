<script lang="ts">
	// Seconds since `since`, ticking: the live timer of the model request in
	// flight (connecting, waiting for the first token, streaming).
	let { since }: { since: number } = $props();

	let now = $state(Date.now());
	$effect(() => {
		void since;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(timer);
	});
	const s = $derived(Math.max(0, now - since) / 1000);
</script>

<span class="ct">{s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`}</span>

<style>
	.ct {
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
</style>
