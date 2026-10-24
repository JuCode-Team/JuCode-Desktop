<script lang="ts">
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import CirclePauseIcon from '@lucide/svelte/icons/circle-pause';
	import ArrowRightLeftIcon from '@lucide/svelte/icons/arrow-right-left';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import HandIcon from '@lucide/svelte/icons/hand';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { t } from '$lib/i18n';
	import type { Flow } from '$lib/chat.svelte';

	// A step of the conversation's own course, where it happened: a divider
	// with what it was (the context compacted, a reply stopped, another
	// model, a restart…), quiet enough to read past.
	let { flow, text }: { flow: Flow; text: string } = $props();

	const ICONS = {
		compacting: Minimize2Icon,
		compacted: Minimize2Icon,
		interrupted: CirclePauseIcon,
		fallback: ArrowRightLeftIcon,
		switch: ArrowRightLeftIcon,
		restart: RotateCwIcon,
		retry: RotateCwIcon,
		reconnect: UnplugIcon,
		task: CircleCheckIcon,
		worktree: FolderGit2Icon,
		action: HandIcon
	} as const;
	const Icon = $derived(ICONS[flow.type]);
	const label = $derived(
		flow.type === 'compacting' ? t('chat.flow.compacting') : flow.type === 'compacted' ? t('chat.flow.compacted') : flow.type === 'interrupted' ? t('chat.flow.interrupted') : text
	);
	/** Tokens as the divider shows them: 968K, 25.9K, 1.2M. */
	const fmt = (n: number) =>
		n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 100_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${n}`;
</script>

<div class="flow {flow.type}" role="note">
	<span class="rule"></span>
	<span class="what" title={label}>
		<Icon size={13} />
		<span class="label" class:shimmer-text={flow.type === 'compacting'}>{label}</span>
		{#if (flow.type === 'compacting' || flow.type === 'compacted') && flow.before}
			<span class="size">
				{fmt(flow.before)}{#if flow.after}<ArrowRightIcon size={11} />{fmt(flow.after)}{/if} tokens
			</span>
		{/if}
	</span>
	<span class="rule"></span>
</div>

<style>
	.flow {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 6px 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
		animation: fade var(--t-med) var(--ease-out);
	}
	.rule {
		flex: 1;
		min-width: 16px;
		height: 1px;
		background: var(--hairline);
	}
	.what {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		max-width: 80%;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		color: var(--dim);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.size {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	/* A reply stopped by the user reads a little stronger. */
	.interrupted .label {
		color: var(--text);
	}
</style>
