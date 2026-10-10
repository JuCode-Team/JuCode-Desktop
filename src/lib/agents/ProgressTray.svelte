<script lang="ts">
	// The turn's progress, on the composer's top edge while the turn has a
	// to-do list or runs subagents. A one-line bar says where it is (the step
	// being worked on, how many subagents run); opened, the tray lists the
	// to-dos and the subagents side by side (stacked when narrow), each
	// subagent a click away from its own conversation. Open or not is kept
	// per session; the bar stays until the next turn.
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import SquareSplitHorizontalIcon from 'phosphor-svelte/lib/SquareSplitHorizontalIcon';
	import AppWindowIcon from 'phosphor-svelte/lib/AppWindowIcon';
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import { t } from '$lib/i18n';
	import { pillParts, planShown, planSummary, trayMode, type AgentRow } from '$lib/agentProgress';
	import { formatCount, shortModel } from '$lib/agentTrace';
	import type { ChatState } from '$lib/chat.svelte';
	import type { OpenHow } from './subagentPages.svelte';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';

	let {
		chat,
		sessionId,
		rows,
		onOpen,
		onStop
	}: {
		chat: ChatState;
		/** Keys the open state. */
		sessionId: string;
		rows: AgentRow[];
		/** Shows a subagent's conversation. Absent: rows are not links. */
		onOpen?: (row: AgentRow, how: OpenHow) => void;
		/** Stops a subagent the engine runs as a background task (its id). */
		onStop?: (id: string) => void;
	} = $props();
	const stoppable = (r: AgentRow) => !!onStop && r.state === 'running' && chat.bgTasks.some((task) => task.id === r.id);

	const key = $derived(`jucode-progress-open:${sessionId}`);
	let open = $state(false);
	$effect(() => {
		try {
			open = localStorage.getItem(key) === '1';
		} catch {
			open = false;
		}
	});
	function setOpen(v: boolean) {
		open = v;
		try {
			if (v) localStorage.setItem(key, '1');
			else localStorage.removeItem(key);
		} catch {
			/* no storage */
		}
	}

	const plan = $derived(planSummary(chat.plan));
	const planFresh = $derived(chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt);
	const showPlan = $derived(planShown(plan, chat.busy, planFresh));
	const mode = $derived(trayMode(plan, rows, chat.busy, planFresh, open));
	const counts = $derived(pillParts(plan, rows, showPlan));
	const allDone = $derived(showPlan && plan.done === plan.total);
	const current = $derived(showPlan && plan.current >= 0 ? plan.steps[plan.current] : undefined);
	// The bar's line: the step being worked on, else what the first running
	// subagent does (none running: the latest one, with its result).
	const live = $derived(rows.find((r) => r.state === 'running') ?? rows.find((r) => r.state === 'queued') ?? rows.at(-1));
	const headline = $derived(
		current?.text ?? (allDone ? t('chat.progress.allDone') : live ? `${live.label} · ${live.activity || t('chat.progress.noActivity')}` : '')
	);
	// Up to six subagents as dots in the bar, running ones first.
	const beads = $derived([...rows].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running')).slice(0, 6));

	// The progress ring: done of all.
	const R = 7;
	const C = 2 * Math.PI * R;
	const dash = $derived(plan.total ? (plan.done / plan.total) * C : 0);

	// Opened: the step being worked on comes into view.
	let stepsEl = $state<HTMLElement | null>(null);
	$effect(() => {
		const i = plan.current;
		if (mode !== 'open' || i < 0 || !stepsEl) return;
		stepsEl.querySelector<HTMLElement>(`[data-step="${i}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	const agentMeta = (r: AgentRow) =>
		[r.tokens ? t('dock.agents.tokens', { n: formatCount(r.tokens) }) : '', r.toolCalls ? t('dock.agents.toolCalls', { n: r.toolCalls }) : '']
			.filter(Boolean)
			.join(' · ');
</script>

{#if mode !== 'hidden'}
	<div class="tray" class:open={mode === 'open'}>
		{#if mode === 'open'}
			<div class="panel" class:two={showPlan && rows.length > 0}>
				{#if showPlan}
					<section class="col" aria-label={t('chat.progress.todo')}>
						<h3>{t('chat.progress.todo')}<span class="num">{t('chat.progress.count', { done: plan.done, total: plan.total })}</span></h3>
						<ol class="steps" bind:this={stepsEl}>
							{#each plan.steps as s, i (i)}
								<li class="step {s.state}" class:current={i === plan.current} data-step={i} aria-current={i === plan.current ? 'step' : undefined}>
									<StateIcon state={s.state} size={14} label={t(`chat.progress.step.${s.state}`)} />
									<span class="stext">{s.text}</span>
								</li>
							{/each}
						</ol>
					</section>
				{/if}
				{#if rows.length}
					<section class="col" aria-label={t('chat.progress.agents')}>
						<h3>
							{t('chat.progress.agents')}<span class="num">{rows.length}</span>
							{#if counts.running}<span class="sub">{t('chat.progress.runningN', { n: counts.running })}</span>{/if}
						</h3>
						<ul class="agents">
							{#each rows as r (r.id)}
								<li class="agent" class:link={!!onOpen}>
									<button
										class="amain"
										disabled={!onOpen}
										onclick={(e) => onOpen?.(r, e.metaKey || e.ctrlKey ? 'other' : 'default')}
										title={r.prompt || r.label}
										aria-label={t('chat.progress.open', { name: r.label })}
									>
										<StateIcon state={r.state} size={14} label={t(`dock.agents.state.${r.state}`)} />
										<span class="acol">
											<span class="aline">
												<span class="aname">{r.label}</span>
												{#if r.type}<span class="kind">{r.type}</span>{/if}
												{#if r.progress}<span class="kind num">{r.progress.done}/{r.progress.total}</span>{/if}
												<span class="grow"></span>
												{#if r.model}<span class="amodel">{shortModel(r.model)}</span>{/if}
												<Elapsed row={r} />
											</span>
											<span class="act" class:err={r.state === 'failed'}>{r.activity || (r.state === 'queued' ? t('chat.progress.waiting') : t('chat.progress.noActivity'))}</span>
											{#if agentMeta(r)}<span class="ameta">{agentMeta(r)}</span>{/if}
										</span>
									</button>
									{#if (onOpen && !r.workflow) || stoppable(r)}
										<span class="aacts">
											{#if stoppable(r)}<button onclick={() => onStop?.(r.id)} title={t('chat.task.stop')} aria-label={t('chat.task.stop')}><StopIcon size={14} /></button>{/if}
											{#if onOpen && !r.workflow}
											<button onclick={() => onOpen?.(r, 'side')} title={t('chat.progress.openSide')} aria-label={t('chat.progress.openSide')}><SquareSplitHorizontalIcon size={14} /></button>
											<button onclick={() => onOpen?.(r, 'tab')} title={t('chat.progress.openTab')} aria-label={t('chat.progress.openTab')}><AppWindowIcon size={14} /></button>
											{/if}
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		{/if}
		<button
			class="bar"
			onclick={() => setOpen(mode !== 'open')}
			aria-expanded={mode === 'open'}
			aria-label={mode === 'open' ? t('chat.progress.fold') : t('chat.progress.unfold')}
			title={mode === 'open' ? t('chat.progress.fold') : t('chat.progress.unfold')}
		>
			{#if showPlan}
				{#if allDone}
					<span class="ring done"><CheckCircleIcon size={16} weight="fill" /></span>
				{:else}
					<svg class="ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
						<circle class="track" cx="9" cy="9" r={R} />
						<circle class="arc" cx="9" cy="9" r={R} stroke-dasharray="{dash} {C}" />
					</svg>
				{/if}
				<span class="num count">{counts.steps}</span>
			{/if}
			<span class="headline" class:dim={!current}>{headline}</span>
			{#if rows.length}
				<span class="agentsum">
					<span class="beads">
						{#each beads as r (r.id)}<span class="bead {r.state}"></span>{/each}
					</span>
					<span>{counts.running ? t('chat.progress.runningN', { n: counts.running }) : t('chat.progress.agentsN', { n: counts.agents })}</span>
				</span>
			{/if}
			<span class="chev"><CaretUpIcon size={13} /></span>
		</button>
	</div>
{/if}

<style>
	.tray {
		max-width: calc(var(--chat-w, 844px) + 2 * var(--chat-pad, 32px));
		width: 100%;
		margin: 0 auto 8px;
		padding: 0 var(--chat-pad, 32px);
		container-type: inline-size;
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.grow {
		flex: 1;
	}

	/* ── the bar ── */
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 34px;
		padding: 0 10px 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-xs);
		text-align: left;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.bar:hover {
		background: var(--panel);
		border-color: color-mix(in oklab, var(--text) 12%, var(--border));
	}
	.bar:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.ring {
		flex: none;
		display: inline-flex;
		transform: rotate(-90deg);
	}
	.ring.done {
		transform: none;
		color: var(--ok);
	}
	.track,
	.arc {
		fill: none;
		stroke-width: 2.2;
	}
	.track {
		stroke: var(--border-strong, var(--border));
	}
	.arc {
		stroke: var(--text);
		stroke-linecap: round;
		transition: stroke-dasharray var(--t-med) var(--ease-out);
	}
	.count {
		flex: none;
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.headline {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.headline.dim {
		font-weight: 400;
		color: var(--dim);
	}
	.agentsum {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding-left: 10px;
		border-left: 1px solid var(--hairline, var(--border));
		color: var(--dim);
	}
	.beads {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.bead {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.bead.running {
		background: var(--text);
		animation: bead 1.4s var(--ease-out) infinite;
	}
	.bead.done {
		background: var(--ok);
	}
	.bead.failed {
		background: var(--err);
	}
	.bead.queued {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--dim2);
	}
	@keyframes bead {
		50% {
			opacity: 0.35;
		}
	}
	.chev {
		display: inline-flex;
		flex: none;
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-out);
	}
	.tray.open .chev {
		transform: rotate(180deg);
	}

	/* ── open: the bar becomes the tray's foot ── */
	.tray.open .bar {
		border-top-left-radius: 0;
		border-top-right-radius: 0;
		background: var(--panel);
	}
	.panel {
		display: grid;
		grid-template-columns: 1fr;
		max-height: min(46vh, 420px);
		overflow: hidden;
		border: 1px solid var(--border);
		border-bottom: none;
		border-radius: var(--r-lg) var(--r-lg) 0 0;
		background: var(--panel);
		animation: rise var(--t-med) var(--ease-out);
	}
	@container (min-width: 620px) {
		.panel.two {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
		}
		.panel.two .col + .col {
			border-top: none;
			border-left: 1px solid var(--hairline, var(--border));
		}
	}
	.col {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 6px 8px;
	}
	.col + .col {
		border-top: 1px solid var(--hairline, var(--border));
	}
	h3 {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin: 0;
		padding: 8px 8px 6px;
		background: var(--panel);
		font-size: var(--fs-2xs);
		font-weight: 600;
		color: var(--dim);
	}
	h3 .num {
		font-weight: 400;
		color: var(--dim2);
	}
	h3 .sub {
		font-weight: 400;
		color: var(--dim2);
	}
	.steps,
	.agents {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.step {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 4px 8px;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.step :global(.si) {
		margin-top: 1px;
	}
	.step.current {
		color: var(--text);
		font-weight: 500;
	}
	.step.skipped .stext {
		text-decoration: line-through;
		color: var(--dim2);
	}
	.stext {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.agent {
		position: relative;
		border-radius: var(--r-md);
		transition: background var(--t-fast) var(--ease-out);
	}
	.agent.link:hover {
		background: var(--surface2);
	}
	.amain {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-radius: inherit;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.amain:disabled {
		cursor: default;
	}
	.amain:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	.amain :global(.si) {
		margin-top: 2px;
	}
	.acol {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.aline {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.aname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.kind {
		flex: none;
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-2xs);
		line-height: 1.6;
	}
	.agent.link:hover .kind {
		background: var(--surface);
	}
	.amodel {
		flex: none;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.act {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.act.err {
		color: var(--err);
	}
	.ameta {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	/* Where to open it: shown on hover / keyboard focus, over the row's right end. */
	.aacts {
		position: absolute;
		right: 6px;
		bottom: 5px;
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border-radius: var(--r-sm);
		background: var(--surface2);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.agent:hover .aacts,
	.aacts:focus-within {
		opacity: 1;
	}
	.aacts button {
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.aacts button:hover {
		background: var(--panel);
		color: var(--text);
	}
	.aacts button:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.panel,
		.bead.running {
			animation: none;
		}
	}
</style>
