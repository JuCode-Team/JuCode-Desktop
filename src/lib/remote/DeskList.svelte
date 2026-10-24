<script lang="ts">
	// The remote page's 待处理 tab: approvals that sessions deferred while
	// nobody watched them, one row each, opened as a page (DeskItemScreen),
	// and the computer's scheduled tasks, which can be switched on or off and
	// run from here (they are made and changed on the desktop).
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PlayIcon from '@lucide/svelte/icons/play';
	import Notice from '$lib/ui/Notice.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import DeskClosed from '$lib/DeskClosed.svelte';
	import NotifyToggle from './NotifyToggle.svelte';
	import { useDaemonState } from '$lib/daemonScope';
	import { MAX_FAILURES, summary, type Schedule } from '$lib/schedules';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';

	let {
		current,
		onOpen
	}: {
		/** The action shown in the pane, highlighted. */
		current?: string;
		onOpen: (action: string) => void;
	} = $props();

	const daemon = useDaemonState();
	/** A computer whose daemon is older keeps its tasks in another shape. */
	const outdated = $derived(daemon.schedules.some((s) => !('engine' in s)));
	let error = $state('');
	let starting = $state<Record<string, boolean>>({});

	async function act(work: () => Promise<unknown>) {
		error = '';
		try {
			await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
	function run(s: Schedule) {
		starting[s.id] = true;
		setTimeout(() => (starting[s.id] = false), 1500);
		void act(() => daemon.runSchedule(s.id));
	}
	function status(s: Schedule): string {
		const last = s.last_run;
		if (last?.status === 'running') return t('shell.schedule.statusRunning');
		if (last?.status === 'waiting') return t('shell.schedule.statusWaiting');
		if (last?.status === 'background') return t('shell.schedule.statusBackground');
		if (!s.enabled && (s.failures ?? 0) >= MAX_FAILURES) return t('shell.schedule.stoppedAfter', { n: s.failures! });
		if (last?.status === 'failed') return t('shell.schedule.statusFailed');
		if (!s.enabled) return t('shell.schedule.off');
		return s.next_run_at ? t('shell.schedule.next', { time: when(s.next_run_at) }) : t('shell.schedule.done');
	}
</script>

<div class="desk">
	{#if daemon.status === 'unreachable'}
		<Notice tone="warn">{t('shell.desk.unreachable')}</Notice>
	{/if}
	<div class="notify-wrap"><NotifyToggle /></div>

	<section>
		<div class="head"><span>{t('shell.desk.pending')}</span>{#if daemon.actions.length}<span class="count">{daemon.actions.length}</span>{/if}</div>
		{#each daemon.actions as a (a.id)}
			<button class="row" class:on={current === a.id} onclick={() => onOpen(a.id)}>
				<ShieldCheckIcon size={16} />
				<span class="text">
					<span class="title"><code>{a.name}</code> {a.summary}</span>
					<span class="meta">{daemon.sessions.find((s) => s.session === a.session_id)?.title || a.cwd} · {when(a.created_at)}</span>
				</span>
			</button>
		{:else}
			<p class="empty">{t('shell.desk.nothingPending')}</p>
		{/each}
		<div class="closed"><DeskClosed /></div>
	</section>

	<section>
		<div class="head"><span>{t('shell.schedule.title')}</span></div>
		{#if outdated}
			<p class="empty">{t('shell.schedule.outdated')}</p>
		{:else}
			{#each daemon.schedules as s (s.id)}
				<div class="row static">
					<ClockIcon size={16} />
					<span class="text">
						<span class="title">{s.name}</span>
						<span
							class="meta"
							class:failed={s.last_run?.status === 'failed'}
							class:waiting={s.last_run?.status === 'waiting'}>{summary(s)} · {status(s)}</span
						>
					</span>
					<button class="run" title={t('shell.schedule.runNow')} disabled={starting[s.id] || !s.cwd} onclick={() => run(s)}><PlayIcon size={16} /></button>
					<Switch checked={s.enabled} label={t('shell.schedule.enabled')} onChange={(on) => act(() => daemon.setScheduleEnabled(s.id, on))} />
				</div>
			{:else}
				<p class="empty">{t('shell.schedule.empty')}</p>
			{/each}
			{#if error}<p class="empty failed">{error}</p>{/if}
		{/if}
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
		border-radius: var(--r);
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
		border-radius: var(--r);
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
	.closed {
		padding: 0 12px;
	}
	.empty {
		margin: 0;
		padding: 4px 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.run {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.run:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.failed {
		color: var(--err);
	}
	.waiting {
		color: var(--warn);
	}
	.notify-wrap {
		padding: 0 12px;
	}
</style>
