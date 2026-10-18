<script lang="ts">
	// A session's background tasks, in a region of its own beside the
	// conversation (Desktop) or over it (the remote page): the turn's plan,
	// then what runs — Workflows by phase, subagents, background commands —
	// each with a stop button, then what finished, one line each. A subagent
	// opens its own conversation in place; Back returns to the list.
	import { onMount } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SquareIcon from '@lucide/svelte/icons/square';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import { t } from '$lib/i18n';
	import { taskKindLabel, type AgentRun, type ChatState, type WorkflowRun } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';
	import { byPhase, elapsed, formatCount, runState, shortModel } from '$lib/agentTrace';
	import { backgroundCommands, planShown, planSummary, rowElapsed, shortElapsed, type AgentRow } from '$lib/agentProgress';
	import AgentDetail from './AgentDetail.svelte';
	import StateIcon from './StateIcon.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';

	let {
		chat,
		rows,
		canOpen,
		onOp,
		onClose
	}: {
		chat: ChatState;
		/** The session's subagents and Workflows (agentRows). */
		rows: AgentRow[];
		/** The engine reads a subagent's own conversation back (caps.agentTrace). */
		canOpen: boolean;
		onOp: (op: Op) => void;
		onClose?: () => void;
	} = $props();

	onMount(() => {
		if (canOpen) onOp({ op: 'agent_runs' });
	});

	const live = (s: string) => s === 'running' || s === 'queued';
	const running = $derived(rows.filter((r) => live(r.state)));
	const finished = $derived(rows.filter((r) => !live(r.state)).reverse());
	const commands = $derived(backgroundCommands(chat.bgTasks, chat.subagents));
	const stoppable = (id: string) => chat.bgTasks.some((x) => x.id === id);
	const stop = (id: string) => onOp({ op: 'stop_task', task_id: id });

	const plan = $derived(planSummary(chat.plan));
	const showPlan = $derived(planShown(plan, chat.busy, chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt));

	let now = $state(Date.now());
	$effect(() => {
		if (!running.length) return;
		now = Date.now();
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const workflowOf = (id: string) => chat.agentRuns.workflows.find((w) => w.id === id);
	// A finished Workflow shows its phases once opened; a phase is open while
	// an agent of it runs, or once the user opens it.
	let openRun = $state<Record<string, boolean>>({});
	let openPhase = $state<Record<string, boolean>>({});
	const phaseOpen = (key: string, agents: AgentRun[]) => openPhase[key] ?? agents.some((a) => runState(a.state) === 'running');
	// One model for every agent of a phase is named once, in its header.
	const oneModel = (agents: AgentRun[]) => (agents.length && agents.every((a) => a.model === agents[0].model) ? agents[0].model : '');
	const phaseState = (agents: AgentRun[]) => {
		const states = agents.map((a) => runState(a.state));
		if (states.some((s) => s === 'running')) return 'running';
		if (states.some((s) => s === 'failed')) return 'failed';
		if (states.every((s) => s === 'queued')) return 'queued';
		return states.every((s) => s === 'done') ? 'done' : 'running';
	};

	let outputOf = $state<string | null>(null);
	const hasOutput = (kind: string) => kind.startsWith('local_bash') || kind.startsWith('monitor');
	function toggleOutput(id: string) {
		outputOf = outputOf === id ? null : id;
		if (outputOf) onOp({ op: 'task_output', task_id: id });
	}

	let scroller = $state<HTMLElement | null>(null);
	function pick(id: string) {
		if (!canOpen || !id) return;
		chat.agentFocus = id;
		scroller?.scrollTo({ top: 0 });
	}
	const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';
</script>

{#snippet stopButton(id: string)}
	<button class="icon" onclick={() => stop(id)} title={t('chat.task.stop')} aria-label={t('chat.task.stop')}><SquareIcon size={12} /></button>
{/snippet}

{#snippet pips(agents: AgentRun[])}
	<span class="pips">{#each agents as a, i (a.id || i)}<i class={runState(a.state)}></i>{/each}</span>
{/snippet}

{#snippet phases(w: WorkflowRun)}
	{@const groups = byPhase(w)}
	<div class="phases">
		{#each groups as g, gi (gi)}
			{@const key = `${w.id}:${gi}`}
			{@const open = phaseOpen(key, g.agents)}
			{@const done = g.agents.filter((a) => !live(runState(a.state))).length}
			{@const model = oneModel(g.agents)}
			<button class="phase" class:open onclick={() => (openPhase[key] = !open)} aria-expanded={open}>
				<StateIcon state={phaseState(g.agents)} size={12} />
				<span class="pname">{g.title || t('dock.agents.otherPhase')}</span>
				{@render pips(g.agents)}
				<span class="grow"></span>
				<span class="num">{done}/{g.agents.length}</span>
				<span class="caret" class:open><ChevronRightIcon size={12} /></span>
			</button>
			<Collapse {open}>
				<div class="agents">
					<div class="arow head">
						<span></span>
						<span class="aname">{model ? shortModel(model) : ''}</span>
						<span class="r">{t('dock.agents.col.time')}</span>
						<span class="r">{t('dock.agents.col.tokens')}</span>
						<span class="r">{t('dock.agents.col.tools')}</span>
					</div>
					{#each g.agents as a, ai (a.id || ai)}
						{@const s = runState(a.state)}
						<button class="arow" onclick={() => pick(a.id)} disabled={!canOpen || !a.id} title={a.prompt || a.label}>
							<StateIcon state={s} size={12} label={t(`dock.agents.state.${s}`)} />
							<span class="aname">
								{a.label || a.id}
								{#if !model && a.model}<small>{shortModel(a.model)}</small>{/if}
								{#if s === 'failed' && a.error}<small class="err">{firstLine(a.error)}</small>{:else if a.activity && live(s)}<small>{firstLine(a.activity)}</small>{/if}
							</span>
							<span class="r">{elapsed(a, s, now) ? shortElapsed(elapsed(a, s, now)) : ''}</span>
							<span class="r">{a.tokens ? formatCount(a.tokens) : ''}</span>
							<span class="r">{a.toolCalls || ''}</span>
						</button>
					{/each}
				</div>
			</Collapse>
		{:else}
			<p class="dim pad">{t('dock.agents.noAgentsYet')}</p>
		{/each}
	</div>
{/snippet}

{#snippet card(r: AgentRow)}
	{@const w = r.workflow ? workflowOf(r.id) : undefined}
	<div class="card">
		<div class="l1">
			<StateIcon state={r.state} size={14} label={t(`dock.agents.state.${r.state}`)} />
			{#if w || !canOpen}
				<span class="name">{r.label}</span>
			{:else}
				<button class="name link" onclick={() => pick(r.id)}>{r.label}</button>
			{/if}
			<span class="grow"></span>
			{#if live(r.state) && stoppable(r.id)}{@render stopButton(r.id)}{/if}
		</div>
		<div class="meta">
			<span>{w ? t('dock.agents.kind.workflow') : r.type || t('dock.agents.kind.agent')}</span>
			{#if rowElapsed(r, now)}<span>{shortElapsed(rowElapsed(r, now))}</span>{/if}
			{#if !w && r.model}<span>{shortModel(r.model)}</span>{/if}
			{#if r.tokens}<span>{t('dock.agents.tokens', { n: formatCount(r.tokens) })}</span>{/if}
			{#if (w?.toolCalls ?? r.toolCalls)}<span>{t('dock.agents.toolCalls', { n: w?.toolCalls ?? r.toolCalls })}</span>{/if}
		</div>
		{#if w}
			{#if w.description && w.name}<p class="desc">{w.description}</p>{/if}
			{@render phases(w)}
		{:else if r.activity}
			<p class="act" class:err={r.state === 'failed'}>{r.activity}</p>
		{/if}
	</div>
{/snippet}

<div class="panel" bind:this={scroller}>
	<div class="top">
		{#if chat.agentFocus}
			<button class="back" onclick={() => (chat.agentFocus = null)}><ArrowLeftIcon size={14} />{t('dock.agents.back')}</button>
		{:else}
			<span class="title">{t('dock.agents.title')}</span>
		{/if}
		<span class="grow"></span>
		{#if onClose}<button class="icon" onclick={onClose} title={t('dock.agents.close')} aria-label={t('dock.agents.close')}><XIcon size={14} /></button>{/if}
	</div>

	{#if chat.agentFocus}
		<AgentDetail {chat} agentId={chat.agentFocus} {scroller} {onOp} />
	{:else if showPlan || rows.length || commands.length}
		{#if showPlan}
			<h3>{t('dock.agents.plan')}<span>{plan.done}/{plan.total}</span></h3>
			<ol class="steps">
				{#each plan.steps as s, i (i)}
					<li class={s.state}><StateIcon state={s.state} size={12} label={t(`chat.progress.step.${s.state}`)} /><span>{s.text}</span></li>
				{/each}
			</ol>
		{/if}

		{#if running.length || commands.length}
			<h3>{t('dock.agents.running', { n: running.length + commands.length })}</h3>
			{#each running as r (r.id)}{@render card(r)}{/each}
			{#each commands as task (task.id)}
				<div class="card">
					<div class="l1">
						<StateIcon state="running" size={14} />
						<span class="name" title={task.description}>{task.description || taskKindLabel(task.kind)}</span>
						<span class="grow"></span>
						{@render stopButton(task.id)}
					</div>
					<div class="meta">
						<span>{taskKindLabel(task.kind)}</span>
						{#if hasOutput(task.kind)}
							<button class="tlink" onclick={() => toggleOutput(task.id)}>{outputOf === task.id ? t('chat.task.hideOutput') : t('chat.task.output')}</button>
						{/if}
					</div>
					{#if task.message}<p class="act">{task.message}</p>{/if}
					{#if outputOf === task.id}
						{@const out = chat.taskOutputs[task.id]}
						<div class="out">
							{#if !out}
								<span class="dim">{t('chat.task.loading')}</span>
							{:else if out.error}
								<span class="dim">{out.error}</span>
							{:else}
								{#if out.truncated}<span class="dim">{t('chat.task.truncated')}</span>{/if}
								<pre>{out.output || t('chat.task.noOutput')}</pre>
								<button class="tlink" onclick={() => onOp({ op: 'task_output', task_id: task.id })}>{t('chat.task.refresh')}</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}

		{#if finished.length}
			<h3>{t('dock.agents.finished', { n: finished.length })}</h3>
			{#each finished as r (r.id)}
				<button
					class="fin"
					disabled={!r.workflow && !canOpen}
					onclick={() => (r.workflow ? (openRun[r.id] = !openRun[r.id]) : pick(r.id))}
					aria-expanded={r.workflow ? !!openRun[r.id] : undefined}
					title={r.prompt || r.label}
				>
					<StateIcon state={r.state} size={14} label={t(`dock.agents.state.${r.state}`)} />
					<span class="dname">{r.label}</span>
					<span class="k">
						{r.workflow ? t('dock.agents.kind.workflow') : r.type || t('dock.agents.kind.agent')}
						{#if rowElapsed(r, now)} · {shortElapsed(rowElapsed(r, now))}{/if}
					</span>
					{#if r.workflow}<span class="caret" class:open={openRun[r.id]}><ChevronRightIcon size={12} /></span>{/if}
				</button>
				{#if r.workflow}<Collapse open={!!openRun[r.id]}>{@render card(r)}</Collapse>{/if}
			{/each}
		{/if}
	{:else}
		<div class="empty">
			<NetworkIcon size={24} />
			<p>{t('dock.agents.empty')}</p>
			<span>{t('dock.agents.emptyHint')}</span>
		</div>
	{/if}
</div>

<style>
	.panel {
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0 12px 20px;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 46px;
		margin: 0 -12px;
		padding: 0 12px 0 16px;
		background: var(--bg);
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.grow {
		flex: 1;
	}
	.num,
	.r {
		font-variant-numeric: tabular-nums;
	}
	.dim {
		color: var(--dim2);
	}
	.pad {
		padding: 4px 6px;
		font-size: var(--fs-xs);
	}
	button {
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		text-align: left;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		color: var(--dim);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-xs);
		color: var(--dim);
		cursor: pointer;
	}
	.back:hover {
		color: var(--text);
	}
	h3 {
		display: flex;
		gap: 6px;
		margin: 12px 4px 8px;
		font-size: var(--fs-2xs);
		font-weight: 400;
		color: var(--dim2);
	}
	h3 span {
		font-variant-numeric: tabular-nums;
	}

	.steps {
		list-style: none;
		margin: 0 0 4px;
		padding: 0 4px;
	}
	.steps li {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 4px 0;
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.steps li :global(.si) {
		margin-top: 2px;
	}
	.steps li.done span,
	.steps li.skipped span {
		color: var(--dim2);
	}

	.card {
		margin-bottom: 8px;
		padding: 10px 12px;
		border-radius: var(--r);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.l1 {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.name.link {
		cursor: pointer;
	}
	.name.link:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
		margin: 3px 0 0 22px;
		font-size: var(--fs-2xs);
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.desc,
	.act {
		margin: 6px 0 0 22px;
		font-size: var(--fs-2xs);
		line-height: 1.5;
		color: var(--dim2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.act {
		color: var(--dim);
	}
	.err {
		color: var(--err);
	}
	.tlink {
		padding: 0;
		color: var(--text);
		cursor: pointer;
		font-size: var(--fs-2xs);
	}
	.tlink:hover {
		text-decoration: underline;
	}
	.out {
		margin: 8px 0 0 22px;
		font-size: var(--fs-2xs);
	}
	.out pre {
		max-height: 240px;
		overflow: auto;
		margin: 4px 0;
		padding: 8px;
		border-radius: 6px;
		background: var(--surface2);
		font-family: var(--font-mono);
		white-space: pre-wrap;
		word-break: break-all;
	}

	.phases {
		margin-top: 8px;
	}
	.phase {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 6px 6px 22px;
		border-radius: 8px;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.phase:hover,
	.phase.open {
		background: var(--surface2);
	}
	.pname {
		flex: none;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.phase .num {
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.caret {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	/* One square per agent: done dim, running bright and pulsing, queued
	   hollow, failed red. */
	.pips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 3px;
		min-width: 0;
	}
	.pips i {
		width: 6px;
		height: 6px;
		border-radius: 2px;
		background: color-mix(in oklab, var(--text) 40%, transparent);
	}
	.pips i.running {
		background: var(--text);
		animation: pip 1.4s ease-in-out infinite;
	}
	.pips i.queued {
		background: none;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 30%, transparent);
	}
	.pips i.failed {
		background: var(--err);
	}
	.pips i.stopped {
		background: color-mix(in oklab, var(--text) 18%, transparent);
	}
	@keyframes pip {
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pips i.running {
			animation: none;
		}
	}

	.agents {
		margin: 2px 0 6px 22px;
	}
	.arow {
		display: grid;
		grid-template-columns: 14px minmax(0, 1fr) 52px 62px 28px;
		gap: 8px;
		align-items: center;
		width: 100%;
		padding: 4px 6px;
		border-radius: 6px;
		font-size: var(--fs-2xs);
	}
	.arow:not(.head):not(:disabled) {
		cursor: pointer;
	}
	.arow:not(.head):not(:disabled):hover {
		background: var(--surface2);
	}
	.arow.head {
		padding-top: 6px;
		color: var(--dim2);
		font-size: 11px;
	}
	.aname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.aname small {
		margin-left: 6px;
		font-size: 11px;
		color: var(--dim2);
	}
	.aname small.err {
		color: var(--err);
	}
	.r {
		text-align: right;
		color: var(--dim);
	}

	.fin {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 6px;
		border-radius: 8px;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.fin:disabled {
		cursor: default;
	}
	.fin:not(:disabled):hover {
		background: var(--surface2);
	}
	.dname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.k {
		flex: none;
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 24px;
		text-align: center;
		color: var(--dim2);
	}
	.empty p {
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.empty span {
		font-size: var(--fs-xs);
		line-height: 1.6;
	}
</style>
