<script lang="ts">
	// Approvals closed lately, each with who closed it and why, and a button
	// that reopens it. Below the pending items on the workbench and on the
	// remote page's list. Approvals that lapsed with their run (`superseded`)
	// are left out: there is nothing left to approve them for.
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { useDaemonState } from '$lib/daemonScope';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';

	/** Shown before "all". */
	const FIRST = 3;

	const daemon = useDaemonState();
	const items = $derived(daemon.closedActions.filter((a) => a.closed_by !== 'superseded'));
	let all = $state(false);
	let error = $state('');
	const shown = $derived(all ? items : items.slice(0, FIRST));

	function closedBy(by: string): string {
		return by === 'user' ? t('shell.desk.closedByUser') : t('shell.desk.closedByOther');
	}

	async function reopen(id: string) {
		error = '';
		try {
			await daemon.reopen(id);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

{#if items.length}
	<div class="closed">
		<div class="head">{t('shell.desk.closed')}</div>
		{#each shown as item (item.id)}
			<div class="row">
				<ShieldCheckIcon size={14} />
				<span class="text">
					<span class="title">{item.name} {item.summary}</span>
					<span class="meta">{closedBy(item.closed_by)}{item.closed_reason ? `：${item.closed_reason}` : ''} · {when(item.closed_at)}</span>
				</span>
				<button class="undo" onclick={() => reopen(item.id)}>{t('shell.desk.reopen')}</button>
			</div>
		{/each}
		{#if items.length > FIRST}
			<button class="more" onclick={() => (all = !all)}>
				{all ? t('shell.desk.showFewerClosed') : t('shell.desk.showAllClosed', { n: items.length })}
			</button>
		{/if}
		{#if error}<p class="error">{error}</p>{/if}
	</div>
{/if}

<style>
	.closed {
		display: flex;
		flex-direction: column;
		margin-top: 12px;
	}
	.head {
		margin-bottom: 2px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 5px 0;
		color: var(--dim2);
	}
	.row > :global(svg) {
		flex-shrink: 0;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title,
	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title {
		font-size: var(--fs-sm);
		color: var(--dim);
		text-decoration: line-through;
		text-decoration-color: var(--dim2);
	}
	.meta {
		font-size: var(--fs-xs);
	}
	.undo,
	.more {
		flex-shrink: 0;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.undo:hover,
	.more:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.more {
		align-self: flex-start;
		margin-top: 2px;
	}
	.error {
		margin: 4px 0 0;
		font-size: var(--fs-xs);
		color: var(--err);
	}
</style>
