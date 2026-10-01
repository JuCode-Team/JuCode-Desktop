<script lang="ts">
	// The workbench's 定时任务 page: every agent's scheduled tasks, grouped by
	// agent, with the reminders each agent set itself.
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import AgentSchedules from '$lib/AgentSchedules.svelte';
	import { agentDirectory, type AgentView, type TimerView } from '$lib/agents.svelte';
	import { t } from '$lib/i18n';

	let {
		agents,
		onOpenSession,
		onOpenAgent
	}: {
		/** The agents shown (the workbench's workspace scope). */
		agents: AgentView[];
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
	} = $props();

	let timers = $state<Record<string, TimerView[]>>({});
	$effect(() => {
		for (const a of agents) {
			if (a.id in timers) continue;
			timers[a.id] = [];
			agentDirectory.timers(a.id).then((list) => (timers[a.id] = list), () => {});
		}
	});

	function when(ms: number): string {
		return new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
</script>

<h1>{t('shell.schedule.title')}</h1>
<p class="lede">{t('shell.schedule.boardHint')}</p>

{#each agents as a (a.id)}
	<div class="group" class:off={!a.enabled}>
		<AgentSchedules agentId={a.id} {onOpenSession}>
			{#snippet heading()}
				<button class="agent" onclick={() => onOpenAgent(a.id)}>
					<AgentAvatar agent={a} size={20} />
					<span>{a.name}</span>
				</button>
			{/snippet}
		</AgentSchedules>
		{#if timers[a.id]?.length}
			<div class="timers">
				<span class="timers-head">{t('shell.agentPage.timers')}</span>
				{#each timers[a.id] as timer (timer.timer)}
					<div class="timer">
						<span class="when">{when(timer.fire_at)}</span>
						<span class="timer-body">{timer.body}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/each}

<style>
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
	}
	.lede {
		margin: 10px 0 22px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.group {
		padding: 4px 16px 12px;
		margin-bottom: 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--surface);
	}
	.agent {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.agent:hover span {
		text-decoration: underline;
	}
	.group.off .agent {
		opacity: 0.55;
	}
	.timers {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--hairline);
	}
	.timers-head {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.timer {
		display: flex;
		gap: 10px;
		padding: 4px 0;
		font-size: var(--fs-sm);
	}
	.when {
		flex: none;
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		color: var(--dim2);
	}
	.timer-body {
		flex: 1;
		min-width: 0;
		color: var(--text);
	}
</style>
