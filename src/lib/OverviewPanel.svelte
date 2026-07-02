<script lang="ts">
	import { CalendarDays, Activity } from 'lucide-svelte';
	import UsageHeatmap from '$lib/UsageHeatmap.svelte';
	import { getDailyUsage, fmtTokens } from '$lib/usageStats';
	import { t } from '$lib/i18n';

	const DETAIL_DAYS = 15;

	const usage = getDailyUsage();
	const days = Object.entries(usage)
		.filter(([, d]) => d.in + d.out > 0)
		.sort((a, b) => (a[0] < b[0] ? 1 : -1))
		.slice(0, DETAIL_DAYS);

	const provName = (p: string) => (p === 'other' ? t('settings.overview.other') : p);
	const provRows = (d: (typeof days)[number][1]) =>
		Object.entries(d.prov ?? {}).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));
</script>

<div class="group">
	<div class="glabel"><CalendarDays size={13} /> {t('settings.overview.dailyTitle')}</div>
	<p class="hint">{t('settings.overview.dailyHint')}</p>
	<UsageHeatmap />

	<div class="detail">
		<div class="glabel"><Activity size={13} /> {t('settings.overview.detail')}</div>
		{#if days.length === 0}
			<p class="hint">{t('settings.overview.noData')}</p>
		{:else}
			{#each days as [date, d] (date)}
				<div class="drow">
					<span class="dd mono">{date}</span>
					<span class="dt mono">↑{fmtTokens(d.in)} ↓{fmtTokens(d.out)} · {t('settings.overview.total')} {fmtTokens(d.in + d.out)}</span>
					<span class="dp">
						{#if d.prov && Object.keys(d.prov).length > 0}
							{#each provRows(d) as [p, v] (p)}
								<span class="chip">{provName(p)} <b class="mono">↑{fmtTokens(v.in)} ↓{fmtTokens(v.out)}</b></span>
							{/each}
						{:else}
							<span class="chip dimmed">{t('settings.overview.noProvDetail')}</span>
						{/if}
					</span>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.group {
		margin-top: 22px;
	}
	.glabel {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--dim2);
		margin-bottom: 10px;
	}
	.hint {
		margin: 0 0 10px;
		font-size: 12px;
		color: var(--dim);
	}
	.detail {
		margin-top: 20px;
	}
	.drow {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 10px;
		align-items: baseline;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.dd {
		color: var(--text);
		font-weight: 500;
		font-size: 13px;
	}
	.dt {
		color: var(--dim);
		font-size: 12px;
		text-align: right;
	}
	.dp {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 11px;
		color: var(--dim);
	}
	.chip b {
		font-weight: 500;
		color: var(--text);
	}
	.chip.dimmed {
		color: var(--dim2);
	}
	.mono {
		font-variant-numeric: tabular-nums;
	}
</style>
