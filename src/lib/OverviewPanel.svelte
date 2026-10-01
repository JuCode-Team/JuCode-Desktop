<script lang="ts">
	// Usage page: the coding agent's token usage over a chosen range — totals,
	// a daily bar chart (hover for the day's numbers) and the split by channel,
	// model, agent, device or project. "All devices" is the account's record of
	// every computer (cost from the JuCode gateway); "This computer" is the
	// daemon's, which also knows the project of each turn.
	import { onMount } from 'svelte';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import SettingsSection from '$lib/settings/SettingsSection.svelte';
	import { daemon, fetchAgentUsageSummary, fetchLocalUsage, type UsageSummary, type UsageTokens } from '$lib/protocol';
	import { dayRange, EMPTY_TOKENS, fmtTokens, groupChannels, importLegacyUsage, totalTokens } from '$lib/usageStats';
	import { isBackendId } from '$lib/backends';
	import { t } from '$lib/i18n';

	type Scope = 'all' | 'local';
	type Dim = 'channel' | 'model' | 'engine' | 'device' | 'project';

	let scope = $state<Scope>('all');
	/** The account's record is unreachable (not signed in): this computer only. */
	let cloudOff = $state(false);
	let range = $state('30');
	let dim = $state<Dim>('channel');
	let hover = $state<number | null>(null);
	let summary = $state<UsageSummary | null>(null);
	let error = $state('');
	let expanded = $state<Record<string, boolean>>({ jucode: true });
	let ready = $state(false);

	async function load(s: Scope, days: number) {
		error = '';
		try {
			const next = s === 'all' ? await fetchAgentUsageSummary(days) : await fetchLocalUsage(days);
			if (scope === s && Number(range) === days) summary = next;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (s === 'all' && /not logged in|sign in again|copied from another computer/i.test(msg)) {
				cloudOff = true;
				scope = 'local';
				return;
			}
			summary = null;
			error = t('settings.overview.loadFailed', { msg });
		}
	}

	onMount(async () => {
		// Older versions counted usage here; the daemon keeps it now.
		await importLegacyUsage((op) => daemon.request(op)).catch(() => {});
		ready = true;
	});
	$effect(() => {
		if (ready) void load(scope, Number(range));
	});
	$effect(() => {
		if ((scope === 'local' && dim === 'device') || (scope === 'all' && dim === 'project')) dim = 'channel';
	});

	const byDay = $derived(new Map((summary?.days ?? []).map((d) => [d.day, d])));
	const days = $derived(dayRange(Number(range)).map((key) => ({ key, u: byDay.get(key) ?? EMPTY_TOKENS })));
	const totals = $derived(summary?.totals ?? EMPTY_TOKENS);
	const active = $derived(days.filter((d) => totalTokens(d.u) > 0).length);
	const peak = $derived(Math.max(1, ...days.map((d) => totalTokens(d.u))));
	const hovered = $derived(hover === null ? null : days[hover]);
	const showCost = $derived(scope === 'all');

	const channels = $derived(groupChannels(summary?.by_channel ?? []));
	type Row = { key: string; label: string; usage: UsageTokens; icon: 'vendor' | 'model' | 'engine' | 'none'; title?: string };
	const rows = $derived.by((): Row[] => {
		const s = summary;
		if (!s) return [];
		const list: Row[] =
			dim === 'model'
				? s.by_model.map((r) => ({ key: r.model, label: r.model || t('settings.overview.other'), usage: r, icon: 'model' }))
				: dim === 'engine'
					? s.by_engine.map((r) => ({ key: r.engine, label: engineName(r.engine), usage: r, icon: 'engine' }))
					: dim === 'device'
						? (s.by_device ?? []).map((r) => ({ key: r.authorization_id ?? '', label: r.name || t('settings.overview.unknownDevice'), usage: r, icon: 'none' }))
						: (s.by_project ?? []).map((r) => ({
								key: r.cwd,
								label: r.cwd ? (r.cwd.split(/[\\/]/).filter(Boolean).pop() ?? r.cwd) : t('settings.overview.unknownProject'),
								title: r.cwd,
								usage: r,
								icon: 'none'
							}));
		return list.sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage));
	});
	const rowsTotal = $derived(totalTokens(totals) || 1);

	const ENGINE_NAMES: Record<string, string> = { jucode: 'JuCode', claude: 'Claude Code', codex: 'Codex', acp: 'ACP' };
	const engineName = (key: string) => ENGINE_NAMES[key] ?? key;
	const KIND_KEYS: Record<string, string> = {
		jucode: 'settings.overview.kindJucode',
		third_party: 'settings.overview.kindThirdParty',
		local: 'settings.overview.kindLocal',
		legacy: 'settings.overview.kindLegacy'
	};
	const pct = (n: number) => `${Math.round((n / rowsTotal) * 1000) / 10}%`;
	const fmtCost = (v?: string) => {
		const n = Number(v ?? 0);
		return n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2);
	};
	const shortDate = (key: string) => {
		const [, m, d] = key.split('-');
		return t('settings.overview.date', { m: Number(m), d: Number(d) });
	};
	const RANGES = $derived([
		{ value: '7', label: t('settings.overview.range', { n: 7 }) },
		{ value: '30', label: t('settings.overview.range', { n: 30 }) },
		{ value: '90', label: t('settings.overview.range', { n: 90 }) }
	]);
	const SCOPES = $derived([
		{ value: 'all', label: t('settings.overview.scopeAll') },
		{ value: 'local', label: t('settings.overview.scopeLocal') }
	]);
	const DIMS = $derived([
		{ value: 'channel', label: t('settings.overview.dimProvider') },
		{ value: 'model', label: t('settings.overview.dimModel') },
		{ value: 'engine', label: t('settings.overview.dimAgent') },
		scope === 'all' ? { value: 'device', label: t('settings.overview.dimDevice') } : { value: 'project', label: t('settings.overview.dimProject') }
	]);
