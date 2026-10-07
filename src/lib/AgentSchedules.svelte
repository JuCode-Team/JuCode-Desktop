<script lang="ts">
	// An agent's scheduled tasks on the workbench's 定时任务 page: when each
	// runs next, its last run, and the controls to switch, run, edit and delete it.
	import type { Snippet } from 'svelte';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import ScheduleDialog from '$lib/ScheduleDialog.svelte';
	import ScheduleUsage from '$lib/ScheduleUsage.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import { summary, type Schedule } from '$lib/schedules';
	import { t } from '$lib/i18n';

	let {
		agentId,
		onOpenSession,
		heading
	}: {
		agentId: string;
		onOpenSession: (session: string) => void;
		/** Replaces the section title (the page names the agent instead). */
		heading?: Snippet;
	} = $props();

	const schedules = $derived(
		agentDirectory.schedules.filter((s) => s.agent === agentId).sort((a, b) => a.created_at - b.created_at)
	);
	/** The task in the dialog: null for a new one; undefined while closed. */
	let editing = $state<Schedule | null | undefined>(undefined);
	let showUsage = $state<Record<string, boolean>>({});

	function when(seconds: number): string {
		return new Date(seconds * 1000).toLocaleString(undefined, {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function act(work: () => Promise<unknown>) {
		try {
			await work();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	// Held briefly after a click; the daemon also drops a second run within
	// the same second.
	let starting = $state<Record<string, boolean>>({});
	function run(s: Schedule) {
		starting[s.id] = true;
		setTimeout(() => (starting[s.id] = false), 1500);
		void act(async () => {
			await agentDirectory.runSchedule(s.id);
			toast.success(t('shell.schedule.started', { name: s.name }));
		});
	}

	async function remove(s: Schedule) {
		const ok = await confirm({
			title: t('shell.schedule.deleteTitle', { name: s.name }),
			message: t('shell.schedule.deleteMessage'),
			confirmLabel: t('shell.schedule.delete'),
			danger: true
		});
		if (ok) void act(() => agentDirectory.deleteSchedule(s.id));
	}
</script>

<section>
	<div class="section-head">
		{#if heading}{@render heading()}{:else}<h3>{t('shell.schedule.title')}</h3>{/if}
		<Button size="sm" onclick={() => (editing = null)}><PlusIcon size={13} /> {t('shell.schedule.add')}</Button>
	</div>
	{#if schedules.length === 0}
		<p class="empty">{t('shell.schedule.empty')}</p>
	{/if}
	{#each schedules as s (s.id)}
		<div class="task" class:off={!s.enabled}>
			<Switch
				checked={s.enabled}
				label={t('shell.schedule.enabled')}
				onChange={(enabled) => act(() => agentDirectory.setScheduleEnabled(s.id, enabled))}
			/>
			<div class="text">
				<div class="name">
					{s.name}
					{#if s.by_agent && !s.enabled}<span class="proposed">{t('shell.schedule.proposed')}</span>{/if}
				</div>
				<div class="meta">
					<span>{summary(s)}</span>
					<span>
						·
						{#if !s.enabled}{t('shell.schedule.off')}
						{:else if s.next_run_at}{t('shell.schedule.next', { time: when(s.next_run_at) })}
						{:else}{t('shell.schedule.done')}{/if}
					</span>
					{#if s.last_run_at}
						<span>
							·
							{#if s.last_session}
								<button class="link" onclick={() => onOpenSession(s.last_session!)}>
									{t('shell.schedule.last', { time: when(s.last_run_at) })}
								</button>
							{:else}{t('shell.schedule.last', { time: when(s.last_run_at) })}{/if}
						</span>
					{/if}
				</div>
			</div>
			<IconButton size="sm" title={t('shell.schedule.runNow')} disabled={starting[s.id]} onclick={() => run(s)}><PlayIcon size={14} /></IconButton>
			<IconButton size="sm" title={t('shell.schedule.edit')} onclick={() => (editing = s)}><PencilSimpleIcon size={14} /></IconButton>
			<IconButton size="sm" title={t('shell.schedule.delete')} onclick={() => remove(s)}><TrashIcon size={14} /></IconButton>
		</div>
		{#if s.last_run_at}
			<details class="usage" ontoggle={(e) => (showUsage[s.id] = e.currentTarget.open)}>
				<summary>{t('shell.schedule.usage')}</summary>
				{#if showUsage[s.id]}<ScheduleUsage schedule={s.id} agent={agentId} {onOpenSession} />{/if}
			</details>
		{/if}
	{/each}
</section>

{#if editing !== undefined}
	<ScheduleDialog agent={agentId} schedule={editing ?? undefined} onClose={() => (editing = undefined)} />
{/if}

<style>
	section {
		margin-top: 16px;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h3 {
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.task {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 0;
	}
	.usage {
		margin: 0 0 10px 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.usage summary {
		cursor: pointer;
		padding: 4px 0;
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	.name {
		font-size: var(--fs-sm);
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.proposed {
		margin-left: 6px;
		padding: 1px 7px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.task.off .name {
		color: var(--dim2);
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
		color: var(--accent-bright);
		font: inherit;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
