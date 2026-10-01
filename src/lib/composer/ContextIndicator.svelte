<script lang="ts">
	import ContextRing from '$lib/ContextRing.svelte';
	import { t } from '$lib/i18n';
	import { fmtDur } from '$lib/turnStats';

	let {
		pct,
		atThreshold = false,
		contextTokens,
		contextLimit,
		totalIn,
		totalOut,
		cost,
		runMs = 0
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
		/** The session's total running time (sum of its turns), ms. */
		runMs?: number;
	} = $props();

	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
</script>

<!-- Laid out like the plan-quota panel in the model menu: dim labels, plain
     tabular figures, a thin track. -->
<div class="ctxwrap">
	<ContextRing {pct} />
	<span class="ctx-text">{fmtTokens(contextTokens)} / {fmtTokens(contextLimit)}</span>
	<div class="ctx-pop">
		<div class="ctx-head">
			<span class="ctx-label">{t('chat.context')}</span>
			<span class="ctx-num">{fmtTokens(contextTokens)} / {fmtTokens(contextLimit)}</span>
		</div>
		<div class="ctx-track"><span class="ctx-fill" class:warn={pct >= 75} class:full={pct >= 90} style:width="{Math.min(100, pct)}%"></span></div>
		<div class="ctx-sub">{atThreshold ? t('chat.toCompaction', { pct }) : t('chat.contextUsed', { pct })}</div>
		{#if totalIn || totalOut || cost > 0 || runMs > 0}
			<div class="ctx-stats">
				{#if totalIn || totalOut}
					<div class="ctx-cap">{t('chat.sessionUsage')}</div>
					<div class="ctx-row"><span>{t('chat.sessionIn')}</span><span class="ctx-num">{fmtTokens(totalIn)}</span></div>
					<div class="ctx-row"><span>{t('chat.sessionOut')}</span><span class="ctx-num">{fmtTokens(totalOut)}</span></div>
				{/if}
				{#if cost > 0}<div class="ctx-row"><span>{t('chat.cost')}</span><span class="ctx-num">${cost.toFixed(3)}</span></div>{/if}
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
		width: 220px;
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
	.ctx-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
</style>
