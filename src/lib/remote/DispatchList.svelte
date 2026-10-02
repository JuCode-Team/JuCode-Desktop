<script lang="ts">
	// The Dispatch tab's list on the remote page: a new dispatch, then the
	// dispatches on this computer, newest first, each opened as a page
	// (DispatchScreen).
	import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLineIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';
	import type { DispatchView } from './dispatch.svelte';
	import { when } from './desk';

	let {
		current,
		composing = false,
		onNew,
		onOpen
	}: {
		/** The dispatch shown in the pane, highlighted. */
		current?: string;
		/** The composer is the pane's page. */
		composing?: boolean;
		onNew: () => void;
		onOpen: (dispatch: DispatchView) => void;
	} = $props();

	const conn = useHost();
	const firstLine = (text: string) => text.trim().split('\n')[0];
	const done = (d: DispatchView) => d.tasks.filter((task) => task.status === 'done').length;
</script>

<div class="list">
	<button class="new" class:on={composing} onclick={onNew}>
		<PencilSimpleLineIcon size={16} />
		<span>{t('shell.dispatch.new')}</span>
	</button>

	<section>
		<div class="head"><span>{t('shell.dispatch.history')}</span></div>
		{#each conn.dispatches.list as d (d.id)}
			<button class="row" class:on={current === d.id} onclick={() => onOpen(d)}>
				<span class="mark {d.status}">
					{#if d.status === 'planning' || d.status === 'running'}<CircleNotchIcon size={14} class="spin" />{:else}<span class="dot"></span>{/if}
				</span>
				<span class="text">
					<span class="title">{firstLine(d.text)}</span>
					<span class="meta">
						<span class="status {d.status}">{t(`shell.dispatch.status.${d.status}`)}</span>
						{#if d.tasks.length}· {t('shell.dispatch.progress', { done: done(d), total: d.tasks.length })}{/if}
						· {when(d.created_at)}
					</span>
				</span>
			</button>
		{:else}
			<p class="empty">{t('shell.dispatch.none')}</p>
		{/each}
	</section>
</div>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-bottom: 16px;
	}
	.new {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 42px;
		padding: 0 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.new:hover {
		background: var(--surface2);
	}
	.new:active {
		transform: scale(0.985);
	}
	.new.on {
		border-color: color-mix(in oklab, var(--accent) 50%, var(--hairline));
		background: var(--surface2);
	}
	.new > :global(svg) {
		color: var(--accent-bright);
	}
	.head {
		display: flex;
		align-items: center;
		height: 34px;
		padding: 0 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 52px;
		padding: 6px 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
		animation: fade var(--t-med) var(--ease-out);
	}
	.row:hover {
		background: var(--surface);
	}
	.row:active {
		transform: scale(0.985);
	}
	.row.on {
		background: var(--surface2);
	}
	.mark {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		color: var(--accent-bright);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--dim2);
	}
	.mark.awaiting .dot {
		background: var(--warn);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--warn) 22%, transparent);
	}
	.mark.done .dot {
		background: var(--ok);
	}
	.mark.failed .dot {
		background: var(--err);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title,
	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.status.awaiting {
		color: var(--warn);
	}
	.status.failed {
		color: var(--err);
	}
	.empty {
		margin: 0;
		padding: 4px 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
</style>
