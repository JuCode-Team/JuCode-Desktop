<script lang="ts">
	import { t } from '$lib/i18n';
	import CallTimer from '$lib/CallTimer.svelte';
	import type { CallTiming } from '$lib/chat.svelte';

	// What a running turn is doing: one dot whose rhythm is the stage
	// (breathing while the model works, slower before it answers, blinking
	// while a tool runs), the stage, what it works on, and a timer.
	let {
		phase,
		tokens = 0,
		call = null,
		detail = '',
		since = 0
	}: {
		phase: string | null;
		tokens?: number;
		call?: CallTiming | null;
		/** What the stage works on (the tool running). */
		detail?: string;
		/** Time from here (the turn's start); else the model request's. */
		since?: number;
	} = $props();

	// While a model request is in flight its own stage (connecting, waiting for
	// the first token, streaming) replaces the coarser phase.
	const CALL_PHASE = { connect: 'connecting', ttft: 'firstToken', output: 'generating' } as const;
	const timed = $derived(call !== null && (phase === 'connecting' || phase === 'waiting' || phase === 'generating'));
	const shown = $derived(timed && call ? CALL_PHASE[call.phase] : phase);
	const from = $derived(since || (timed && call ? call.since : 0));

	const LABEL = $derived<Record<string, string>>({
		connecting: t('chat.phaseConnecting'),
		waiting: t('chat.phaseWaiting'),
		firstToken: t('chat.phaseFirstToken'),
		generating: t('chat.phaseGenerating'),
		tool: t('chat.phaseTool'),
		compacting: t('chat.phaseCompacting'),
		working: t('chat.phaseWorking')
	});
	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
</script>

{#if shown}
	<span class="ind">
		<span class="dot {shown}"></span>
		<span class="label">{LABEL[shown] ?? shown}</span>
		{#if detail}<span class="detail" title={detail}>{detail}</span>{/if}
		{#if shown === 'compacting' && tokens > 0}<span class="detail">{t('chat.tokens', { n: fmt(tokens) })}</span>{/if}
		{#if from}<CallTimer since={from} />{/if}
	</span>
{/if}

<style>
	.ind {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 4px 2px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.dot {
		width: 7px;
		height: 7px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--text);
		animation: breathe 1.4s ease-in-out infinite;
	}
	/* Before the model answers: slower. */
	.dot.connecting,
	.dot.waiting,
	.dot.firstToken {
		animation-duration: 2.2s;
	}
	.dot.tool {
		animation: blink 0.9s steps(2, jump-none) infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.3;
			transform: scale(0.75);
		}
	}
	@keyframes blink {
		50% {
			opacity: 0.35;
		}
	}
	.label {
		flex-shrink: 0;
		color: var(--text);
		font-weight: 500;
	}
	.detail {
		min-width: 0;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}
</style>
