<script lang="ts">
	// An agent's tasks on its page: what is waiting for the user, then one
	// entry per task (a session): what started it and where from, its state,
	// what it concluded, the reports it posted; reply to continue it, or open
	// the session. Most recently active first; archived tasks (earlier runs
	// of a scheduled task) only on request.
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import AlarmIcon from 'phosphor-svelte/lib/AlarmIcon';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import ChatsIcon from 'phosphor-svelte/lib/ChatsIcon';
	import ArrowBendDownRightIcon from 'phosphor-svelte/lib/ArrowBendDownRightIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import DeskContent from '$lib/DeskContent.svelte';
	import { agentDirectory, type AgentView, type MessageView, type ReportView } from '$lib/agents.svelte';
	import { threads, type Source, type Thread } from '$lib/agentActivity';
	import { t } from '$lib/i18n';

	let {
		agent,
		onOpenSession,
		onOpenAgent,
		onNewSession
	}: {
		agent: AgentView;
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
		/** Open a new, empty session of the agent. */
		onNewSession: () => void;
	} = $props();

	let messages = $state<MessageView[] | null>(null);
	let handoffs = $state<Record<string, string>>({});
	let error = $state('');
	let expanded = $state<Record<string, boolean>>({});

	// Reload on every delivery or report, and when a run ends (its handoff
	// note follows); the daemon keeps the log.
	$effect(() => {
		void agentDirectory.activity;
		void agent.running?.length;
		const id = agent.id;
		agentDirectory.messages(id).then(
			(list) => {
				messages = list;
				error = '';
			},
			(e) => (error = e instanceof Error ? e.message : String(e))
		);
		agentDirectory.handoffs(id).then((notes) => (handoffs = notes), () => {});
	});

	const list = $derived(
		threads(
			agent.id,
			agentDirectory.sessions,
			messages ?? [],
			agentDirectory.reports,
			agentDirectory.schedules,
			agent.running ?? [],
			handoffs
		)
	);

	let showArchived = $state(false);
	const archivedCount = $derived(list.filter((thread) => thread.archived).length);
	const shown = $derived(showArchived ? list : list.filter((thread) => !thread.archived));

	function sourceLabel(source: Source | null): string {
		switch (source?.kind) {
			case 'user':
				return t('shell.activity.fromUser');
			case 'schedule':
				return t('shell.activity.fromSchedule', { name: source.name });
			case 'timer':
				return t('shell.activity.fromTimer');
			case 'agent':
				return t('shell.activity.fromAgent', { name: agentDirectory.agentName(source.id) });
			case 'answer':
				return t('shell.activity.fromAnswer');
			case 'other':
				return t('shell.activity.fromOther', { from: source.from });
			default:
				return t('shell.activity.fromSession');
		}
	}

	/** The task as the user wrote it: a scheduled run without its 定时任务「…」
	 *  header and the last run's handoff the daemon appends (the thread shows
	 *  its own conclusion). */
	function taskText(thread: Thread): string {
		let body = thread.task?.body ?? '';
		if (thread.source?.kind === 'schedule') {
			body = body.replace(/^定时任务「[^」]*」：\n/, '');
			const cut = body.indexOf('\n\n上次运行（');
			if (cut >= 0) body = body.slice(0, cut);
		}
		return body;
	}
	const isLong = (text: string) => text.length > 220 || text.split('\n').length > 3;

	function titleOf(thread: Thread): string {
		return thread.title || thread.task?.body.split('\n')[0] || t('shell.agentPage.untitled');
	}

	function when(ms: number): string {
		const d = new Date(ms);
		const today = new Date().toDateString() === d.toDateString();
		return d.toLocaleString(undefined, today ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function toggle(key: string, report?: ReportView) {
		expanded[key] = !expanded[key];
		if (report && expanded[key] && !report.read) void agentDirectory.markRead(report).catch(() => {});
	}

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
	async function sendReply(session: string) {
		const body = replyText.trim();
		if (!body || replying) return;
		replying = true;
		replyError = '';
		try {
			await agentDirectory.message(agent.id, body, session);
			replyTo = null;
			replyText = '';
		} catch (e) {
			replyError = e instanceof Error ? e.message : String(e);
		} finally {
			replying = false;
		}
	}
</script>

<DeskContent agent={agent.id} {onOpenSession} />

{#if error}<div class="err"><Notice>{t('shell.activity.loadFailed', { error })}</Notice></div>{/if}

<div class="head">
	<span class="count">{shown.length ? t('shell.activity.count', { n: shown.length }) : ''}</span>
	<Button size="sm" variant="ghost" disabled={!agent.enabled} onclick={onNewSession}><PlusIcon size={13} /> {t('shell.agentPage.newSession')}</Button>
</div>

{#if messages === null && !error}
	<div class="loading"><CircleNotchIcon size={16} class="spin" /></div>
{:else if list.length === 0 && !error}
	<p class="empty">{t('shell.activity.empty')}</p>
{:else}
	<ol class="feed">
		{#each shown as thread (thread.id)}
			{@const session = thread.session}
			{@const body = taskText(thread)}
			{@const long = isLong(body)}
			{@const unread = thread.reports.some((r) => !r.read)}
			<li class="entry" class:unread>
				<span class="mark">
					{#if thread.source?.kind === 'user'}<UserIcon size={14} />
					{:else if thread.source?.kind === 'schedule'}<ClockIcon size={14} />
					{:else if thread.source?.kind === 'timer'}<AlarmIcon size={14} />
					{:else if thread.source?.kind === 'agent'}
						{@const from = agentDirectory.agents.find((a) => a.id === (thread.source as { id: string }).id)}
						{#if from}<AgentAvatar agent={from} size={14} />{:else}<ArrowBendDownRightIcon size={14} />{/if}
					{:else if thread.source?.kind === 'answer'}<ChatCircleTextIcon size={14} />
					{:else if !thread.task && thread.reports.length}<FileTextIcon size={14} />
					{:else}<ChatsIcon size={14} />{/if}
				</span>
				<div class="content">
					<div class="line">
						<span class="title">{titleOf(thread)}</span>
						{#if thread.status === 'running'}
							<span class="state live"><CircleNotchIcon size={12} class="spin" />{t('shell.activity.running')}</span>
						{:else if thread.status === 'queued'}
							<span class="state">{t('shell.activity.queued')}</span>
						{/if}
						<span class="at">{when(thread.latest)}</span>
					</div>
					<div class="meta">
						{#if thread.source?.kind === 'agent'}
							{@const from = thread.source.id}
							<button class="link" onclick={() => onOpenAgent(from)}>{sourceLabel(thread.source)}</button>
						{:else}
							<span>{sourceLabel(thread.source)}</span>
						{/if}
						{#if thread.followUps.length}<span>· {t('shell.activity.followUps', { n: thread.followUps.length })}</span>{/if}
					</div>

					{#if body && thread.title}
						<div class="body" class:clamp={long && !expanded[thread.id]}>{body}</div>
						{#if long}
							<button class="more" onclick={() => toggle(thread.id)}>{expanded[thread.id] ? t('shell.activity.less') : t('shell.activity.more')}</button>
						{/if}
					{/if}

					{#if thread.status === 'undeliverable'}
						{@const failed = [thread.task, ...thread.followUps].find((m) => m?.status === 'undeliverable')}
						<p class="state warn">{t('shell.activity.undeliverable', { reason: failed?.reason ?? '' })}</p>
					{/if}

					{#if thread.handoff}
						<div class="handoff">
							<span class="tag">{t('shell.activity.conclusion')}</span>
							<div class="handoff-text" class:clamp={!expanded[`h:${thread.id}`]}>{thread.handoff}</div>
							{#if isLong(thread.handoff)}
								<button class="more" onclick={() => toggle(`h:${thread.id}`)}>{expanded[`h:${thread.id}`] ? t('shell.activity.less') : t('shell.activity.more')}</button>
							{/if}
						</div>
					{/if}

					{#each thread.reports as report (report.id)}
						{@const key = `r:${report.id}`}
						<div class="report" class:unread={!report.read}>
							<button class="report-head" onclick={() => toggle(key, report)} aria-expanded={!!expanded[key]}>
								<FileTextIcon size={13} />
								<span class="report-title">{report.title}</span>
								<span class="at">{when(report.at)}</span>
							</button>
							{#if expanded[key] && report.body}<div class="body">{report.body}</div>{/if}
						</div>
					{/each}

					{#if session}
						<div class="foot">
							{#if agent.enabled}
								<button class="more" onclick={() => startReply(thread.id)}>{t('shell.activity.reply')}</button>
							{/if}
							<button class="more" onclick={() => onOpenSession(session)}>{t('shell.activity.openSession')}</button>
						</div>
						{#if replyTo === thread.id}
							<div class="reply">
								<!-- svelte-ignore a11y_autofocus -->
								<textarea
									rows="2"
									autofocus
									bind:value={replyText}
									placeholder={t('shell.activity.replyPlaceholder', { title: titleOf(thread) })}
									onkeydown={(e) => {
										if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
											e.preventDefault();
											void sendReply(session);
										} else if (e.key === 'Escape') replyTo = null;
									}}
								></textarea>
								<div class="reply-foot">
									{#if replyError}<span class="reply-err">{replyError}</span>{/if}
									<span class="grow"></span>
									<Button variant="ghost" size="sm" onclick={() => (replyTo = null)}>{t('common.cancel')}</Button>
									<Button variant="primary" size="sm" disabled={!replyText.trim() || replying} onclick={() => sendReply(session)}>
										{#if replying}<CircleNotchIcon size={13} class="spin" />{/if}{t('shell.activity.replySend')}
									</Button>
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</li>
		{/each}
	</ol>
	{#if archivedCount}
		<button class="more archived" onclick={() => (showArchived = !showArchived)}>
			{showArchived ? t('shell.activity.hideArchived') : t('shell.activity.showArchived', { n: archivedCount })}
		</button>
	{/if}
{/if}

<style>
	.err {
		margin-top: 12px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 14px;
	}
	.count {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.loading {
		display: flex;
		justify-content: center;
		padding: 32px;
		color: var(--dim);
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
	.entry.unread .mark {
		background: color-mix(in oklab, var(--accent) 16%, var(--surface2));
		color: var(--accent-bright);
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
	.meta {
		display: flex;
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
	.clamp {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.state.live {
		color: var(--accent-bright);
	}
	.state.warn {
		margin-top: 6px;
		color: var(--warn);
	}
	/* What the session concluded: the part worth reading first. */
	.handoff {
		margin-top: 8px;
		padding: 8px 12px;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.tag {
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.handoff-text {
		margin-top: 2px;
		font-size: var(--fs-sm);
		line-height: 1.6;
		color: var(--text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.report {
		margin-top: 6px;
	}
	.report-head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.report-head:hover {
		color: var(--text);
	}
	.report.unread .report-head {
		color: var(--accent-bright);
	}
	.report-title {
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
	.more.archived {
		margin: 4px 0 0 41px;
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
