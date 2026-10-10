<script lang="ts">
	// An agent's tasks on its page: what waits for the user, then one entry
	// per task (a scheduled one, or one with a session of its own) with its
	// state, how it is triggered and what its latest run concluded; its runs
	// unfold below it. Done and closed tasks are folded away at the end, with
	// the items closed lately.
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import AlarmIcon from 'phosphor-svelte/lib/AlarmIcon';
	import ArrowBendDownRightIcon from 'phosphor-svelte/lib/ArrowBendDownRightIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import DeskContent from '$lib/DeskContent.svelte';
	import DeskClosed from '$lib/DeskClosed.svelte';
	import {
		agentDirectory,
		taskSession,
		type AgentView,
		type RunView,
		type TaskView
	} from '$lib/agents.svelte';
	import { summary as scheduleSummary } from '$lib/schedules';
	import { when } from '$lib/time';
	import { t } from '$lib/i18n';

	let {
		agent,
		onOpenSession,
		onOpenAgent
	}: {
		agent: AgentView;
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
	} = $props();

	/** What needs the user first, then what is working, then what runs later. */
	const ORDER: Record<TaskView['state'], number> = { needs_you: 0, running: 1, waiting: 2, paused: 3, done: 4, closed: 5 };
	const tasks = $derived(agentDirectory.tasks.filter((task) => task.agent === agent.id));
	const current = $derived(
		tasks
			.filter((task) => task.state !== 'done' && task.state !== 'closed')
			.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updated_at - a.updated_at)
	);
	const finished = $derived(tasks.filter((task) => task.state === 'done' || task.state === 'closed'));
	let showFinished = $state(false);

	/** Unfolded parts by key: `i:` instruction, `s:` summary, `r:` runs. */
	let expanded = $state<Record<string, boolean>>({});
	const toggle = (key: string) => (expanded[key] = !expanded[key]);

	/** Runs of the tasks whose runs are unfolded, newest first. */
	let runs = $state<Record<string, RunView[]>>({});
	let error = $state('');
	// Reload a task's runs when it changes while they are shown.
	$effect(() => {
		for (const task of tasks) {
			if (!expanded[`r:${task.id}`]) continue;
			void task.updated_at;
			void task.latest_run?.status;
			const id = task.id;
			agentDirectory.task(id).then(
				(detail) => (runs[id] = detail.runs),
				(e) => (error = e instanceof Error ? e.message : String(e))
			);
		}
	});

	function trigger(task: TaskView): string {
		const tr = task.trigger;
		if ('repeat' in tr) return scheduleSummary(tr);
		if ('at' in tr) return t('shell.activity.remind', { time: when(tr.at) });
		if (task.origin.startsWith('agent:')) {
			return t('shell.activity.fromAgent', { name: agentDirectory.agentName(task.origin.slice('agent:'.length)) });
		}
		return t('shell.activity.fromUser');
	}

	function stateText(task: TaskView): string {
		switch (task.state) {
			case 'needs_you':
				return t('shell.activity.stateNeedsYou');
			case 'running':
				return t('shell.activity.stateRunning');
			case 'waiting':
				return task.next_at ? t('shell.activity.stateWaiting', { time: when(task.next_at) }) : '';
			case 'paused':
				return t('shell.activity.statePaused');
			case 'done':
				return t('shell.activity.stateDone');
			case 'closed':
				return t('shell.activity.stateClosed');
		}
	}

	function runLabel(run: RunView): string {
		if (run.status === 'queued') return t('shell.activity.statusQueued');
		if (run.status === 'running') return t('shell.activity.statusRunning');
		if (run.status === 'interrupted') return t('shell.activity.statusInterrupted');
		switch (run.outcome?.verdict) {
			case 'quiet':
				return t('shell.activity.verdictQuiet');
			case 'needs_you':
				return t('shell.activity.verdictNeedsYou');
			case 'failed':
				return t('shell.activity.verdictFailed');
			default:
				return run.status === 'failed' ? t('shell.activity.verdictFailed') : t('shell.activity.verdictDone');
		}
	}

	/** Runs to list: quiet ones in a row fold into one line. */
	type Row = { run: RunView } | { quiet: RunView[] };
	function rows(list: RunView[]): Row[] {
		const out: Row[] = [];
		for (const run of list) {
			const last = out[out.length - 1];
			if (run.outcome?.verdict === 'quiet' && run.status !== 'running') {
				if (last && 'quiet' in last) last.quiet.push(run);
				else out.push({ quiet: [run] });
			} else out.push({ run });
		}
		return out;
	}

	const isLong = (text: string) => text.length > 220 || text.split('\n').length > 3;
	const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

	/** The task being replied to, and the reply. */
	let replyTo = $state<string | null>(null);
	let replyText = $state('');
	let replying = $state(false);
	let replyError = $state('');
	function startReply(id: string) {
		replyTo = replyTo === id ? null : id;
		replyText = '';
		replyError = '';
	}
	async function sendReply(task: string) {
		const body = replyText.trim();
		if (!body || replying) return;
		replying = true;
		replyError = '';
		try {
			await agentDirectory.messageTask(task, body);
			replyTo = null;
			replyText = '';
		} catch (e) {
			replyError = e instanceof Error ? e.message : String(e);
		} finally {
			replying = false;
		}
	}

	async function setClosed(task: TaskView, closed: boolean) {
		error = '';
		try {
			await (closed ? agentDirectory.closeTask(task.id) : agentDirectory.reopenTask(task.id));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<DeskContent agent={agent.id} {onOpenSession} />

{#if error}<div class="err"><Notice>{t('shell.activity.loadFailed', { error })}</Notice></div>{/if}

{#snippet entry(task: TaskView)}
	{@const session = taskSession(task)}
	{@const outcome = task.latest_run?.outcome}
	<li class="entry" class:attention={task.state === 'needs_you'}>
		<span class="mark">
			{#if task.trigger.kind === 'repeat'}<ClockIcon size={14} />
			{:else if task.trigger.kind === 'once'}<AlarmIcon size={14} />
			{:else if task.origin.startsWith('agent:')}
				{@const from = agentDirectory.agents.find((a) => a.id === task.origin.slice('agent:'.length))}
				{#if from}<AgentAvatar agent={from} size={14} />{:else}<ArrowBendDownRightIcon size={14} />{/if}
			{:else}<UserIcon size={14} />{/if}
		</span>
		<div class="content">
			<div class="line">
				<span class="title">{task.title || t('shell.agentPage.untitled')}</span>
				<span class="state {task.state}">
					{#if task.state === 'running'}<CircleNotchIcon size={12} class="spin" />{:else}<span class="dot"></span>{/if}
					{stateText(task)}
				</span>
				<span class="at">{when(task.updated_at)}</span>
			</div>
			<div class="meta">
				{#if task.origin.startsWith('agent:') && task.trigger.kind === 'manual'}
					{@const from = task.origin.slice('agent:'.length)}
					<button class="link" onclick={() => onOpenAgent(from)}>{trigger(task)}</button>
				{:else}
					<span>{trigger(task)}</span>
				{/if}
				{#if task.runs > 1}<span>· {t('shell.activity.runCount', { n: task.runs })}</span>{/if}
				{#if task.quiet_runs > 0 && task.trigger.kind !== 'manual'}<span>· {t('shell.activity.quietRuns', { n: task.quiet_runs })}</span>{/if}
			</div>

			{#if task.latest_run?.status === 'interrupted'}
				<p class="note warn">{t('shell.activity.interrupted')}</p>
			{/if}
			{#if outcome?.summary}
				<div class="body" class:clamp={isLong(outcome.summary) && !expanded[`s:${task.id}`]}>{outcome.summary}</div>
				{#if isLong(outcome.summary)}
					<button class="more" onclick={() => toggle(`s:${task.id}`)}>{expanded[`s:${task.id}`] ? t('shell.activity.less') : t('shell.activity.more')}</button>
				{/if}
			{/if}

			{#if expanded[`i:${task.id}`] && task.instruction}
				<div class="instruction">{task.instruction}</div>
			{/if}

			{#if expanded[`r:${task.id}`]}
				<ol class="runs">
					{#each rows(runs[task.id] ?? []) as row, i (i)}
						{#if 'quiet' in row}
							{@const newest = row.quiet[0]}
							{@const oldest = row.quiet[row.quiet.length - 1]}
							<li class="run quiet">
								<span class="run-at">{row.quiet.length > 1 ? `${when(oldest.started_at)} – ${when(newest.started_at)}` : when(newest.started_at)}</span>
								<span class="run-label">{t('shell.activity.quietGroup', { n: row.quiet.length })}</span>
							</li>
						{:else if row.run.status === 'skipped'}
							<li class="run quiet">
								<span class="run-at">{when(row.run.started_at)}</span>
								<span class="run-label">{t('shell.activity.skipped')}</span>
							</li>
						{:else}
							{@const run = row.run}
							<li class="run">
								<button class="run-row" disabled={!run.session} onclick={() => run.session && onOpenSession(run.session)}>
									<span class="run-at">{when(run.started_at)}</span>
									<span class="run-label {run.outcome?.verdict ?? run.status}">{runLabel(run)}</span>
									<span class="run-text">{firstLine(run.outcome?.summary ?? '')}</span>
								</button>
							</li>
						{/if}
					{/each}
				</ol>
			{/if}

			<div class="foot">
				{#if agent.enabled && session && task.state !== 'closed'}
					<button class="more" onclick={() => startReply(task.id)}>{t('shell.activity.reply')}</button>
				{/if}
				{#if task.instruction}
					<button class="more" onclick={() => toggle(`i:${task.id}`)} aria-expanded={!!expanded[`i:${task.id}`]}>{t('shell.activity.instruction')}</button>
				{/if}
				{#if task.runs > 1}
					<button class="more" onclick={() => toggle(`r:${task.id}`)} aria-expanded={!!expanded[`r:${task.id}`]}>{t('shell.activity.runs')}</button>
				{/if}
				{#if session}
					<button class="more" onclick={() => onOpenSession(session)}>{t('shell.activity.open')}</button>
				{/if}
				<span class="grow"></span>
				{#if task.state === 'closed'}
					<button class="more" onclick={() => setClosed(task, false)}>{t('shell.activity.reopen')}</button>
				{:else}
					<button class="more" onclick={() => setClosed(task, true)}>{t('shell.activity.close')}</button>
				{/if}
			</div>
			{#if replyTo === task.id}
				<div class="reply">
					<!-- svelte-ignore a11y_autofocus -->
					<textarea
						rows="2"
						autofocus
						bind:value={replyText}
						placeholder={t('shell.activity.replyPlaceholder', { title: task.title })}
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
								e.preventDefault();
								void sendReply(task.id);
							} else if (e.key === 'Escape') replyTo = null;
						}}
					></textarea>
					<div class="reply-foot">
						{#if replyError}<span class="reply-err">{replyError}</span>{/if}
						<span class="grow"></span>
						<Button variant="ghost" size="sm" onclick={() => (replyTo = null)}>{t('common.cancel')}</Button>
						<Button variant="primary" size="sm" disabled={!replyText.trim() || replying} onclick={() => sendReply(task.id)}>
							{#if replying}<CircleNotchIcon size={13} class="spin" />{/if}{t('shell.activity.replySend')}
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</li>
{/snippet}

{#if tasks.length === 0}
	<p class="empty">{t('shell.activity.empty')}</p>
{:else}
	{#if current.length}
		<ol class="feed">
			{#each current as task (task.id)}{@render entry(task)}{/each}
		</ol>
	{/if}
	{#if finished.length}
		<button class="more fold" onclick={() => (showFinished = !showFinished)} aria-expanded={showFinished}>
			{showFinished ? t('shell.activity.hideFinished') : t('shell.activity.finished', { n: finished.length })}
		</button>
		{#if showFinished}
			<ol class="feed">
				{#each finished as task (task.id)}{@render entry(task)}{/each}
			</ol>
		{/if}
	{/if}
{/if}

<div class="closed-items">
	<DeskClosed inScope={(id) => id === agent.id} />
</div>

<style>
	.err {
		margin-top: 12px;
	}
	.empty {
		margin: 20px 0 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
		line-height: 1.6;
	}
	/* One rail down the marks, each task hanging off it. */
	.feed {
		position: relative;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
	}
	.feed::before {
		content: '';
		position: absolute;
		top: 12px;
		bottom: 12px;
		left: 13px;
		width: 1px;
		background: var(--hairline);
	}
	.entry {
		position: relative;
		display: flex;
		gap: 14px;
		padding: 14px 0;
	}
	.mark {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 27px;
		height: 27px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		box-shadow: 0 0 0 4px var(--bg);
	}
	.content {
		flex: 1;
		min-width: 0;
		padding-top: 3px;
	}
	.line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: var(--fs-sm);
	}
	.title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-weight: 500;
	}
	.at {
		margin-left: auto;
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	/* The state is a small signal beside the title, never a filled block. */
	.state {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 5px;
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.state.needs_you {
		color: var(--warn);
	}
	.state.needs_you .dot {
		background: var(--warn);
	}
	.state.running {
		color: var(--accent-bright);
	}
	.state.waiting .dot {
		background: var(--accent);
	}
	.entry.attention .mark {
		color: var(--warn);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
		text-decoration: underline;
	}
	.body {
		margin-top: 6px;
		font-size: var(--fs-sm);
		line-height: 1.6;
		color: var(--text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.instruction {
		margin-top: 8px;
		padding: 8px 12px;
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--fs-xs);
		line-height: 1.6;
		color: var(--dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.clamp {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.note {
		margin: 6px 0 0;
		font-size: var(--fs-xs);
	}
	.note.warn {
		color: var(--warn);
	}
	.runs {
		margin: 8px 0 0;
		padding: 0 0 0 2px;
		list-style: none;
	}
	.run {
		font-size: var(--fs-xs);
	}
	.run.quiet {
		display: flex;
		gap: 10px;
		padding: 3px 0;
		color: var(--dim2);
	}
	.run-row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		width: 100%;
		padding: 3px 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.run-row:hover:not(:disabled) {
		color: var(--text);
	}
	.run-row:disabled {
		cursor: default;
	}
	.run-at {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.run-label {
		flex: none;
	}
	.run-label.needs_you,
	.run-label.failed,
	.run-label.interrupted {
		color: var(--warn);
	}
	.run-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-top: 8px;
	}
	.more {
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.more:hover {
		color: var(--text);
	}
	.more.fold {
		margin: 10px 0 0 41px;
	}
	.closed-items {
		margin-top: 18px;
	}
	.reply {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.reply:focus-within {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.reply textarea {
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 1.5;
		outline: none;
		resize: none;
	}
	.reply-foot {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.reply-err {
		font-size: var(--fs-xs);
		color: var(--err);
	}
	.grow {
		flex: 1;
	}
</style>