</script>

{#snippet cells(u: UsageTokens)}
	<span class="share">
		<span class="track"><span class="fill" style:width={pct(totalTokens(u))}></span></span>
		<span class="p">{pct(totalTokens(u))}</span>
	</span>
	<span class="n">{fmtTokens(u.input_tokens)}</span>
	<span class="n">{fmtTokens(u.output_tokens)}</span>
	<span class="n strong">{fmtTokens(totalTokens(u))}</span>
	{#if showCost}<span class="n">{fmtCost(u.cost)}</span>{/if}
{/snippet}

<div class="bar">
	{#if !cloudOff}
		<Segmented value={scope} options={SCOPES} onChange={(v) => ((scope = v as Scope), (hover = null))} />
	{/if}
	<Segmented value={range} options={RANGES} onChange={(v) => ((range = v), (hover = null))} />
</div>

{#if error}<div class="err"><Notice>{error}</Notice></div>{/if}
{#if cloudOff}<p class="note">{t('settings.overview.cloudNeedsLogin')}</p>{/if}

<SettingsSection
	id="usage-daily"
	title={t('settings.overview.summaryTitle')}
	description={scope === 'all' ? t('settings.overview.allHint') : t('settings.overview.localHint')}
>
	<div class="stats">
		<div class="stat">
			<span class="label">{t('settings.overview.total')}</span>
			<span class="num">{fmtTokens(totalTokens(totals))}</span>
			<span class="sub">{t('settings.overview.perActiveDay', { n: fmtTokens(active ? Math.round(totalTokens(totals) / active) : 0) })}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.input')}</span>
			<span class="num">{fmtTokens(totals.input_tokens)}</span>
			<span class="sub">{t('settings.overview.cachedOf', { n: fmtTokens(totals.cached_input_tokens) })}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.output')}</span>
			<span class="num">{fmtTokens(totals.output_tokens)}</span>
			<span class="sub">{t('settings.overview.turns', { n: totals.turns })}</span>
		</div>
		<div class="stat">
			{#if showCost}
				<span class="label">{t('settings.overview.cost')}</span>
				<span class="num">{fmtCost(totals.cost)}</span>
				<span class="sub">{t('settings.overview.costHint')}</span>
			{:else}
				<span class="label">{t('settings.overview.activeDays')}</span>
				<span class="num">{active}<span class="of">/{days.length}</span></span>
			{/if}
		</div>
	</div>
	<div class="chart" role="img" aria-label={t('settings.overview.chartLabel')} onpointerleave={() => (hover = null)}>
		<div class="tipline">
			{#if hovered}
				<span class="tdate">{shortDate(hovered.key)}</span>
				<span>{t('settings.overview.input')} {fmtTokens(hovered.u.input_tokens)}</span>
				<span>{t('settings.overview.output')} {fmtTokens(hovered.u.output_tokens)}</span>
				{#if showCost}<span>{t('settings.overview.cost')} {fmtCost(hovered.u.cost)}</span>{/if}
				<span class="ttotal">{fmtTokens(totalTokens(hovered.u))}</span>
			{:else}
				<span class="dim">{t('settings.overview.peak', { n: fmtTokens(peak === 1 ? 0 : peak) })}</span>
			{/if}
		</div>
		<div class="bars" style:--gap="{days.length > 45 ? 2 : 4}px">
			{#each days as x, i (x.key)}
				{@const v = totalTokens(x.u)}
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
		<Segmented value={dim} options={DIMS} onChange={(v) => (dim = v as Dim)} />
	{/snippet}
	{#if dim === 'channel' ? channels.length : rows.length}
		<div class="table" class:cost={showCost}>
			<div class="tr th">
				<span class="name">{t('settings.overview.colName')}</span>
				<span class="share">{t('settings.overview.colShare')}</span>
				<span class="n">{t('settings.overview.input')}</span>
				<span class="n">{t('settings.overview.output')}</span>
				<span class="n">{t('settings.overview.total')}</span>
				{#if showCost}<span class="n">{t('settings.overview.cost')}</span>{/if}
			</div>
			{#if dim === 'channel'}
				{#each channels as g (g.kind)}
					<button class="tr group" aria-expanded={!!expanded[g.kind]} onclick={() => (expanded[g.kind] = !expanded[g.kind])}>
						<span class="name">
							<span class="ico caret" class:open={expanded[g.kind]}><CaretRightIcon size={12} /></span>
							<span class="nm">{t(KIND_KEYS[g.kind])}</span>
						</span>
						{@render cells(g.usage)}
					</button>
					{#if expanded[g.kind]}
						{#each g.rows as r (r.key)}
							<div class="tr sub">
								<span class="name">
									<span class="ico">{#if g.kind !== 'jucode'}<Vendor provider={r.key} size={16} />{/if}</span>
									<span class="nm">{g.kind === 'jucode' ? r.key || t('settings.overview.defaultGroup') : r.key}</span>
								</span>
								{@render cells(r.usage)}
							</div>
						{/each}
					{/if}
				{/each}
			{:else}
				{#each rows as r (r.key)}
					<div class="tr">
						<span class="name" title={r.title}>
							<span class="ico">
								{#if r.icon === 'model'}<Vendor model={r.key} size={16} />
								{:else if r.icon === 'engine' && isBackendId(r.key)}<BackendIcon backend={r.key as never} size={16} />{/if}
							</span>
							<span class="nm">{r.label}</span>
						</span>
						{@render cells(r.usage)}
					</div>
				{/each}
			{/if}
		</div>
	{:else}
		<p class="empty">{t('settings.overview.noData')}</p>
	{/if}
</SettingsSection>

<style>
	.bar {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: -44px;
	}
	.err,
	.note {
		margin: 12px 0 0;
	}
	.note {
		color: var(--dim);
		font-size: var(--fs-sm);
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
	.table.cost .tr {
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.1fr) 72px 72px 80px 72px;
	}
	.tr + .tr {
		border-top: 1px solid var(--hairline);
	}
	button.tr {
		width: 100%;
		border: 0;
		border-top: 1px solid var(--hairline);
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	button.tr:hover {
		background: var(--surface2);
	}
	.tr.sub {
		min-height: 40px;
	}
	.tr.sub .name {
		padding-left: 26px;
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
	.caret {
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
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
	.group .nm {
		font-weight: 500;
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
