<script lang="ts">
	// Questions and actions closed lately, each with who closed it and why,
	// and an undo that reopens it. Below the pending items on the desk
	// (DeskContent) and the remote page's desk list.
	import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import { useAgents } from '$lib/agentScope';
	import type { ItemKind } from '$lib/agents.svelte';
	import { t } from '$lib/i18n';

	let {
		inScope = () => true
	}: {
		/** Only the items of agents this accepts (by agent id). */
		inScope?: (agent: string | undefined) => boolean;
	} = $props();

	/** Shown before "all". */
	const FIRST = 3;

	const agentDirectory = useAgents();
	const items = $derived(
		[
			...agentDirectory.closedQuestions
				.filter((q) => inScope(q.agent))
				.map((q) => ({ kind: 'question' as ItemKind, id: q.id, agent: q.agent, title: q.title, by: q.closed_by, reason: q.closed_reason, at: q.closed_at })),
			...agentDirectory.closedActions
				.map((a) => ({ a, agent: agentDirectory.agentOfSession(a.session_id)?.id }))
				.filter(({ agent }) => inScope(agent))
				.map(({ a, agent }) => ({ kind: 'action' as ItemKind, id: a.id, agent, title: `${a.name} ${a.summary}`, by: a.closed_by, reason: a.closed_reason, at: a.closed_at }))
		].sort((x, y) => y.at - x.at)
	);
	let all = $state(false);
	let error = $state('');
	const shown = $derived(all ? items : items.slice(0, FIRST));

	function closedBy(by: string): string {
		if (by === 'user') return t('shell.desk.closedByUser');
		if (by === 'superseded') return t('shell.desk.closedSuperseded');
		const agent = by.startsWith('agent:') ? by.slice('agent:'.length) : by;
		return t('shell.desk.closedByAgent', { agent: agentDirectory.agentName(agent) });
	}

	function when(ms: number): string {
		return new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	async function reopen(kind: ItemKind, id: string) {
		error = '';
		try {
			await agentDirectory.reopen(kind, id);
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
				{#if item.kind === 'question'}<QuestionIcon size={13} />{:else}<ShieldCheckIcon size={13} />{/if}
				<span class="text">
					<span class="title">{item.title}</span>
					<span class="meta">{closedBy(item.by)}{item.reason && item.by !== 'superseded' ? `：${item.reason}` : ''} · {when(item.at)}</span>
				</span>
				<button class="undo" onclick={() => reopen(item.kind, item.id)}>{t('shell.desk.reopen')}</button>
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
		border-radius: var(--r-sm);
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
