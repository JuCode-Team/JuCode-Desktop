<script lang="ts">
	import ContextRing from '$lib/ContextRing.svelte';
	import { t } from '$lib/i18n';
	import { fmtDur } from '$lib/turnStats';
	import { costText, type BillingCost } from '$lib/sessionCost';
	import type { ContextBreakdown } from '$lib/chat.svelte';
	import { breakdownRows, categoryKey } from './contextBreakdown';

	let {
		pct,
		atThreshold = false,
		contextTokens,
		contextLimit,
		totalIn,
		totalOut,
		cost,
		billing = null,
		billingError = '',
		runMs = 0,
		breakdown = null,
		onBreakdown
	}: {
		pct: number;
		// True only when contextLimit is the engine's real auto-compaction threshold
		// (jucode). Otherwise we're gauging against the raw window → "context used".
		atThreshold?: boolean;
		contextTokens: number;
		contextLimit: number;
		totalIn: number;
		totalOut: number;
		cost: number;
		billing?: BillingCost | null;
		billingError?: string;
		/** The session's total running time (sum of its turns), ms. */
		runMs?: number;
		/** What the context holds by category, as last asked; null before. */
		breakdown?: ContextBreakdown | null;
		/** Asks the engine for it (engines that can say); absent: total only. */
		onBreakdown?: () => void;
	} = $props();

	// Asked again on hover, at most every few seconds.
	let askedAt = 0;
	function ask() {
		if (!onBreakdown || Date.now() - askedAt < 5000) return;
		askedAt = Date.now();
		onBreakdown();
	}
	const counted = $derived(breakdown && 'total' in breakdown ? breakdown : null);
	const rows = $derived(counted ? breakdownRows(counted) : null);
	const label = (name: string) => {
		const key = categoryKey(name);
		return key ? t(`chat.contextCat.${key}`) : name;
	};
	const base = (path: string) => path.split(/[\\/]/).pop() || path;

	const fmtTokens = (n: number) =>
		n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
</script>

<!-- Laid out like the plan-quota panel in the model menu: dim labels, plain
     tabular figures, a thin track. -->
