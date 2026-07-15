<script lang="ts">
	import ContextRing from '$lib/ContextRing.svelte';
	import { t } from '$lib/i18n';

	let {
		pct,
		atThreshold = false,
		contextTokens,
		contextLimit,
		totalIn,
		totalOut,
		cost
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
	} = $props();

	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
</script>

<div class="ctxwrap">
	<ContextRing {pct} label="" />
	<div class="ctx-pop">
		<div class="ctx-row"><span>{t('chat.context')}</span><span class="ctx-val">{fmtTokens(contextTokens)} / {fmtTokens(contextLimit)}</span></div>
		<div class="ctx-bar"><span class="ctx-fill" class:warn={pct >= 85} style:width="{pct}%"></span></div>
		<div class="ctx-sub">{atThreshold ? t('chat.toCompaction', { pct }) : t('chat.contextUsed', { pct })}</div>
		{#if totalIn || totalOut}<div class="ctx-row mt"><span>{t('chat.sessionUsage')}</span><span class="ctx-val">↑{fmtTokens(totalIn)} ↓{fmtTokens(totalOut)}</span></div>{/if}
		{#if cost > 0}<div class="ctx-row"><span>{t('chat.cost')}</span><span class="ctx-val">${cost.toFixed(3)}</span></div>{/if}
	</div>
</div>

<style>
	.ctxwrap {
		position: relative;
		display: inline-flex;
	}
	.ctx-pop {
		position: absolute;
		bottom: calc(100% + 10px);
		right: 0;
		z-index: 21;
		width: 200px;
		padding: 11px 12px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
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
	.ctx-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
		color: var(--dim);
	}
	.ctx-row.mt {
		margin-top: 9px;
	}
	.ctx-val {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.ctx-bar {
		height: 5px;
		border-radius: 999px;
		background: var(--surface2);
		overflow: hidden;
		margin: 7px 0 4px;
	}
	.ctx-fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--accent);
		transition: width var(--t-slow) var(--ease-out), background var(--t-med) var(--ease-out);
	}
	.ctx-fill.warn {
		background: var(--warn);
	}
	.ctx-sub {
		font-size: 11px;
		color: var(--dim2);
	}
</style>
