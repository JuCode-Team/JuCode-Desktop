<script lang="ts">
	// The Desk tab's pane on a wide page, with nothing opened from the list:
	// everything waiting for the user, answerable in place, then which agents
	// are working and the next scheduled runs.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import DeskCard from '$lib/DeskCard.svelte';
	import { useAgents } from '$lib/agentScope';
	import { t } from '$lib/i18n';
	import RemoteScreen from './RemoteScreen.svelte';
	import { when } from './desk';

	let {
		onOpenSession,
		onOpenAgent
	}: {
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
	} = $props();

	const agentDirectory = useAgents();
	const pending = $derived(agentDirectory.questions.length + agentDirectory.actions.length);
	const working = $derived(agentDirectory.agents.filter((a) => a.busy));
	const upcoming = $derived(
		agentDirectory.schedules
			.filter((s) => s.enabled && s.next_run_at)
			.sort((a, b) => a.next_run_at! - b.next_run_at!)
			.slice(0, 5)
	);
</script>

<RemoteScreen title={t('shell.desk.title')} subtitle={pending ? t('shell.desk.pendingFor', { n: pending }) : undefined}>
	<div class="home">
		<section>
			<h2>{t('shell.desk.pending')}</h2>
			{#if pending === 0}
				<div class="clear">
					<CheckCircleIcon size={20} />
					<span>{t('shell.desk.nothingPending')}</span>
				</div>
			{:else}
				<div class="queue">
					{#each agentDirectory.questions as q (q.id)}
						<DeskCard question={q} {onOpenSession} {onOpenAgent} />
					{/each}
					{#each agentDirectory.actions as a (a.id)}
						<DeskCard action={a} {onOpenSession} {onOpenAgent} />
					{/each}
				</div>
			{/if}
		</section>

		<div class="status">
			<section>
				<h2>{t('shell.desk.working')}</h2>
				{#each working as agent (agent.id)}
					<button class="line" onclick={() => onOpenAgent(agent.id)}>
						<CircleNotchIcon size={14} class="spin" />
						<AgentAvatar {agent} size={14} />
						<span class="name">{agent.name}</span>
					</button>
				{:else}
					<p class="empty">{t('shell.desk.nobodyWorking')}</p>
				{/each}
			</section>
			<section>
				<h2>{t('shell.schedule.upcoming')}</h2>
				{#each upcoming as s (s.id)}
					<div class="line static">
						<ClockIcon size={14} />
						<span class="time">{when(s.next_run_at! * 1000)}</span>
						<span class="name">{s.name}</span>
						<span class="who">{agentDirectory.agentName(s.agent)}</span>
					</div>
				{:else}
					<p class="empty">{t('shell.desk.nothingScheduled')}</p>
				{/each}
			</section>
		</div>
	</div>
</RemoteScreen>

<style>
	.home {
		display: flex;
		flex-direction: column;
		gap: 28px;
		max-width: 760px;
		margin: 12px auto 0;
		animation: rise var(--t-med) var(--ease-out);
	}
	h2 {
		margin: 0 0 10px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.queue {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.clear {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 18px 16px;
		border: 1px dashed var(--border);
		border-radius: var(--r-md);
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.status {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 20px 32px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 34px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.line.static {
		cursor: default;
	}
	.line:not(.static):hover {
		background: var(--surface);
	}
	.line > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.time {
		flex-shrink: 0;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.who {
		flex-shrink: 0;
		max-width: 40%;
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.empty {
		margin: 0;
		padding: 0 8px;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
</style>