<!-- svelte-ignore a11y_no_static_element_interactions (hover only asks for figures) -->
<div class="ctxwrap" onmouseenter={ask}>
	<ContextRing {pct} />
	<span class="ctx-text">{fmtTokens(contextTokens)} / {fmtTokens(contextLimit)}</span>
	<div class="ctx-pop">
		<div class="ctx-head">
			<span class="ctx-label">{t('chat.context')}</span>
			<span class="ctx-num">{fmtTokens(contextTokens)} / {fmtTokens(contextLimit)}</span>
		</div>
		{#if !rows}<div class="ctx-track"><span class="ctx-fill" class:warn={pct >= 75} class:full={pct >= 90} style:width="{Math.min(100, pct)}%"></span></div>{/if}
		<div class="ctx-sub">{atThreshold ? t('chat.toCompaction', { pct }) : t('chat.contextUsed', { pct })}</div>
		{#if onBreakdown}
			{#if rows}
				<!-- Each category's share of the window; the room kept for compaction hatched. -->
				<div class="bk-bar">
					{#each rows.used as r (r.name)}<span class="bk-seg" style:--hue={r.hue} style:width="{r.pct}%"></span>{/each}
					{#each rows.room as r (r.name)}{#if r.kind === 'buffer'}<span class="bk-seg buffer" style:width="{r.pct}%"></span>{/if}{/each}
				</div>
				<div class="bk-list">
					{#each rows.used as r (r.name)}
						<div class="bk-row"><span class="bk-dot" style:--hue={r.hue}></span><span class="bk-name">{label(r.name)}</span><span class="ctx-num">{fmtTokens(r.tokens)}</span><span class="bk-pct">{r.pct}%</span></div>
					{/each}
					{#each rows.deferred as r (r.name)}
						<div class="bk-row dim" title={t('chat.contextDeferredHint')}><span class="bk-dot hollow"></span><span class="bk-name">{label(r.name)}</span><span class="ctx-num">{fmtTokens(r.tokens)}</span><span class="bk-pct"></span></div>
					{/each}
					{#each rows.room as r (r.name)}
						<div class="bk-row dim"><span class="bk-dot {r.kind}"></span><span class="bk-name">{label(r.name)}</span><span class="ctx-num">{fmtTokens(r.tokens)}</span><span class="bk-pct">{r.pct}%</span></div>
					{/each}
				</div>
				{#if counted?.memoryFiles.length}
					<div class="ctx-cap bk-cap">{t('chat.contextFiles')}</div>
					{#each counted.memoryFiles.slice(0, 6) as f (f.path)}
						<div class="ctx-row" title={f.path}><span class="bk-file">{base(f.path)}</span><span class="ctx-num">{fmtTokens(f.tokens)}</span></div>
					{/each}
				{/if}
			{:else if !breakdown}
				<div class="ctx-sub bk-wait">{t('chat.contextLoading')}</div>
			{/if}
		{/if}
		{#if totalIn || totalOut || cost > 0 || billing || billingError || runMs > 0}
			<div class="ctx-stats">
				{#if totalIn || totalOut}
					<div class="ctx-cap">{t('chat.sessionUsage')}</div>
					<div class="ctx-row"><span>{t('chat.sessionIn')}</span><span class="ctx-num">{fmtTokens(totalIn)}</span></div>
					<div class="ctx-row"><span>{t('chat.sessionOut')}</span><span class="ctx-num">{fmtTokens(totalOut)}</span></div>
				{/if}
				{#if cost > 0 || billing}<div class="ctx-row" title={billing ? t('chat.costSettledHint') : undefined}><span>{t('chat.cost')}</span><span class="ctx-num">{costText(cost, billing)}</span></div>{/if}
				{#if billingError}<div class="ctx-sub">{t('chat.costError', { error: billingError })}</div>{/if}
				{#if runMs > 0}<div class="ctx-row"><span>{t('chat.sessionRun')}</span><span class="ctx-num">{fmtDur(runMs)}</span></div>{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* The ring and the count together are the hover target. */
	.ctxwrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: var(--r-xs);
		cursor: default;
	}
	.ctx-text {
		color: var(--dim);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	.ctx-pop {
		position: absolute;
		bottom: calc(100% + 10px);
		right: 0;
		z-index: 21;
		display: flex;
		flex-direction: column;
		width: 300px;
		max-width: calc(100vw - 32px);
		padding: 10px 12px 12px;
		background: var(--panel);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-pop);
		opacity: 0;
		transform: translateY(4px) scale(0.97);
		transform-origin: bottom right;
		pointer-events: none;
		transition: opacity var(--t-med) var(--ease-out), transform var(--t-med) var(--ease-spring);
	}
	.ctxwrap:hover .ctx-pop {
		opacity: 1;
		transform: none;
	}
	.ctx-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: var(--fs-sm);
	}
	.ctx-label {
		flex: 1;
		color: var(--dim2);
	}
	.ctx-num {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.ctx-head .ctx-num {
		font-size: var(--fs-xs);
	}
	.ctx-track {
		height: 4px;
		margin: 8px 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.ctx-fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--t-slow) var(--ease-out), background var(--t-med) var(--ease-out);
	}
	.ctx-fill.warn {
		background: var(--warn);
	}
	.ctx-fill.full {
		background: var(--err);
	}
	.ctx-sub {
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	/* The breakdown: a bar of shares, then one row per category. Category
	   colours step around the brand hue in oklch; the room kept for
	   compaction is hatched, free space is the bare track. */
	.bk-bar {
		display: flex;
		height: 8px;
		margin: 8px 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.bk-seg,
	.bk-dot {
		background: var(--dim);
		background: oklch(from var(--brand) calc(l + 0.08 - var(--hue) * 0.05) calc(c * 0.8) calc(h - 40 + var(--hue) * 24));
	}
	.bk-seg {
		flex: none;
		min-width: 2px;
		height: 100%;
	}
	.bk-seg + .bk-seg {
		box-shadow: inset 1px 0 0 var(--panel);
	}
	.bk-seg.buffer,
	.bk-dot.buffer {
		background: repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 4px);
	}
	.bk-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.bk-row {
		display: grid;
		grid-template-columns: 8px 1fr auto 40px;
		align-items: center;
		gap: 8px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.bk-row.dim {
		color: var(--dim2);
	}
	.bk-dot {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.bk-dot.hollow,
	.bk-dot.free {
		background: none;
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.bk-name,
	.bk-file {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bk-pct {
		text-align: right;
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim2);
	}
	.bk-cap {
		margin: 8px 0 2px;
	}
	.bk-wait {
		margin-top: 6px;
	}
	.ctx-stats {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--hairline);
	}
	.ctx-cap {
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.ctx-row > span:first-child {
		flex-shrink: 0;
	}
	.ctx-row .ctx-num {
		text-align: right;
	}
	.ctx-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
</style>
