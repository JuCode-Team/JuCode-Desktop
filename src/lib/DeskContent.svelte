<script lang="ts">
	// The desk's content: questions and pending actions waiting for the user
	// (and the ones closed lately, to undo), which agents are working, the next scheduled runs, and their reports. Everything comes from the
	// jucode daemon through agentDirectory. Shown on the desktop's workbench
	// and on the remote page. With `agent`, only that agent's pending items
	// (its page shows the rest as activity).
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import PauseIcon from 'phosphor-svelte/lib/PauseIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import DeskCard from '$lib/DeskCard.svelte';
	import DeskClosed from '$lib/DeskClosed.svelte';
	import RequirementTag from '$lib/requirements/RequirementTag.svelte';
	import { statusLabel } from '$lib/requirements/labels';
	import type { Requirement } from '$lib/requirements.svelte';
	import type { AgentView, ReportView } from '$lib/agents.svelte';
	import type { Schedule } from '$lib/schedules';
	import { useAgents } from '$lib/agentScope';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';

	let {
		onOpenSession,
		onOpenAgent,
		agent,
		agents,
		requirements = [],
		onOpenRequirement
	}: {
		/** Show a daemon session. */
		onOpenSession: (session: string) => void;
		/** Show an agent's page; its names link there when given. */
		onOpenAgent?: (agent: string) => void;
		agent?: string;
		/** Only these agents' items (the workbench's workspace scope). */
		agents?: string[];
		/** Requirements on the user's turn, listed first. */
		requirements?: Requirement[];
		onOpenRequirement?: (id: string) => void;
	} = $props();

	// The app's directory; on the remote page, the shown computer's.
	const agentDirectory = useAgents();
	const inScope = (id: string | undefined) => (!agent || id === agent) && (!agents || (!!id && agents.includes(id)));
	const questions = $derived(agentDirectory.questions.filter((q) => inScope(q.agent)));
	const actions = $derived(agentDirectory.actions.filter((a) => inScope(agentDirectory.agentOfSession(a.session_id)?.id)));
	const reports = $derived(agentDirectory.reports.filter((r) => inScope(r.agent)));
	const pending = $derived(questions.length + actions.length + requirements.length);

	let expanded = $state<Record<string, boolean>>({});
	let changing = $state<Record<string, boolean>>({});

	async function changeSchedule(s: Schedule, remove = false) {
		if (changing[s.id]) return;
		changing[s.id] = true;
		try {
			if (remove) {
				if (await confirm({
					title: t('shell.schedule.deleteTitle', { name: s.name }),
					message: t('shell.schedule.deleteMessage'),
					confirmLabel: t('shell.schedule.delete'),
					danger: true
				})) await agentDirectory.deleteSchedule(s.id);
			} else {
				await agentDirectory.setScheduleEnabled(s.id, false);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			changing[s.id] = false;
		}
	}

	const working = $derived(agentDirectory.agents.filter((a) => a.busy && inScope(a.id)));
	const upcoming = $derived(
		agentDirectory.schedules
			.filter((s) => s.enabled && s.next_run_at && inScope(s.agent))
			.sort((a, b) => a.next_run_at! - b.next_run_at!)
			.slice(0, 3)
	);


	function toggleReport(r: ReportView) {
		expanded[r.id] = !expanded[r.id];
		if (expanded[r.id]) void agentDirectory.markRead(r).catch(() => {});
	}
</script>

{#snippet face(agent: AgentView | undefined)}
	{#if agent}<AgentAvatar {agent} size={14} />{/if}
{/snippet}

{#if agentDirectory.status === 'unreachable'}
	<div class="unreachable"><Notice tone="warn">{t('shell.desk.unreachable')}</Notice></div>
{/if}

{#if !agent || pending}
<section>
	<h3>{t('shell.desk.pending')} <span class="count">{pending}</span></h3>
	{#if pending === 0}
		<p class="empty">{t('shell.desk.nothingPending')}</p>
	{/if}
	<div class="cards">
		{#each requirements as r (r.id)}
			<button class="req" onclick={() => onOpenRequirement?.(r.id)}>
				<span class="req-head">
					<RequirementTag id={r.id} />
					<span class="req-title">{r.title}</span>
					<span class="req-status {r.status}">{statusLabel(r.status)}</span>
				</span>
				{#if r.last_reply}<span class="req-tail">{r.last_reply.replace(/\s+/g, ' ')}</span>{/if}
			</button>
		{/each}
		{#each questions as q (q.id)}
			<DeskCard question={q} {onOpenSession} {onOpenAgent} />
		{/each}
		{#each actions as a (a.id)}
			<DeskCard action={a} {onOpenSession} {onOpenAgent} />
		{/each}
	</div>
	{#if !agent}<DeskClosed {inScope} />{/if}
</section>
{/if}

{#if !agent}
<section>
	<h3>{t('shell.desk.working')}</h3>
	{#if working.length === 0}
		<p class="empty">{t('shell.desk.nobodyWorking')}</p>
	{:else}
		<div class="working">
			{#each working as agent (agent.id)}
				<button class="chip" disabled={!onOpenAgent} onclick={() => onOpenAgent?.(agent.id)}><CircleNotchIcon size={14} class="spin" /><AgentAvatar {agent} size={14} />{agent.name}</button>
			{/each}
		</div>
	{/if}
	{#if upcoming.length}
		<h3 class="sub">{t('shell.schedule.upcoming')}</h3>
		<ul class="upcoming">
			{#each upcoming as s (s.id)}
				<li>
					<ClockIcon size={14} />
					<span class="time">{when(s.next_run_at! * 1000)}</span>
					<span class="what">{s.name}</span>
					<span class="who">{agentDirectory.agentName(s.agent)}</span>
					<IconButton size="sm" title={t('shell.schedule.pause')} disabled={changing[s.id]} onclick={() => changeSchedule(s)}><PauseIcon size={14} /></IconButton>
					<IconButton size="sm" title={t('shell.schedule.delete')} disabled={changing[s.id]} onclick={() => changeSchedule(s, true)}><TrashIcon size={14} /></IconButton>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h3>{t('shell.desk.reports')}</h3>
	{#if reports.length === 0}
		<p class="empty">{t('shell.desk.noReports')}</p>
	{/if}
	{#each reports as r (r.id)}
		<article class="report" class:unread={!r.read}>
			<button class="report-head" onclick={() => toggleReport(r)}>
				<FileTextIcon size={13} />
				<span class="title">{r.title}</span>
				{@render face(agentDirectory.agents.find((x) => x.id === r.agent))}
				<span class="who">{agentDirectory.agentName(r.agent)} · {when(r.at)}</span>
			</button>
			{#if expanded[r.id]}
				{#if r.body}<div class="text">{r.body}</div>{/if}
				<div class="actions">
					{#if onOpenAgent}<Button size="sm" onclick={() => onOpenAgent(r.agent)}>{agentDirectory.agentName(r.agent)}</Button>{/if}
					<Button size="sm" onclick={() => onOpenSession(r.session)}>{t('shell.desk.openSession')}</Button>
				</div>
			{/if}
		</article>
	{/each}
</section>
{/if}

<style>
	section {
		margin-top: 14px;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
	}
	.count {
		font-size: var(--fs-2xs);
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.unreachable {
		margin-top: 10px;
	}
	.who {
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.text {
		font-size: var(--fs-sm);
		color: var(--text);
		line-height: 1.55;
		white-space: pre-wrap;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.working {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h3.sub {
		margin-top: 14px;
	}
	.upcoming {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.upcoming li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 6px 2px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.upcoming li > :global(svg) {
		flex-shrink: 0;
	}
	.upcoming .time {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.upcoming .what {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.upcoming .who {
		flex-shrink: 1;
		margin-left: auto;
	}
	button.chip:not(:disabled) {
		cursor: pointer;
	}
	button.chip:not(:disabled):hover {
		background: var(--surface);
	}
	.chip {
		border: none;
		color: inherit;
		font-family: inherit;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border-radius: var(--r-full);
		background: var(--surface2);
		font-size: var(--fs-xs);
	}
	.report {
		border-bottom: 1px solid var(--hairline);
		padding: 4px 0 8px;
	}
	.report .text {
		margin: 4px 0 8px 21px;
	}
	.report-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 2px;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
		text-align: left;
	}
	.report-head > :global(svg) {
		flex-shrink: 0;
	}
	.report-head .title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: var(--dim);
	}
	.report-head .who {
		flex-shrink: 0;
		max-width: 45%;
	}
	.report.unread .title {
		font-weight: 600;
		color: var(--text);
	}
	.req {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		padding: 11px 13px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.req:hover {
		border-color: var(--border-strong);
	}
	.req-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: var(--fs-sm);
	}
	.req-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.req-status {
		flex: none;
		font-size: var(--fs-xs);
		color: var(--warn);
	}
	.req-status.approval,
	.req-status.failed {
		color: var(--err);
	}
	.req-tail {
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
