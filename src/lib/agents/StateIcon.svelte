<script lang="ts">
	// A subagent's (or a plan step's) state as one small icon.
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleMinusIcon from '@lucide/svelte/icons/circle-minus';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import type { RunState } from '$lib/agentTrace';
	import type { StepState } from '$lib/agentProgress';

	let { state, size = 14, label = '' }: { state: RunState | StepState | 'unknown'; size?: number; label?: string } = $props();

	const ICON = {
		running: LoaderCircleIcon,
		active: LoaderCircleIcon,
		done: CircleCheckIcon,
		failed: CircleXIcon,
		stopped: CircleMinusIcon,
		skipped: CircleMinusIcon,
		queued: CircleDashedIcon,
		pending: CircleIcon,
		unknown: CircleDashedIcon
	} as const;
	const Icon = $derived(ICON[state]);
	const spinning = $derived(state === 'running' || state === 'active');
</script>

<span class="si {state}" title={label || undefined} aria-label={label || undefined} role={label ? 'img' : undefined}>
	<Icon {size} class={spinning ? 'spin' : ''} />
</span>

<style>
	.si {
		display: inline-flex;
		flex: none;
		color: var(--dim2);
	}
	.si.running,
	.si.active {
		color: var(--text);
	}
	.si.done {
		color: var(--ok);
	}
	.si.failed {
		color: var(--err);
	}
</style>
