<script lang="ts">
	import InfoIcon from '@lucide/svelte/icons/info';
	import { t } from '$lib/i18n';
	import Indicator from '$lib/Indicator.svelte';
	import { withShortcut } from '$lib/shortcuts';
	import { parseToolOutput, toolTarget, toolVerb } from '$lib/toolSummary';
	import type { ChatState } from '$lib/chat.svelte';

	// The strip on top of the composer while something runs: the turn's stage
	// (Indicator: what it works on, its time), else the background work left
	// going; on the right the background tasks' panel and Stop.
	let {
		chat,
		tasks = '',
		tasksOpen = false,
		onTasks,
		onStop
	}: {
		chat: ChatState;
		/** The background work, as the strip names it ('' none). */
		tasks?: string;
		tasksOpen?: boolean;
		onTasks?: () => void;
		onStop: () => void;
	} = $props();

	// The conversation's own tool call still running (not a subagent's).
	const tool = $derived.by(() => {
		if (chat.phase !== 'tool') return '';
		for (let i = chat.messages.length - 1; i >= 0; i--) {
			const m = chat.messages[i]!;
			if (m.kind === 'tool' && m.running && !m.subagent) return `${toolVerb(m.name)} ${toolTarget(m.name, parseToolOutput(m.output))}`.trim();
		}
		return '';
	});
</script>

<div class="shelf" role="status">
	{#if chat.busy}
		<Indicator phase={chat.phase ?? 'working'} call={chat.call} tokens={chat.compactionTokens} detail={tool} since={chat.turnStartedAt} />
		{#if tasks}<span class="also">· {tasks}</span>{/if}
	{:else}
		<span class="bg"><span class="dot"></span><span class="label">{tasks}</span></span>
	{/if}
	<span class="grow"></span>
	{#if tasks && onTasks}
		<button class="icon" class:on={tasksOpen} onclick={onTasks} aria-expanded={tasksOpen} aria-label={t('dock.agents.title')} title={t('dock.agents.title')}>
			<InfoIcon size={15} />
		</button>
	{/if}
	{#if chat.busy}
		<button class="stop" onclick={onStop} title={withShortcut(t('chat.stopTitle'), 'stop')}>{t('chat.stopHint')}</button>
	{/if}
</div>

<style>
	/* Tucked under the composer's top edge, its corners rounded above. */
	.shelf {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		margin: 0 14px -12px;
		padding: 6px 10px 18px 14px;
		border: 1px solid var(--border);
		border-bottom: none;
		border-radius: var(--r) var(--r) 0 0;
		background: color-mix(in oklab, var(--panel) 55%, var(--bg));
		animation: shelf-in var(--t-med) var(--ease-out);
	}
	@keyframes shelf-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	.shelf > :global(.ind) {
		min-width: 0;
		flex-shrink: 1;
	}
	.also,
	.label {
		min-width: 0;
		overflow: hidden;
		color: var(--dim);
		font-size: var(--fs-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bg {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 4px 2px;
	}
	.bg .label {
		color: var(--text);
		font-weight: 500;
	}
	/* Background work: the dot breathes slowly. */
	.dot {
		width: 7px;
		height: 7px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--text);
		animation: breathe 2.2s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.3;
			transform: scale(0.75);
		}
	}
	.grow {
		flex: 1;
	}
	.icon,
	.stop {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		height: 26px;
		border: none;
		border-radius: 7px;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.icon {
		width: 26px;
	}
	.stop {
		padding: 0 8px;
		color: var(--text);
		font-weight: 500;
	}
	.icon:hover,
	.icon.on,
	.stop:hover {
		background: var(--surface2);
		color: var(--text);
	}
	@media (prefers-reduced-motion: reduce) {
		.shelf,
		.dot {
			animation: none;
		}
	}
</style>
