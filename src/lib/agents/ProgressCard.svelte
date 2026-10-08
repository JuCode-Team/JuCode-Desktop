<script lang="ts">
	// Top right of the conversation while a turn has a todo list or runs
	// subagents: the steps with their state and the subagents with their
	// latest action, as the engines report them. Folds to a pill (the user's
	// choice is kept per session) and folds by itself a few seconds after the
	// turn is over; the pill stays until the next turn.
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import { t } from '$lib/i18n';
	import { cardMode, pillParts, planShown, planSummary, type AgentRow } from '$lib/agentProgress';
	import type { ChatState } from '$lib/chat.svelte';
	import { sheet } from '$lib/ui/motion';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';

	let {
		chat,
		sessionId,
		rows,
		onOpen
	}: {
		chat: ChatState;
		/** Keys the folded state. */
		sessionId: string;
		rows: AgentRow[];
		/** Shows a subagent's own conversation (absent: rows are not links). */
		onOpen?: (row: AgentRow) => void;
	} = $props();

	const LINGER = 4000;
	const key = $derived(`jucode-progress-folded:${sessionId}`);
	let folded = $state(false);
	$effect(() => {
		try {
			folded = localStorage.getItem(key) === '1';
		} catch {
			folded = false;
		}
	});
	function setFolded(v: boolean) {
		folded = v;
		try {
			if (v) localStorage.setItem(key, '1');
			else localStorage.removeItem(key);
		} catch {
			/* no storage */
		}
	}
	// Opened from the pill after it folded by itself: open until the next turn.
	let peek = $state(false);
	$effect(() => {
		void chat.turnStartedAt;
		peek = false;
	});

	// The clock that folds the card a few seconds after the turn ends.
	let now = $state(Date.now());
	$effect(() => {
		const end = chat.turnEndedAt;
		now = Date.now();
		if (!end) return;
		const left = end + LINGER - now;
		if (left <= 0) return;
		const timer = setTimeout(() => (now = Date.now()), left + 30);
		return () => clearTimeout(timer);
	});

	const plan = $derived(planSummary(chat.plan));
	const planFresh = $derived(chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt);
	const showPlan = $derived(planShown(plan, chat.busy, planFresh));
	const mode = $derived(
		cardMode({
			plan,
			rows,
			busy: chat.busy,
			fold: folded ? 'folded' : peek ? 'open' : 'auto',
			endedAt: chat.turnEndedAt,
			now,
			planFresh
		})
	);
	const pill = $derived(pillParts(plan, rows, showPlan));

	function unfold() {
		if (folded) setFolded(false);
		peek = true;
	}
	function fold() {
		peek = false;
		setFolded(true);
	}
	const agentTitle = (r: AgentRow) => [r.label, r.model, r.activity].filter(Boolean).join(' · ');
</script>

{#if mode === 'pill'}
	<button class="pill" in:sheet={{ y: -6 }} onclick={unfold} aria-label={t('chat.progress.unfold')} title={t('chat.progress.unfold')}>
		{#if pill.running || chat.busy}<CircleNotchIcon size={13} class="spin" />{:else}<ListChecksIcon size={13} />{/if}
		{#if pill.steps}<span class="num">{pill.steps}</span>{/if}
		{#if pill.steps && pill.agents}<span class="dot">·</span>{/if}
		{#if pill.agents}<span>{pill.running ? t('chat.progress.runningN', { n: pill.running }) : t('chat.progress.agentsN', { n: pill.agents })}</span>{/if}
	</button>
{:else if mode === 'card'}
	<section class="card" in:sheet={{ y: -8 }} aria-label={t('chat.progress.label')}>
		<header>
			<span class="title">{t('chat.progress.label')}</span>
			{#if showPlan}<span class="num count">{t('chat.progress.count', { done: plan.done, total: plan.total })}</span>{/if}
			<span class="grow"></span>
			<button class="fold" onclick={fold} aria-label={t('chat.progress.fold')} title={t('chat.progress.fold')}><CaretUpIcon size={14} /></button>
		</header>
		<div class="body">
			{#if showPlan}
				<div class="sec">{t('chat.progress.todo')}</div>
				<ol class="steps">
					{#each plan.steps as s, i (i)}
						<li class="step {s.state}" class:current={i === plan.current} aria-current={i === plan.current ? 'step' : undefined}>
							<StateIcon state={s.state} size={14} label={t(`chat.progress.step.${s.state}`)} />
							<span class="stext">{s.text}</span>
						</li>
					{/each}
				</ol>
			{/if}
			{#if rows.length}
				<div class="sec">{t('chat.progress.agents')}<span class="num">{rows.length}</span></div>
				<ul class="agents">
					{#each rows as r (r.id)}
						<li>
							<button
								class="agent"
								disabled={!onOpen}
								onclick={() => onOpen?.(r)}
								title={agentTitle(r)}
								aria-label={t('chat.progress.open', { name: r.label })}
							>
								<StateIcon state={r.state} size={14} label={t(`dock.agents.state.${r.state}`)} />
								<span class="acol">
									<span class="aline">
										<span class="aname">{r.label}</span>
										{#if r.model}<span class="amodel">{r.model.replace(/^claude-/, '')}</span>{/if}
										{#if r.progress}<span class="amodel num">{r.progress.done}/{r.progress.total}</span>{/if}
										<span class="grow"></span>
										<Elapsed row={r} />
									</span>
									<span class="act" class:err={r.state === 'failed'}>{r.activity || t('chat.progress.noActivity')}</span>
								</span>
								{#if onOpen}<span class="go"><CaretRightIcon size={12} /></span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
{/if}

<style>
	.card,
	.pill {
		position: absolute;
		top: 10px;
		right: 14px;
		z-index: 6;
		background: var(--panel);
		box-shadow: var(--shadow-float);
	}
	.card {
		display: flex;
		flex-direction: column;
		width: min(320px, calc(100% - 28px));
		max-height: min(60%, 520px);
		border-radius: var(--r-lg);
		overflow: hidden;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-full);
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease-out),
			box-shadow var(--t-med) var(--ease-out);
	}
	.pill:hover {
		color: var(--text);
		box-shadow: var(--shadow-float-strong);
	}
	.dot {
		color: var(--dim2);
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 8px 6px 14px;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.count {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.grow {
		flex: 1;
	}
	.fold {
		display: inline-flex;
		padding: 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.fold:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.body {
		overflow-y: auto;
		padding: 0 6px 8px;
	}
	.sec {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 6px 8px 4px;
		font-size: var(--fs-2xs);
		font-weight: 500;
		color: var(--dim2);
	}
	.sec .num {
		font-weight: 400;
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
		border-radius: var(--r-md);
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.step :global(.si) {
		margin-top: 1px;
	}
	.step.current {
		background: var(--surface2);
		color: var(--text);
		font-weight: 500;
	}
	.step.done .stext {
		color: var(--dim);
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
		display: flex;
		align-items: flex-start;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.agent:disabled {
		cursor: default;
	}
	.agent:hover:not(:disabled) {
		background: var(--surface2);
	}
	.agent :global(.si) {
		margin-top: 2px;
	}
	.acol {
		display: flex;
		flex-direction: column;
		gap: 1px;
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
	.amodel {
		flex: none;
		max-width: 110px;
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
	.go {
		display: inline-flex;
		margin-top: 3px;
		color: var(--dim2);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.agent:hover .go,
	.agent:focus-visible .go {
		opacity: 1;
	}
</style>
