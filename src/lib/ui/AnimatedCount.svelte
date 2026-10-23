<script lang="ts">
	// A count that rolls to its value: up from 0 when it appears, then from
	// the last value on each change (a file being written grows its line
	// count as it streams). Reduced motion shows the value at once.
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { motionMs } from './motion';

	let { value }: { value: number } = $props();

	// Longer for a bigger change, within a glance.
	const span = (from: number, to: number) => motionMs(Math.min(700, 280 + 60 * Math.log2(1 + Math.abs(to - from))));
	const count = new Tween(0, { easing: cubicOut });
	$effect(() => {
		const to = value;
		count.set(to, { duration: span(count.current, to) });
	});
</script>

{Math.round(count.current)}
