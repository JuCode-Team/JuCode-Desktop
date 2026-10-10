<script lang="ts">
	// One subagent: who it is (state, kind, model, time, tokens, tool calls,
	// its result or error), then its own conversation, read-only. Shown in the
	// agent trace panel and in a subagent's own page (beside the chat or as a
	// tab of its own).
	import { t } from '$lib/i18n';
	import AgentTranscript from './AgentTranscript.svelte';
	import StateIcon from './StateIcon.svelte';
	import type { AgentRun, ChatState, WorkflowRun } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import { elapsed, formatCount, formatDuration, runState, shortModel } from '$lib/agentTrace';
	import { shortPath } from '$lib/agentProgress';

	let {
		chat,
		agentId,
		scroller,
		onOp
	}: {
		chat: ChatState;
		agentId: string;
		/** The scroll viewport the conversation sits in. */
		scroller: HTMLElement | null;
		onOp: (op: Op) => void;
	} = $props();

	const units = $derived({ s: t('dock.agents.unit.s'), m: t('dock.agents.unit.m'), h: t('dock.agents.unit.h') });

	const focused = $derived.by((): { agent: AgentRun; run: WorkflowRun | null } | null => {
		for (const w of chat.agentRuns.workflows) {
			const a = w.agents.find((x) => x.id === agentId);
			if (a) return { agent: a, run: w };
		}
		const a = chat.agentRuns.agents.find((x) => x.id === agentId);
		return a ? { agent: a, run: null } : null;
	});
	// Known from its lifecycle only (an engine without the trace).
	const life = $derived(chat.subagents[agentId]);
	const status = $derived(runState(focused?.agent.state ?? life?.status ?? ''));
	const running = $derived(status === 'running');

	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		now = Date.now();
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
</script>

{#if focused}
	{@const a = focused.agent}
	<div class="head">
		<div class="title">
			<StateIcon state={status} size={15} label={t(`dock.agents.state.${status}`)} />
			<span class="name">{a.label || a.id}</span>
			{#if a.type}<span class="kind">{a.type}</span>{/if}
		</div>
		<div class="meta">
			{#if focused.run}<span>{focused.run.name || focused.run.description}</span>{/if}
			{#if a.model}<span class="mono">{shortModel(a.model)}</span>{/if}
			<span>{t(`dock.agents.state.${status}`)}</span>
			<span class="num">{formatDuration(elapsed(a, status, now), units)}</span>
			{#if a.tokens}<span class="num">{t('dock.agents.tokens', { n: formatCount(a.tokens) })}</span>{/if}
			{#if a.toolCalls}<span class="num">{t('dock.agents.toolCalls', { n: a.toolCalls })}</span>{/if}
		</div>
		{#if a.error}<p class="err">{a.error}</p>{/if}
		{#if a.result && status !== 'running'}<p class="res"><span>{t('dock.agents.result')}</span>{a.result}</p>{/if}
	</div>
{:else if life}
	<div class="head">
		<div class="title">
			<StateIcon state={status} size={15} label={t(`dock.agents.state.${status}`)} />
			<span class="name">{shortPath(life.label || agentId)}</span>
		</div>
		<div class="meta">
			{#if life.model}<span class="mono">{shortModel(life.model)}</span>{/if}
			<span>{t(`dock.agents.state.${status}`)}</span>
		</div>
	</div>
{/if}
{#key agentId}
	<AgentTranscript {chat} {agentId} live={running} {scroller} {onOp} />
{/key}

<style>
	.head {
		padding: 4px 18px 10px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.kind {
		flex: none;
		padding: 1px 7px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin-top: 6px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.res {
		margin: 8px 0 0;
		font-size: var(--fs-sm);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.res span {
		margin-right: 8px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.err {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
		color: var(--err);
	}
</style>
