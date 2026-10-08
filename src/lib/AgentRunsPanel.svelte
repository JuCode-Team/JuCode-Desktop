<script lang="ts">
	import { onMount } from 'svelte';
	import TreeStructureIcon from 'phosphor-svelte/lib/TreeStructureIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import CircleDashedIcon from 'phosphor-svelte/lib/CircleDashedIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import { t } from '$lib/i18n';
	import AgentTranscript from '$lib/agents/AgentTranscript.svelte';
	import type { AgentRun, ChatState, WorkflowRun } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import {
		anyRunning,
		byPhase,
		elapsed,
		formatCount,
		formatDuration,
		progress,
		runState,
		shortModel,
		timeline,
		type RunState
	} from '$lib/agentTrace';
	import { shortPath } from '$lib/agentProgress';

	// The agent trace of a Claude Code session: each Workflow as a timeline of
	// its agents by phase (when each ran, for how long, at what cost), the
	// session's Task subagents, and — picked from either — one subagent's own
	// conversation, read-only. The desktop shows it as a workbench panel, the
	// web page as a full-screen sheet.
	let { chat, onOp }: { chat: ChatState; onOp: (op: Op) => void } = $props();

	const units = $derived({ s: t('dock.agents.unit.s'), m: t('dock.agents.unit.m'), h: t('dock.agents.unit.h') });
	const dur = (ms: number) => formatDuration(ms, units);

	let now = $state(Date.now());
	const running = $derived(anyRunning(chat.agentRuns.workflows, chat.agentRuns.agents));
	$effect(() => {
		if (!running) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	onMount(() => onOp({ op: 'agent_runs' }));

	// Runs open by default: the running ones and the latest.
	let open = $state<Record<string, boolean>>({});
	const isOpen = (w: WorkflowRun, i: number) =>
		open[w.id] ?? (runState(w.status) === 'running' || i === chat.agentRuns.workflows.length - 1);

	const totals = $derived.by(() => {
		const all = [...chat.agentRuns.workflows, ...chat.agentRuns.agents];
		return { tokens: all.reduce((s, r) => s + r.tokens, 0) };
	});

	// ── one subagent ──
	const focused = $derived.by((): { agent: AgentRun; run: WorkflowRun | null } | null => {
		const id = chat.agentFocus;
		if (!id) return null;
		for (const w of chat.agentRuns.workflows) {
			const a = w.agents.find((x) => x.id === id);
			if (a) return { agent: a, run: w };
		}
		const a = chat.agentRuns.agents.find((x) => x.id === id);
		return a ? { agent: a, run: null } : null;
	});
	// A subagent only its lifecycle reports (an engine without the trace) runs
	// while that says so.
	const focusRunning = $derived(
		focused ? runState(focused.agent.state) === 'running' : !!chat.agentFocus && runState(chat.subagents[chat.agentFocus]?.status ?? '') === 'running'
	);

	let scroller = $state<HTMLElement | null>(null);
	function pick(id: string) {
		chat.agentFocus = id;
		scroller?.scrollTo({ top: 0 });
	}

	const ICONS: Record<RunState, typeof CheckIcon> = {
		running: CircleNotchIcon,
		done: CheckIcon,
		failed: XIcon,
		stopped: MinusIcon,
		queued: CircleDashedIcon
	};
</script>

{#snippet stateIcon(state: string)}
	{@const s = runState(state)}
	{@const Icon = ICONS[s]}
	<span class="st {s}" title={t(`dock.agents.state.${s}`)}><Icon size={13} class={s === 'running' ? 'spin' : ''} /></span>
{/snippet}

{#snippet agentRow(a: AgentRun, bar: { left: number; width: number } | undefined)}
	{@const s = runState(a.state)}
	<!-- An agent still queued has no id (and no conversation) yet. -->
	<button class="arow" onclick={() => pick(a.id)} disabled={!a.id} title={a.prompt || a.label}>
		{@render stateIcon(a.state)}
		<span class="aname">
			<span class="alabel">{a.label || a.id}</span>
			<span class="asub">{[a.type, shortModel(a.model)].filter(Boolean).join(' · ')}</span>
		</span>
		<span class="track">
			{#if bar}<span class="bar {s}" style:left="{bar.left}%" style:width="{bar.width}%"></span>{/if}
		</span>
		<span class="num">{dur(elapsed(a, s, now))}</span>
		<span class="num">{formatCount(a.tokens)}</span>
		<span class="num narrow">{a.toolCalls}</span>
	</button>
{/snippet}

<div class="panel" bind:this={scroller}>
	{#if chat.agentFocus}
		<div class="sticky">
			<button class="back" onclick={() => (chat.agentFocus = null)}>
				<ArrowLeftIcon size={14} />
				{t('dock.agents.back')}
			</button>
		</div>
		{#if focused}
			{@const a = focused.agent}
			{@const s = runState(a.state)}
			<div class="focus-head">
				<div class="ftitle">
					{@render stateIcon(a.state)}
					<span>{a.label || a.id}</span>
				</div>
				<div class="fmeta">
					{#if focused.run}<span>{focused.run.name || focused.run.description}</span>{/if}
					{#if a.model}<span>{shortModel(a.model)}</span>{/if}
					<span>{t(`dock.agents.state.${s}`)}</span>
					<span>{dur(elapsed(a, s, now))}</span>
					<span>{t('dock.agents.tokens', { n: formatCount(a.tokens) })}</span>
					<span>{t('dock.agents.toolCalls', { n: a.toolCalls })}</span>
				</div>
				{#if a.error}<p class="ferr">{a.error}</p>{/if}
				{#if a.result && s !== 'running'}<p class="fres"><span>{t('dock.agents.result')}</span>{a.result}</p>{/if}
			</div>
		{:else if chat.subagents[chat.agentFocus]}
			<!-- Known from its lifecycle only (an engine without the trace). -->
			{@const life = chat.subagents[chat.agentFocus]}
			<div class="focus-head">
				<div class="ftitle">
					{@render stateIcon(life.status)}
					<span>{shortPath(life.label || chat.agentFocus)}</span>
				</div>
				<div class="fmeta">
					{#if life.model}<span>{shortModel(life.model)}</span>{/if}
					<span>{t(`dock.agents.state.${runState(life.status)}`)}</span>
				</div>
			</div>
		{/if}
		{#key chat.agentFocus}
			<AgentTranscript {chat} agentId={chat.agentFocus} live={focusRunning} {scroller} {onOp} />
		{/key}
	{:else if chat.agentRuns.workflows.length || chat.agentRuns.agents.length}
		<div class="head">
			<span class="title">{t('dock.agents.title')}</span>
			<span class="sum">
				{t('dock.agents.summary', {
					w: chat.agentRuns.workflows.length,
					a: chat.agentRuns.agents.length,
					tokens: formatCount(totals.tokens)
				})}
			</span>
		</div>

		{#each [...chat.agentRuns.workflows].reverse() as w, ri (w.id)}
			{@const i = chat.agentRuns.workflows.length - 1 - ri}
			{@const ws = runState(w.status)}
			{@const p = progress(w)}
			{@const line = timeline(w.agents, now)}
			{@const expanded = isOpen(w, i)}
			<section class="run">
				<button class="run-head" onclick={() => (open[w.id] = !expanded)} aria-expanded={expanded}>
					<span class="caret" class:open={expanded}><CaretRightIcon size={12} /></span>
					{@render stateIcon(w.status)}
					<span class="rname">
						<span class="rtitle">{w.name || w.description || w.id}</span>
						{#if w.name && w.description}<span class="rdesc">{w.description}</span>{/if}
					</span>
				</button>
				<div class="rstats">
					<span>{t(`dock.agents.state.${ws}`)}</span>
					<span>{dur(elapsed(w, ws, now))}</span>
					<span>{t('dock.agents.tokens', { n: formatCount(w.tokens) })}</span>
					<span>{t('dock.agents.toolCalls', { n: w.toolCalls })}</span>
					<span>{t('dock.agents.progress', { done: p.done, total: p.total })}</span>
				</div>
				{#if expanded}
					<div class="cols">
						<span></span>
						<span>{t('dock.agents.col.agent')}</span>
						<span>{t('dock.agents.col.timeline')}{#if line.span} · {dur(line.span)}{/if}</span>
						<span class="num">{t('dock.agents.col.time')}</span>
						<span class="num">{t('dock.agents.col.tokens')}</span>
						<span class="num narrow">{t('dock.agents.col.tools')}</span>
					</div>
					{#each byPhase(w) as g, gi (gi)}
						{#if g.title}<div class="phase">{g.title}<span>{g.agents.length}</span></div>{/if}
						{#each g.agents as a, ai (a.id || `${gi}:${ai}`)}
							{@render agentRow(a, line.bars.get(a.id))}
						{/each}
					{:else}
						<p class="empty-line">{t('dock.agents.noAgentsYet')}</p>
					{/each}
				{/if}
			</section>
		{/each}

		{#if chat.agentRuns.agents.length}
			{@const line = timeline(chat.agentRuns.agents, now)}
			<section class="run">
				<div class="run-head static">
					<span class="rname"><span class="rtitle">{t('dock.agents.subagents')}</span></span>
				</div>
				<div class="cols">
					<span></span>
					<span>{t('dock.agents.col.agent')}</span>
					<span>{t('dock.agents.col.timeline')}{#if line.span} · {dur(line.span)}{/if}</span>
					<span class="num">{t('dock.agents.col.time')}</span>
					<span class="num">{t('dock.agents.col.tokens')}</span>
					<span class="num narrow">{t('dock.agents.col.tools')}</span>
				</div>
				{#each [...chat.agentRuns.agents].reverse() as a, ai (a.id || ai)}
					{@render agentRow(a, line.bars.get(a.id))}
				{/each}
			</section>
		{/if}
	{:else}
		<div class="empty">
			<TreeStructureIcon size={26} />
			<p>{t('dock.agents.empty')}</p>
			<span>{t('dock.agents.emptyHint')}</span>
		</div>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		padding-bottom: 20px;
		container-type: inline-size;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 12px;
		padding: 16px 18px 10px;
	}
	.title {
		font-weight: 600;
		font-size: var(--fs-md);
	}
	.sum {
		font-size: var(--fs-xs);
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.run {
		margin: 6px 12px 10px;
		padding: 10px 10px 8px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--panel);
	}
	.run-head {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		text-align: left;
		color: var(--text);
		cursor: pointer;
	}
	.run-head.static {
		cursor: default;
		padding-left: 2px;
	}
	.caret {
		display: inline-flex;
		margin-top: 3px;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.rname {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.rtitle {
		font-size: var(--fs-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.rdesc {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.45;
	}
	.rstats,
	.fmeta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin: 6px 0 4px 39px;
		font-size: var(--fs-xs);
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.fmeta {
		margin-left: 0;
	}
	.cols,
	.arow {
		display: grid;
		grid-template-columns: 18px minmax(90px, 1.1fr) minmax(70px, 1.4fr) 64px 64px 30px;
		align-items: center;
		gap: 8px;
	}
	.cols {
		margin: 10px 0 2px;
		padding: 0 6px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.phase {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin: 10px 6px 2px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
	}
	.phase span {
		font-weight: 400;
		color: var(--dim2);
	}
	.arow {
		width: 100%;
		padding: 5px 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.arow:hover:not(:disabled) {
		background: var(--surface2);
	}
	.arow:disabled {
		cursor: default;
	}
	.aname {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.alabel {
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.asub {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.track {
		position: relative;
		height: 8px;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.bar {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: var(--r-full);
		background: color-mix(in oklab, var(--text) 45%, transparent);
	}
	.bar.running {
		background: var(--accent);
	}
	.bar.failed {
		background: color-mix(in oklab, var(--err) 70%, transparent);
	}
	.bar.queued,
	.bar.stopped {
		background: color-mix(in oklab, var(--text) 22%, transparent);
	}
	/* Narrow (a phone, a slim panel): the time bar goes under the agent's
	   name and the tool-call count is left to the agent's own view. */
	@container (max-width: 460px) {
		.cols,
		.arow {
			grid-template-columns: 18px minmax(0, 1fr) 58px 64px;
			row-gap: 4px;
		}
		.track {
			grid-column: 2 / -1;
			grid-row: 2;
			height: 5px;
		}
		.cols span:nth-child(3),
		.narrow {
			display: none;
		}
		.rstats {
			margin-left: 0;
		}
	}
	.num {
		text-align: right;
		font-size: var(--fs-2xs);
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.st {
		display: inline-flex;
		color: var(--dim2);
	}
	.st.done {
		color: var(--ok);
	}
	.st.running {
		color: var(--accent-bright);
	}
	.st.failed {
		color: var(--err);
	}
	.sticky {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 10px 14px 6px;
		background: var(--bg);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.back:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.focus-head {
		padding: 4px 18px 8px;
	}
	.ftitle {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.fres {
		margin: 8px 0 0;
		font-size: var(--fs-sm);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.fres span {
		margin-right: 8px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.ferr {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
		color: var(--err);
	}
	.empty-line {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 18px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--dim2);
		padding: 30px;
		text-align: center;
	}
	.empty p {
		margin: 4px 0 0;
		font-size: var(--fs-md);
		color: var(--dim);
	}
	.empty span {
		font-size: var(--fs-xs);
		max-width: 300px;
		line-height: 1.5;
	}
</style>
