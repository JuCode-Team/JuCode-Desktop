<script lang="ts">
	// The workbench's 定时任务 page: every scheduled task with where and how
	// it runs, when it runs next, how its latest run went, and the controls
	// to switch, run, edit and delete it.
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import ScheduleDialog from '$lib/ScheduleDialog.svelte';
	import ScheduleUsage from '$lib/ScheduleUsage.svelte';
	import { daemonState } from '$lib/daemonState.svelte';
	import { engineLabel, MAX_FAILURES, summary, type Schedule } from '$lib/schedules';
	import { acpPresets, type AcpPreset } from '$lib/protocol';
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';

	let {
		projects,
		onOpenSession
	}: {
		/** Offered as the folder a task runs in. */
		projects: { id: string; path: string; name: string }[];
		onOpenSession: (session: string) => void;
	} = $props();

	const schedules = $derived([...daemonState.schedules].sort((a, b) => a.created_at - b.created_at));
	/** The task in the dialog: null for a new one; undefined while closed. */
	let editing = $state<Schedule | null | undefined>(undefined);
	let showUsage = $state<Record<string, boolean>>({});
	/** For the names of the ACP agents tasks run on. */
	let presets = $state<AcpPreset[]>([]);
	onMount(() => {
		acpPresets().then((list) => (presets = list), () => {});
	});

	/** Where it runs: the project's name, else the folder's. */
	function place(s: Schedule): string {
		if (!s.cwd) return t('shell.schedule.noCwd');
		return projects.find((p) => p.path === s.cwd)?.name ?? s.cwd.split(/[\\/]/).pop() ?? s.cwd;
	}

	async function act(work: () => Promise<unknown>) {
		try {
			await work();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	// Held briefly after a click, so a double click starts one run.
	let starting = $state<Record<string, boolean>>({});
	function run(s: Schedule) {
		starting[s.id] = true;
		setTimeout(() => (starting[s.id] = false), 1500);
		void act(async () => {
			await daemonState.runSchedule(s.id);
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
		if (ok) void act(() => daemonState.deleteSchedule(s.id));
	}
</script>

<div class="page-head">
	<h1>{t('shell.schedule.title')}</h1>
	<Button size="sm" onclick={() => (editing = null)}><PlusIcon size={14} /> {t('shell.schedule.add')}</Button>
</div>
<p class="lede">{t('shell.schedule.boardHint')}</p>

{#if schedules.length === 0}
	<p class="empty">{t('shell.schedule.empty')}</p>
{/if}
{#each schedules as s (s.id)}
	{@const last = s.last_run}
	<div class="task" class:off={!s.enabled}>
		<Switch
			checked={s.enabled}
			label={t('shell.schedule.enabled')}
			onChange={(enabled) => act(() => daemonState.setScheduleEnabled(s.id, enabled))}
		/>
		<div class="text">
			<div class="name">
				{s.name}
				{#if last?.status === 'running'}<span class="working">{t('shell.schedule.statusRunning')}</span>
				{:else if last?.status === 'waiting'}<span class="needs">{t('shell.schedule.statusWaiting')}</span>
				{:else if last?.status === 'background'}<span class="working">{t('shell.schedule.statusBackground')}</span>
				{:else if last?.status === 'failed'}<span class="failed">{s.enabled && (s.failures ?? 0) > 1 ? t('shell.schedule.failuresInRow', { n: s.failures! }) : t('shell.schedule.statusFailed')}</span>{/if}
			</div>
			<div class="meta">
				<span>{summary(s)}</span>
				<span>
					·
					{#if !s.enabled}{(s.failures ?? 0) >= MAX_FAILURES ? t('shell.schedule.stoppedAfter', { n: s.failures! }) : t('shell.schedule.off')}
					{:else if s.next_run_at}{t('shell.schedule.next', { time: when(s.next_run_at) })}
					{:else}{t('shell.schedule.done')}{/if}
				</span>
				<span>· {place(s)} · {engineLabel(s, presets)}</span>
				{#if last}
					<span>
						·
						{#if last.session}
							<button class="link" onclick={() => onOpenSession(last.session!)}>
								{t('shell.schedule.last', { time: when(last.at) })}
							</button>
						{:else}{t('shell.schedule.last', { time: when(last.at) })}{/if}
					</span>
				{/if}
			</div>
			{#if last?.status === 'failed' && last.error}<div class="error">{last.error}</div>{/if}
		</div>
		<IconButton size="sm" title={t('shell.schedule.runNow')} disabled={starting[s.id] || !s.cwd} onclick={() => run(s)}><PlayIcon size={14} /></IconButton>
		<IconButton size="sm" title={t('shell.schedule.edit')} onclick={() => (editing = s)}><PencilIcon size={14} /></IconButton>
		<IconButton size="sm" title={t('shell.schedule.delete')} onclick={() => remove(s)}><TrashIcon size={14} /></IconButton>
	</div>
	{#if last}
		<details class="usage" ontoggle={(e) => (showUsage[s.id] = e.currentTarget.open)}>
			<summary>{t('shell.schedule.usage')}</summary>
			{#if showUsage[s.id]}<ScheduleUsage schedule={s.id} {onOpenSession} />{/if}
		</details>
	{/if}
{/each}

{#if editing !== undefined}
	<ScheduleDialog schedule={editing ?? undefined} {projects} onClose={() => (editing = undefined)} />
{/if}

<style>
	.page-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
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
	.task.off .name {
		color: var(--dim2);
	}
	.working,
	.needs,
	.failed {
		margin-left: 8px;
		font-size: var(--fs-xs);
	}
	.working {
		color: var(--accent-bright);
	}
	.needs {
		color: var(--warn);
	}
	.failed {
		color: var(--err);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.error {
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.usage {
		margin: 0 0 10px 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.usage summary {
		cursor: pointer;
		padding: 4px 0;
	}
</style>
