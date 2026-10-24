<script lang="ts">
	import InfoIcon from '@lucide/svelte/icons/info';
	import { t } from '$lib/i18n';

	// The strip on top of the composer while work the session handed off goes
	// on (background tasks, subagents, a plan's steps), with their panel. The
	// turn itself shows in the conversation (a running tool's card, the clock
	// under it), not here.
	let {
		tasks,
		tasksOpen = false,
		onTasks
	}: {
		/** The background work, as the strip names it. */
		tasks: string;
		tasksOpen?: boolean;
		onTasks?: () => void;
	} = $props();
</script>

<!-- The whole strip opens the panel, not only its icon. -->
<svelte:element
	this={onTasks ? 'button' : 'div'}
	class="shelf"
	class:on={tasksOpen}
	role={onTasks ? undefined : 'status'}
	onclick={onTasks}
	aria-expanded={onTasks ? tasksOpen : undefined}
	title={onTasks ? t('dock.agents.title') : undefined}
>
	<span class="dot"></span>
	<span class="label" aria-live="polite">{tasks}</span>
	<span class="grow"></span>
	{#if onTasks}
		<span class="icon" aria-hidden="true"><InfoIcon size={15} /></span>
	{/if}
</svelte:element>

<style>
	/* Tucked under the composer's top edge, its corners rounded above. */
	.shelf {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		width: calc(100% - 28px);
		margin: 0 14px -12px;
		padding: 6px 10px 18px 14px;
		border: 1px solid var(--border);
		border-bottom: none;
		border-radius: var(--r) var(--r) 0 0;
		background: color-mix(in oklab, var(--panel) 55%, var(--bg));
		color: inherit;
		font: inherit;
		text-align: left;
		animation: shelf-in var(--t-med) var(--ease-out);
		transition: background var(--t-fast) var(--ease-out);
	}
	button.shelf {
		cursor: pointer;
	}
	button.shelf:hover,
	button.shelf.on {
		background: color-mix(in oklab, var(--panel) 80%, var(--bg));
	}
	button.shelf:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	@keyframes shelf-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	/* Work going on elsewhere: the dot breathes slowly. */
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
	.label {
		min-width: 0;
		overflow: hidden;
		padding: 4px 0;
		color: var(--text);
		font-size: var(--fs-xs);
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.grow {
		flex: 1;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		border-radius: 7px;
		color: var(--dim);
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.shelf:hover .icon,
	.shelf.on .icon {
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
