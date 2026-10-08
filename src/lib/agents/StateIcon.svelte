<script lang="ts">
	// A subagent's (or a plan step's) state as one small icon.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';
	import MinusCircleIcon from 'phosphor-svelte/lib/MinusCircleIcon';
	import CircleDashedIcon from 'phosphor-svelte/lib/CircleDashedIcon';
	import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
	import type { RunState } from '$lib/agentTrace';
	import type { StepState } from '$lib/agentProgress';

	let { state, size = 14, label = '' }: { state: RunState | StepState | 'unknown'; size?: number; label?: string } = $props();

	const ICON = {
		running: CircleNotchIcon,
		active: CircleNotchIcon,
		done: CheckCircleIcon,
		failed: XCircleIcon,
		stopped: MinusCircleIcon,
		skipped: MinusCircleIcon,
		queued: CircleDashedIcon,
		pending: CircleIcon,
		unknown: CircleDashedIcon
	} as const;
	const Icon = $derived(ICON[state]);
	const spinning = $derived(state === 'running' || state === 'active');
</script>

<span class="si {state}" title={label || undefined} aria-label={label || undefined} role={label ? 'img' : undefined}>
	<Icon {size} weight={state === 'done' ? 'fill' : 'regular'} class={spinning ? 'spin' : ''} />
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
