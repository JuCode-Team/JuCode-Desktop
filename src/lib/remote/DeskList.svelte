<script lang="ts">
	// The Desk tab's list on the remote page: what waits for the user, then
	// the agents' reports; one row each, opened as a page (DeskItemScreen).
	// With `status` (a phone, where the list is the whole tab), which agents
	// are working and the next scheduled runs too; a wide page shows those
	// beside the queue (DeskHome).
	import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import Notice from '$lib/ui/Notice.svelte';
	import DeskClosed from '$lib/DeskClosed.svelte';
	import { useAgents } from '$lib/agentScope';
	import { t } from '$lib/i18n';
	import { deskKey, when } from './desk';

	let {
		current,
		status = false,
		onOpen,
		onOpenAgent
	}: {
		/** The item shown in the pane, highlighted. */
		current?: string;
		status?: boolean;
		onOpen: (key: string) => void;
		onOpenAgent: (agent: string) => void;
	} = $props();

	const agentDirectory = useAgents();
	const pending = $derived(agentDirectory.questions.length + agentDirectory.actions.length);
	const working = $derived(agentDirectory.agents.filter((a) => a.busy));
	const upcoming = $derived(
		agentDirectory.schedules
			.filter((s) => s.enabled && s.next_run_at)
			.sort((a, b) => a.next_run_at! - b.next_run_at!)
			.slice(0, 3)
	);
</script>

<div class="desk">
	{#if agentDirectory.status === 'unreachable'}
		<Notice tone="warn">{t('shell.desk.unreachable')}</Notice>
	{/if}

	<section>
		<div class="head"><span>{t('shell.desk.pending')}</span>{#if pending}<span class="count">{pending}</span>{/if}</div>
		{#each agentDirectory.questions as q (q.id)}
			{@const key = deskKey('question', q.id)}
			<button class="row" class:on={current === key} class:high={q.importance === 'high'} onclick={() => onOpen(key)}>
				<QuestionIcon size={16} />
				<span class="text">
					<span class="title">{q.title}</span>
					<span class="meta">{agentDirectory.agentName(q.agent)} · {when(q.asked_at)}</span>
				</span>
			</button>
		{/each}
		{#each agentDirectory.actions as a (a.id)}
			{@const key = deskKey('action', a.id)}
			{@const agent = agentDirectory.agentOfSession(a.session_id)}
			<button class="row" class:on={current === key} onclick={() => onOpen(key)}>
				<ShieldCheckIcon size={16} />
				<span class="text">
					<span class="title"><code>{a.name}</code> {a.summary}</span>
					<span class="meta">{agent?.name ?? a.cwd} · {when(a.created_at)}</span>
				</span>
			</button>
		{/each}
		{#if pending === 0}<p class="empty">{t('shell.desk.nothingPending')}</p>{/if}
		<div class="closed"><DeskClosed /></div>
	</section>

	{#if status}
		<section>
			<div class="head"><span>{t('shell.desk.working')}</span></div>
			{#each working as agent (agent.id)}
				<button class="row" onclick={() => onOpenAgent(agent.id)}>
					<CircleNotchIcon size={16} class="spin" />
					<span class="text"><span class="title">{agent.name}</span></span>
				</button>
			{:else}
				<p class="empty">{t('shell.desk.nobodyWorking')}</p>
			{/each}
		</section>
		{#if upcoming.length}
			<section>
				<div class="head"><span>{t('shell.schedule.upcoming')}</span></div>
				{#each upcoming as s (s.id)}
					<div class="row static">
						<ClockIcon size={16} />
						<span class="text">
							<span class="title">{s.name}</span>
							<span class="meta">{agentDirectory.agentName(s.agent)} · {when(s.next_run_at! * 1000)}</span>
						</span>
					</div>
				{/each}
			</section>
		{/if}
	{/if}

	<section>
		<div class="head"><span>{t('shell.desk.reports')}</span></div>
		{#each agentDirectory.reports as r (r.id)}
			{@const key = deskKey('report', r.id)}
			<button class="row" class:on={current === key} class:unread={!r.read} class:read={r.read} onclick={() => onOpen(key)}>
				<FileTextIcon size={16} />
				<span class="text">
					<span class="title">{r.title}</span>
					<span class="meta">{agentDirectory.agentName(r.agent)} · {when(r.at)}</span>
				</span>
				{#if !r.read}<span class="dot"></span>{/if}
			</button>
		{:else}
			<p class="empty">{t('shell.desk.noReports')}</p>
		{/each}
	</section>
</div>

<style>
	.desk {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding-bottom: 16px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.count {
		min-width: 18px;
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--accent);
		color: var(--on-accent);
		font-size: var(--fs-2xs);
		line-height: 18px;
		text-align: center;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 48px;
		padding: 6px 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
		animation: fade var(--t-med) var(--ease-out);
	}
	.row.static {
		cursor: default;
	}
	.row:not(.static):hover {
		background: var(--surface);
	}
	.row:not(.static):active {
		transform: scale(0.985);
	}
	.row.on {
		background: var(--surface2);
	}
	.row > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.row.high > :global(svg) {
		color: var(--warn);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.title,
	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--accent-bright);
	}
	.meta {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.row.read .title {
		color: var(--dim);
	}
	.row.unread .title {
		font-weight: 600;
	}
	.dot {
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
	}
	.closed {
		padding: 0 12px;
	}
	.empty {
		margin: 0;
		padding: 4px 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
</style>
