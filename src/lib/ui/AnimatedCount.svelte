<script lang="ts">
	// A count that rolls to its value while it is `live` (a file the agent is
	// writing grows its line count as it streams): up from 0 when it appears,
	// then from the last value on each change. Otherwise, and with reduced
	// motion, it shows the value at once.
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { motionMs } from './motion';

	let { value, live = false }: { value: number; live?: boolean } = $props();

	// Longer for a bigger change, within a glance.
	const span = (from: number, to: number) => motionMs(Math.min(700, 280 + 60 * Math.log2(1 + Math.abs(to - from))));
	// svelte-ignore state_referenced_locally
	const count = new Tween(live ? 0 : value, { easing: cubicOut });
	$effect(() => {
		const to = value;
		count.set(to, { duration: live ? span(count.current, to) : 0 });
	});
</script>

{Math.round(count.current)}
