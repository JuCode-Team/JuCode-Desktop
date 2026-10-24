<script lang="ts">
	// A subagent opened as a page of its own in place of its conversation (as
	// t3code does): whose subagent it is (a way back), the session's other
	// subagents, its own conversation read-only, and a bar where the composer
	// was — model, state, time — since it runs on its own and takes no input.
	import BotIcon from '@lucide/svelte/icons/bot';
	import CornerLeftUpIcon from '@lucide/svelte/icons/corner-left-up';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import { runState, shortModel } from '$lib/agentTrace';
	import type { AgentRow } from '$lib/agentProgress';
	import AgentDetail from './AgentDetail.svelte';
	import Elapsed from './Elapsed.svelte';
	import StateIcon from './StateIcon.svelte';

	let {
		chat,
		agentId,
		rows,
		parentTitle,
		active,
		onOp,
		onOpen,
		onBack
	}: {
		chat: ChatState;
		agentId: string;
		/** The session's subagents and Workflows (agentRows). */
		rows: AgentRow[];
		parentTitle: string;
		/** Its conversation is the one in front (Escape goes back then). */
		active: boolean;
		onOp: (op: Op) => void;
		/** Another subagent of the session. */
		onOpen: (agentId: string) => void;
		onBack: () => void;
	} = $props();

	let scroller = $state<HTMLElement | null>(null);
	const row = $derived(rows.find((r) => r.id === agentId));
	const status = $derived(runState(row?.state ?? chat.subagents[agentId]?.status ?? ''));
	const model = $derived(row?.model || chat.subagents[agentId]?.model || '');
	// Its siblings: the session's other subagents (a Workflow's agents open
	// from the background tasks region).
	const others = $derived(rows.filter((r) => !r.workflow && r.id !== agentId));
	$effect(() => {
		void agentId;
		scroller?.scrollTo({ top: 0 });
	});
</script>

<svelte:window onkeydown={(e) => active && e.key === 'Escape' && !e.defaultPrevented && onBack()} />

<div class="page">
	<div class="scroll" bind:this={scroller}>
		<div class="inner">
			<div class="divider">
				<button class="of" onclick={onBack} title={t('chat.subagentPage.openParent')}>
					<BotIcon size={13} />
					<span>{t('chat.subagentPage.of')}</span>
					<span class="parent">{parentTitle}</span>
				</button>
			</div>
			{#if others.length}
				<div class="lineage" aria-label={t('chat.subagentPage.lineage')}>
					{#each others as r (r.id)}
						<button class="sib" onclick={() => onOpen(r.id)} title={r.label}>
							<StateIcon state={r.state} size={11} />
							<span>{r.label}</span>
						</button>
					{/each}
				</div>
			{/if}
			<AgentDetail {chat} {agentId} {scroller} {onOp} />
		</div>
	</div>
	<div class="bar">
		<StateIcon state={status} size={13} label={t(`dock.agents.state.${status}`)} />
		{#if model}<span class="model">{shortModel(model)}</span>{/if}
		<span class="dim">{t(`dock.agents.state.${status}`)}</span>
		{#if row}<Elapsed {row} />{/if}
		<span class="grow"></span>
		<span class="dim">{t('chat.subagentPage.ownRun')}</span>
		<button class="back" onclick={onBack}><CornerLeftUpIcon size={14} />{t('chat.subagentPage.openParent')}</button>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.inner {
		max-width: var(--chat-width, 844px);
		margin: 0 auto;
		padding: 18px 0 24px;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 18px 14px;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--hairline);
	}
	.of {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 70%;
		padding: 4px 12px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
	}
	.of:hover {
		color: var(--text);
		border-color: var(--border-strong);
	}
	.parent {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
	}
	.lineage {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 18px 12px;
	}
	.sib {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 220px;
		padding: 3px 9px;
		border: none;
		border-radius: var(--r);
		background: var(--surface);
		color: var(--dim);
		font-size: var(--fs-2xs);
		cursor: pointer;
	}
	.sib span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sib:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(var(--chat-width, 844px), calc(100% - 36px));
		margin: 0 auto 14px;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 12px);
		background: var(--panel);
		font-size: var(--fs-sm);
	}
	.model {
		font-weight: 500;
	}
	.dim {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.grow {
		flex: 1;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.back:hover {
		background: var(--surface);
	}
</style>
