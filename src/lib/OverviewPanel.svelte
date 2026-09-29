<script lang="ts">
	// Usage page: local token usage over a chosen range — totals, a daily bar
	// chart (hover for the day's numbers) and the split by provider, model or
	// agent. Data comes from usageStats (engine usage events, kept per day).
	import Segmented from '$lib/ui/Segmented.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import SettingsSection from '$lib/settings/SettingsSection.svelte';
	import { getDailyUsage, fmtTokens, sumDimension, collectAgentLabels, dayKey, type DayUsage, type UsageDimension } from '$lib/usageStats';
	import { isBackendId } from '$lib/backends';
	import { t } from '$lib/i18n';

	const usage = getDailyUsage();

	let range = $state('30');
	let dim = $state<UsageDimension>('prov');
	let hover = $state<number | null>(null);

	// Every day of the range, oldest first, zero-filled so the chart has no gaps.
	const days = $derived.by(() => {
		const n = Number(range);
		const out: { key: string; d: DayUsage }[] = [];
		const today = new Date();
		for (let i = n - 1; i >= 0; i--) {
			const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
			const key = dayKey(dt);
			out.push({ key, d: usage[key] ?? { in: 0, out: 0 } });
		}
		return out;
	});
	const values = $derived(days.map((x) => x.d));
	const totalIn = $derived(values.reduce((s, d) => s + d.in, 0));
	const totalOut = $derived(values.reduce((s, d) => s + d.out, 0));
	const active = $derived(values.filter((d) => d.in + d.out > 0).length);
	const peak = $derived(Math.max(1, ...values.map((d) => d.in + d.out)));

	const agentLabels = $derived(collectAgentLabels(values));
	const AGENT_NAMES: Record<string, string> = { jucode: 'JuCode', claude: 'Claude', codex: 'Codex', acp: 'ACP' };
	function keyName(key: string): string {
		if (key === 'other') return t('settings.overview.other');
		if (dim === 'agents') {
			if (AGENT_NAMES[key]) return AGENT_NAMES[key];
			if (key.startsWith('acp:')) return agentLabels[key] ?? key.slice(4);
		}
		return key;
	}
	const rows = $derived(sumDimension(values, dim));
	const rowsTotal = $derived(rows.reduce((s, [, u]) => s + u.in + u.out, 0) || 1);

	const pct = (n: number) => `${Math.round((n / rowsTotal) * 1000) / 10}%`;
	const shortDate = (key: string) => {
		const [, m, d] = key.split('-');
		return t('settings.overview.date', { m: Number(m), d: Number(d) });
	};
	const RANGES = $derived([
		{ value: '7', label: t('settings.overview.range', { n: 7 }) },
		{ value: '30', label: t('settings.overview.range', { n: 30 }) },
		{ value: '90', label: t('settings.overview.range', { n: 90 }) }
	]);
	const hovered = $derived(hover === null ? null : days[hover]);
</script>

<div class="bar">
	<Segmented value={range} options={RANGES} onChange={(v) => ((range = v), (hover = null))} />
</div>

