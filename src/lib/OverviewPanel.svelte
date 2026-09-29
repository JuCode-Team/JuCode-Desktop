<script lang="ts">
	import UsageHeatmap from '$lib/UsageHeatmap.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import {
		getDailyUsage,
		fmtTokens,
		sumDimension,
		collectAgentLabels,
		type UsageDimension
	} from '$lib/usageStats';
	import { t } from '$lib/i18n';
	import SettingsSection from '$lib/settings/SettingsSection.svelte';
	import SettingsRow from '$lib/settings/SettingsRow.svelte';

	const DETAIL_DAYS = 15;

	const usage = getDailyUsage();
	const days = Object.entries(usage)
		.filter(([, d]) => d.in + d.out > 0)
		.sort((a, b) => (a[0] < b[0] ? 1 : -1))
		.slice(0, DETAIL_DAYS);
	const dayValues = days.map(([, d]) => d);
	// days is newest-first; merge oldest-first so the latest ACP name wins.
	const agentLabels = collectAgentLabels([...dayValues].reverse());

	let dim = $state<UsageDimension>('prov');

	// 稳定 agent key → 展示名；acp:<id> 用记录到的名称，缺失时退回 id。
	const AGENT_NAMES: Record<string, string> = {
		jucode: 'JuCode',
		claude: 'Claude',
		codex: 'Codex',
		acp: 'ACP'
	};

	function keyName(key: string): string {
		if (key === 'other') return t('settings.overview.other');
		if (dim === 'agents') {
			if (AGENT_NAMES[key]) return AGENT_NAMES[key];
			if (key.startsWith('acp:')) return agentLabels[key] ?? key.slice(4);
		}
		return key;
	}

	const emptyKey = $derived(
		dim === 'prov'
			? 'settings.overview.noProvDetail'
			: dim === 'models'
				? 'settings.overview.noModelDetail'
				: 'settings.overview.noAgentDetail'
	);

	const windowRows = $derived(sumDimension(dayValues, dim));
	const windowMax = $derived(windowRows.length ? windowRows[0][1].in + windowRows[0][1].out : 0);
</script>

<SettingsSection id="usage-daily" title={t('settings.overview.dailyTitle')} description={t('settings.overview.dailyHint')}>
	<SettingsRow stacked>
		<UsageHeatmap />
	</SettingsRow>
</SettingsSection>

<SettingsSection title={t('settings.overview.detail')}>
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
	{#if days.length === 0}
		<SettingsRow description={t('settings.overview.noData')} />
	{:else}
		{#if windowRows.length > 0}
			<div class="win">
				<div class="wtitle">{t('settings.overview.windowTotal', { n: DETAIL_DAYS })}</div>
				{#each windowRows as [k, v] (k)}
					<div class="wrow">
						<span class="wname" title={k}>{keyName(k)}</span>
						<span class="wbar">
							<span
								class="wfill"
								style:width={`${windowMax ? Math.max(1, ((v.in + v.out) / windowMax) * 100) : 0}%`}
							></span>
						</span>
						<span class="wval mono">↑{fmtTokens(v.in)} ↓{fmtTokens(v.out)} · {fmtTokens(v.in + v.out)}</span>
					</div>
				{/each}
			</div>
		{/if}
		{#each days as [date, d] (date)}
			{@const rows = sumDimension([d], dim)}
			<div class="drow">
				<span class="dd mono">{date}</span>
				<span class="dt mono">↑{fmtTokens(d.in)} ↓{fmtTokens(d.out)} · {t('settings.overview.total')} {fmtTokens(d.in + d.out)}</span>
				<span class="dp">
					{#if rows.length > 0}
						{#each rows as [k, v] (k)}
							<span class="chip" title={k}>{keyName(k)} <b class="mono">↑{fmtTokens(v.in)} ↓{fmtTokens(v.out)}</b></span>
						{/each}
					{:else}
						<span class="chip dimmed">{t(emptyKey)}</span>
					{/if}
				</span>
			</div>
		{/each}
	{/if}
</SettingsSection>

<style>
	.win {
		padding: 14px 18px;
	}
	.wtitle {
		font-size: var(--fs-2xs);
		font-weight: 600;
		color: var(--dim2);
		margin-bottom: 8px;
	}
	.wrow {
		display: grid;
		grid-template-columns: minmax(60px, 160px) 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 3px 0;
	}
	.wname {
		font-size: var(--fs-xs);
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wbar {
		height: 6px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		overflow: hidden;
	}
	.wfill {
		display: block;
		height: 100%;
		border-radius: var(--r-xs);
		background: var(--accent);
	}
	.wval {
		font-size: var(--fs-2xs);
		color: var(--dim);
		white-space: nowrap;
	}
	.drow {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 4px 10px;
		align-items: baseline;
		padding: 12px 18px;
	}
	.dd {
		color: var(--text);
		font-weight: 500;
		font-size: var(--fs-sm);
	}
	.dt {
		color: var(--dim);
		font-size: var(--fs-xs);
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
		border-radius: var(--r-full);
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: var(--fs-2xs);
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
