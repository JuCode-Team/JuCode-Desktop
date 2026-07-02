<script lang="ts">
	import { getDailyUsage, dayKey, fmtTokens } from './usageStats';
	import { t } from '$lib/i18n';

	// 单元格与间距（px），CSS 通过 style 上的自定义属性取同一份值
	const CELL = 13;
	const GAP = 4;
	const WDAY_W = 22;

	let { maxWeeks = 52 }: { maxWeeks?: number } = $props();

	interface Cell {
		key: string;
		total: number;
		in: number;
		out: number;
		level: number;
		future: boolean;
	}

	const usage = getDailyUsage();

	let containerW = $state(0);
	// 按容器宽度自适应周数：始终完整显示，不横向滚动
	const weekCount = $derived(
		Math.max(0, Math.min(maxWeeks, Math.floor((containerW - WDAY_W) / (CELL + GAP))))
	);

	const grid = $derived.by(() => {
		const weeks = weekCount;
		// 网格以周一为每列首行，最后一列包含今天
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const mondayOffset = (today.getDay() + 6) % 7;
		const gridStart = new Date(today);
		gridStart.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);

		const columns: Cell[][] = [];
		const monthLabels: { col: number; text: string }[] = [];
		let prevMonth = -1;
		for (let w = 0; w < weeks; w++) {
			const col: Cell[] = [];
			let colMonth = -1;
			for (let i = 0; i < 7; i++) {
				const date = new Date(gridStart);
				date.setDate(gridStart.getDate() + w * 7 + i);
				if (i === 0) colMonth = date.getMonth();
				const key = dayKey(date);
				const u = usage[key];
				const tin = u?.in ?? 0;
				const tout = u?.out ?? 0;
				col.push({ key, total: tin + tout, in: tin, out: tout, level: 0, future: date > today });
			}
			if (w > 0 && colMonth !== prevMonth && w < weeks - 1)
				monthLabels.push({ col: w, text: t('settings.overview.heatmap.month', { n: colMonth + 1 }) });
			prevMonth = colMonth;
			columns.push(col);
		}

		// 按非零日用量的四分位数划分 4 个色阶（GitHub 同款分级方式）
		const flat = columns.flat();
		const nonzero = flat
			.map((c) => c.total)
			.filter((v) => v > 0)
			.sort((a, b) => a - b);
		const q = (p: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 0;
		const t1 = q(0.25);
		const t2 = q(0.5);
		const t3 = q(0.75);
		for (const c of flat) {
			if (c.total <= 0) continue;
			c.level = c.total <= t1 ? 1 : c.total <= t2 ? 2 : c.total <= t3 ? 3 : 4;
		}

		return {
			columns,
			monthLabels,
			flat,
			sumIn: flat.reduce((s, c) => s + c.in, 0),
			sumOut: flat.reduce((s, c) => s + c.out, 0),
			activeDays: flat.filter((c) => c.total > 0).length
		};
	});

	let hovered = $state<Cell | null>(null);

	function onOver(e: PointerEvent) {
		const el = (e.target as HTMLElement).closest('[data-cell]');
		hovered = el ? (grid.flat[Number((el as HTMLElement).dataset.cell)] ?? null) : null;
	}

	const cellTitle = (c: Cell) =>
		c.total > 0
			? `${c.key} · ↑${fmtTokens(c.in)} ↓${fmtTokens(c.out)}`
			: `${c.key} · ${t('settings.overview.heatmap.noUsage')}`;

	const rangeLabel = $derived(
		weekCount >= 52
			? t('settings.overview.heatmap.year')
			: weekCount >= 4
				? t('settings.overview.heatmap.months', { n: Math.round((weekCount * 7) / 30) })
				: t('settings.overview.heatmap.recent')
	);
</script>

<div
	class="heatmap"
	bind:clientWidth={containerW}
	style="--cell: {CELL}px; --gap: {GAP}px; --wday: {WDAY_W}px"
