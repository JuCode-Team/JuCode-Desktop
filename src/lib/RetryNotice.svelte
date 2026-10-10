<script lang="ts">
	// A model request that failed and is being re-sent: which attempt of how
	// many (one segment each), the countdown to it, and why the last one
	// failed, in words (errorInfo) with the provider's text folded under it.
	// Replaces the turn's phase indicator until output flows again.
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { describeError, stripEngineHint } from '$lib/errorInfo';
	import type { RetryState } from '$lib/chat.svelte';
	import { t } from '$lib/i18n';

	// `onNow` / `onCancel`: the app's own retry of a failed turn (autoRetry.ts),
	// which the user can bring forward or call off; the engine's has neither.
	let {
		retry,
		backend = '',
		onNow,
		onCancel
	}: { retry: RetryState; backend?: string; onNow?: () => void; onCancel?: () => void } = $props();

	let now = $state(Date.now());
	$effect(() => {
		void retry;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(timer);
	});
	const left = $derived(Math.max(0, Math.ceil((retry.at + retry.delayMs - now) / 1000)));

	const info = $derived(retry.reason ? describeError(retry.reason, backend) : null);
	const reason = $derived(
		info
			? t(`chat.err.${info.kind}.title`, { subject: info.subject ?? t('chat.err.thisTool') })
			: stripEngineHint(retry.reason).split('\n')[0]
	);
	let showRaw = $state(false);
</script>

<div class="retry" role="status">
	<div class="head">
		<span class="ico" class:spin={left === 0}><ArrowClockwiseIcon size={15} /></span>
		<span class="title">{t(onCancel ? 'chat.autoRetry.title' : 'chat.retry.title')}</span>
		<span class="count">{t('chat.retry.attempt', { n: retry.attempt, max: retry.max })}</span>
		<span class="when">{left > 0 ? t('chat.retry.in', { s: left }) : t('chat.retry.now')}</span>
		{#if onNow}<button class="act" onclick={onNow}>{t('chat.autoRetry.now')}</button>{/if}
		{#if onCancel}<button class="act" onclick={onCancel}>{t('chat.autoRetry.cancel')}</button>{/if}
	</div>
	{#if retry.max > 1}
		<div class="bar" aria-hidden="true">
			{#each Array.from({ length: retry.max }, (_, i) => i + 1) as n (n)}
				<span class:done={n < retry.attempt} class:now={n === retry.attempt}></span>
			{/each}
		</div>
	{/if}
	{#if retry.reason}
		<div class="why">
			<span class="label">{t('chat.retry.reason')}</span>
			<span class="text" title={stripEngineHint(retry.reason)}>{reason}</span>
			{#if info?.status}<span class="code">{info.status}</span>{/if}
			{#if info}
				<button class="raw-toggle" class:open={showRaw} onclick={() => (showRaw = !showRaw)}>
					<CaretRightIcon size={11} />{showRaw ? t('chat.err.hideRaw') : t('chat.err.raw')}
				</button>
			{/if}
		</div>
		{#if showRaw}<pre class="raw">{stripEngineHint(retry.reason)}</pre>{/if}
	{/if}
</div>

<style>
	.retry {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 6px 0 2px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--fs-sm);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.ico {
		display: inline-flex;
		color: var(--warn);
	}
	.ico.spin {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: var(--text);
	}
	.count,
	.when {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.when {
		margin-left: auto;
		font-size: var(--fs-xs);
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.act {
		flex: none;
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.act:hover {
		background: var(--surface2);
	}
	/* One segment per attempt: failed ones filled, the coming one pulsing. */
	.bar {
		display: flex;
		gap: 3px;
	}
	.bar span {
		flex: 1;
		height: 3px;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.bar span.done {
		background: var(--dim2);
	}
	.bar span.now {
		background: var(--text);
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	.why {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.label {
		flex: none;
		color: var(--dim2);
	}
	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.code {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.raw-toggle {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex: none;
		margin-left: auto;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		cursor: pointer;
	}
	.raw-toggle :global(svg) {
		transition: transform var(--t-fast) var(--ease-out);
	}
	.raw-toggle.open :global(svg) {
		transform: rotate(90deg);
	}
	.raw-toggle:hover {
		color: var(--text);
	}
	.raw {
		margin: 0;
		max-height: 140px;
		overflow: auto;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	@media (prefers-reduced-motion: reduce) {
		.ico.spin,
		.bar span.now {
			animation: none;
		}
	}
</style>
