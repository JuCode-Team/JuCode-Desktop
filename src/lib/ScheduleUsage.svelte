<script lang="ts">
	// What a scheduled task's runs cost, one row per run session.
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { daemonState } from '$lib/daemonState.svelte';
	import { usageCost, type ScheduleUsage, type ScheduleUsageTotals } from '$lib/schedules';
	import { fmtTokens } from '$lib/usageStats';
	import { t } from '$lib/i18n';

	let { schedule, onOpenSession }: {
		schedule: string;
		onOpenSession: (session: string) => void;
	} = $props();
	let data = $state<ScheduleUsage | null>(null);
	let loading = $state(false);
	let error = $state('');
	let refresh = $state(0);
	/** Read again when a run starts or ends. */
	const run = $derived(daemonState.schedules.find((s) => s.id === schedule)?.last_run);

	$effect(() => {
		void refresh;
		void run?.session;
		void run?.status;
		const id = schedule;
		let stale = false;
		loading = true;
		error = '';
		daemonState.scheduleUsage(id).then(
			(next) => { if (!stale) data = next; },
			(e) => { if (!stale) error = e instanceof Error ? e.message : String(e); }
		).finally(() => { if (!stale) loading = false; });
		return () => { stale = true; };
	});

	const sessions = $derived([...(data?.sessions ?? [])].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0)));
	const when = (at: number | null) => at === null ? t('shell.schedule.olderRun') : new Date(at).toLocaleString();
</script>

{#snippet costs(u: ScheduleUsageTotals)}
	<span>{usageCost(u)}</span>
	{#if u.pending_requests}<small>{t('shell.schedule.pendingCost', { n: u.pending_requests })}</small>{/if}
	{#if u.unpriced_requests}<small>{t('shell.schedule.unknownCost', { n: u.unpriced_requests })}</small>{/if}
	{#if u.running}<small>{t('shell.schedule.usageRunning')}</small>{/if}
{/snippet}

<div class="usage-head">
	<span>{t('shell.schedule.usageHint')}</span>
	<Button size="sm" variant="ghost" disabled={loading} onclick={() => refresh++}>{loading ? t('common.loading') : t('shell.schedule.refreshUsage')}</Button>
</div>
{#if error}<Notice>{error}</Notice>{/if}
{#if data}
	{#if data.billing_error}<Notice tone="warn">{t('shell.schedule.billingFailed', { error: data.billing_error })}</Notice>{/if}
	<div class="table-wrap">
		<table>
			<thead><tr><th>{t('shell.schedule.runSession')}</th><th>{t('shell.schedule.inputTokens')}</th><th>{t('shell.schedule.outputTokens')}</th><th>{t('shell.schedule.cost')}</th></tr></thead>
			<tbody>
				<tr class="total"><th>{t('shell.schedule.usageTotal')}</th><td>{fmtTokens(data.totals.input_tokens)}</td><td>{fmtTokens(data.totals.output_tokens)}</td><td>{@render costs(data.totals)}</td></tr>
				{#each sessions as row (row.session)}
					<tr>
						<td><button class="link" onclick={() => onOpenSession(row.session)}>{when(row.started_at)}</button></td>
						{#if row.turns}
							<td title={t('shell.schedule.cacheTokens', { read: row.cached_input_tokens, write: row.cache_write_tokens })}>{fmtTokens(row.input_tokens)}</td>
							<td>{fmtTokens(row.output_tokens)}</td><td>{@render costs(row)}</td>
						{:else}<td colspan="3">{t('shell.schedule.noUsage')}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.usage-head { display: flex; align-items: center; gap: 12px; justify-content: space-between; margin: 4px 0; }
	.usage-head > span { min-width: 0; }
	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: var(--fs-xs); text-align: left; }
	th, td { padding: 7px 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
	th { font-weight: 500; }
	td { font-variant-numeric: tabular-nums; }
	.total { color: var(--text); }
	small { display: block; font-size: var(--fs-2xs); color: var(--dim2); }
	.link { padding: 0; border: none; background: none; font: inherit; color: var(--accent-bright); cursor: pointer; text-align: left; }
	.link:hover { text-decoration: underline; }
</style>