>
	{#if weekCount > 0}
		<div class="months">
			{#each grid.monthLabels as m (m.col)}
				<span style:left={`calc(${m.col} * (var(--cell) + var(--gap)))`}>{m.text}</span>
			{/each}
		</div>
		<div class="body">
			<div class="wdays"><span>{t('settings.overview.heatmap.wdMon')}</span><span>{t('settings.overview.heatmap.wdWed')}</span><span>{t('settings.overview.heatmap.wdFri')}</span></div>
			<div
				class="grid"
				role="img"
				aria-label={t('settings.overview.heatmap.ariaLabel')}
				onpointerover={onOver}
				onpointerleave={() => (hovered = null)}
			>
				{#each grid.columns as col, w (w)}
					<div class="col">
						{#each col as c, i (c.key)}
							{#if c.future}
								<span class="cell empty"></span>
							{:else}
								<span class="cell l{c.level}" data-cell={w * 7 + i} title={cellTitle(c)}></span>
							{/if}
						{/each}
					</div>
				{/each}
			</div>
		</div>
		<div class="foot">
			{#if hovered}
				<span class="info">
					{hovered.key}
					{#if hovered.total > 0}
						· <span class="mono">↑{fmtTokens(hovered.in)} ↓{fmtTokens(hovered.out)}</span> · {t('settings.overview.total')}
						<span class="mono">{fmtTokens(hovered.total)}</span> tokens
					{:else}
						· {t('settings.overview.heatmap.noUsage')}
					{/if}
				</span>
			{:else if grid.activeDays > 0}
				<span class="info">
					{t('settings.overview.heatmap.activeDays', { range: rangeLabel, days: grid.activeDays })}
					<span class="mono">{fmtTokens(grid.sumIn + grid.sumOut)}</span> tokens (↑{fmtTokens(
						grid.sumIn
					)} ↓{fmtTokens(grid.sumOut)})
				</span>
			{:else}
				<span class="info">{t('settings.overview.heatmap.empty')}</span>
			{/if}
			<span class="legend">
				{t('settings.overview.heatmap.less')}
				<span class="cell l0"></span><span class="cell l1"></span><span class="cell l2"></span><span
					class="cell l3"
				></span><span class="cell l4"></span>
				{t('settings.overview.heatmap.more')}
			</span>
		</div>
	{/if}
</div>

<style>
	.heatmap {
		font-size: 11px;
		color: var(--dim);
	}
	.months {
		position: relative;
		height: 18px;
		margin-left: calc(var(--wday) + var(--gap));
	}
	.months span {
		position: absolute;
		top: 0;
		white-space: nowrap;
	}
	.body {
		display: flex;
		gap: var(--gap);
	}
	.wdays {
		display: grid;
		grid-template-rows: repeat(7, var(--cell));
		row-gap: var(--gap);
		width: var(--wday);
		text-align: right;
		line-height: var(--cell);
		flex-shrink: 0;
	}
	.wdays span:nth-child(1) {
		grid-row: 1;
	}
	.wdays span:nth-child(2) {
		grid-row: 3;
	}
	.wdays span:nth-child(3) {
		grid-row: 5;
	}
	.grid {
		display: flex;
		gap: var(--gap);
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
	}
	.cell {
		width: var(--cell);
		height: var(--cell);
		border-radius: 3px;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.cell.empty {
		visibility: hidden;
	}
	.cell.l1 {
		background: color-mix(in oklab, var(--accent) 28%, var(--surface2));
		box-shadow: none;
	}
	.cell.l2 {
		background: color-mix(in oklab, var(--accent) 55%, var(--surface2));
		box-shadow: none;
	}
	.cell.l3 {
		background: var(--accent);
		box-shadow: none;
	}
	.cell.l4 {
		background: var(--accent-bright);
		box-shadow: none;
	}
	.grid .cell:hover {
		outline: 1px solid var(--text);
		outline-offset: -1px;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
	}
	.foot .cell {
		width: 10px;
		height: 10px;
	}
	.info {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mono {
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
	}
</style>