<SettingsSection id="usage-daily" title={t('settings.overview.summaryTitle')} description={t('settings.overview.dailyHint')}>
	<div class="stats">
		<div class="stat">
			<span class="label">{t('settings.overview.total')}</span>
			<span class="num">{fmtTokens(totalIn + totalOut)}</span>
			<span class="sub">{t('settings.overview.perActiveDay', { n: fmtTokens(active ? Math.round((totalIn + totalOut) / active) : 0) })}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.input')}</span>
			<span class="num">{fmtTokens(totalIn)}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.output')}</span>
			<span class="num">{fmtTokens(totalOut)}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.activeDays')}</span>
			<span class="num">{active}<span class="of">/{days.length}</span></span>
		</div>
	</div>
	<div class="chart" role="img" aria-label={t('settings.overview.chartLabel')} onpointerleave={() => (hover = null)}>
		<div class="tipline">
			{#if hovered}
				<span class="tdate">{shortDate(hovered.key)}</span>
				<span>{t('settings.overview.input')} {fmtTokens(hovered.d.in)}</span>
				<span>{t('settings.overview.output')} {fmtTokens(hovered.d.out)}</span>
				<span class="ttotal">{fmtTokens(hovered.d.in + hovered.d.out)}</span>
			{:else}
				<span class="dim">{t('settings.overview.peak', { n: fmtTokens(peak === 1 ? 0 : peak) })}</span>
			{/if}
		</div>
		<div class="bars" style:--gap="{days.length > 45 ? 2 : 4}px">
			{#each days as x, i (x.key)}
				{@const v = x.d.in + x.d.out}
				<div class="col" class:on={hover === i} role="presentation" onpointerenter={() => (hover = i)}>
					<div class="b" class:zero={v === 0} style:height="{v ? Math.max(3, (v / peak) * 100) : 0}%"></div>
				</div>
			{/each}
		</div>
		<div class="axis">
			<span>{shortDate(days[0].key)}</span>
			<span>{shortDate(days[Math.floor(days.length / 2)].key)}</span>
			<span>{t('settings.overview.today')}</span>
		</div>
	</div>
</SettingsSection>

<SettingsSection id="usage-detail" title={t('settings.overview.breakdownTitle')}>
	{#snippet action()}
		<Segmented
			value={dim}
			options={[
				{ value: 'prov', label: t('settings.overview.dimProvider') },
				{ value: 'models', label: t('settings.overview.dimModel') },
				{ value: 'agents', label: t('settings.overview.dimAgent') }
			]}
			onChange={(v) => (dim = v as UsageDimension)}
		/>
	{/snippet}
	{#if rows.length}
		<div class="table">
			<div class="tr th">
				<span class="name">{t('settings.overview.colName')}</span>
				<span class="share">{t('settings.overview.colShare')}</span>
				<span class="n">{t('settings.overview.input')}</span>
				<span class="n">{t('settings.overview.output')}</span>
				<span class="n">{t('settings.overview.total')}</span>
			</div>
			{#each rows as [key, u] (key)}
				<div class="tr">
					<span class="name">
						<span class="ico">
							{#if dim === 'prov'}<Vendor provider={key} size={16} />
							{:else if dim === 'models'}<Vendor model={key} size={16} />
							{:else if isBackendId(key.split(':')[0])}<BackendIcon backend={key.split(':')[0] as never} size={16} />{/if}
						</span>
						<span class="nm">{keyName(key)}</span>
					</span>
					<span class="share">
						<span class="track"><span class="fill" style:width={pct(u.in + u.out)}></span></span>
						<span class="p">{pct(u.in + u.out)}</span>
					</span>
					<span class="n">{fmtTokens(u.in)}</span>
					<span class="n">{fmtTokens(u.out)}</span>
					<span class="n strong">{fmtTokens(u.in + u.out)}</span>
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty">{t('settings.overview.noData')}</p>
	{/if}
</SettingsSection>

<style>
	.bar {
		display: flex;
		justify-content: flex-end;
		margin-top: -44px;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		border-bottom: 1px solid var(--hairline);
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 18px;
	}
	.stat + .stat {
		border-left: 1px solid var(--hairline);
	}
	.label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.num {
		color: var(--text);
		font-size: var(--fs-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.of {
		color: var(--dim2);
		font-size: var(--fs-sm);
		font-weight: 400;
	}
	.sub {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.chart {
		padding: 14px 18px 12px;
	}
	.tipline {
		display: flex;
		gap: 14px;
		height: 20px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.tdate,
	.ttotal {
		color: var(--text);
		font-weight: 500;
	}
	.ttotal {
		margin-left: auto;
	}
	.dim {
		color: var(--dim2);
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: var(--gap);
		height: 140px;
		margin-top: 8px;
	}
	.col {
		display: flex;
		flex: 1;
		align-items: flex-end;
		height: 100%;
		border-radius: var(--r-xs);
	}
	.col.on {
		background: var(--surface2);
	}
	.b {
		width: 100%;
		border-radius: var(--r-xs);
		background: var(--text);
		opacity: 0.78;
		transition:
			height var(--t-med) var(--ease-out),
			opacity var(--t-fast) var(--ease-out);
	}
	.col.on .b {
		opacity: 1;
	}
	.b.zero {
		height: 2px !important;
		background: var(--hairline);
		opacity: 1;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 8px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.table {
		display: flex;
		flex-direction: column;
	}
	.tr {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.4fr) 76px 76px 84px;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 0 18px;
		font-size: var(--fs-sm);
	}
	.tr + .tr {
		border-top: 1px solid var(--hairline);
	}
	.th {
		min-height: 38px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.ico {
		display: inline-flex;
		width: 16px;
		flex-shrink: 0;
		justify-content: center;
		color: var(--dim);
	}
	.th .name {
		padding-left: 26px;
	}
	.nm {
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.share {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.track {
		flex: 1;
		height: 6px;
		overflow: hidden;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: var(--r-full);
		background: var(--text);
		opacity: 0.7;
	}
	.p {
		width: 44px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.n {
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.n.strong {
		color: var(--text);
		font-weight: 500;
	}
	.empty {
		margin: 0;
		padding: 18px;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
</style>
