<script lang="ts">
	import { t } from '$lib/i18n';

	let { phase, tokens = 0 }: { phase: string | null; tokens?: number } = $props();

	const LABEL = $derived<Record<string, string>>({
		connecting: t('chat.phaseConnecting'),
		waiting: t('chat.phaseWaiting'),
		generating: t('chat.phaseGenerating'),
		tool: t('chat.phaseTool'),
		compacting: t('chat.phaseCompacting')
	});
	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
</script>

{#if phase}
	<div class="ind">
		{#if phase === 'generating'}
			<span class="glyph dots"><i></i><i></i><i></i></span>
		{:else if phase === 'waiting'}
			<span class="glyph breathe"></span>
		{:else if phase === 'connecting'}
			<span class="glyph ring"></span>
		{:else if phase === 'tool'}
			<span class="glyph scan"></span>
		{:else if phase === 'compacting'}
			<span class="glyph compress"><i></i><i></i></span>
		{/if}
		<span class="label">{LABEL[phase] ?? phase}</span>
		{#if phase === 'compacting' && tokens > 0}<span class="ctok">{t('chat.tokens', { n: fmt(tokens) })}</span>{/if}
	</div>
{/if}

<style>
	.ind {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 4px 2px;
		color: var(--dim);
		font-size: 12.5px;
	}
	.glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 14px;
		flex-shrink: 0;
	}
	.label {
		font-weight: 500;
	}
	.ctok {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 1px 8px;
	}

	/* generating — three dots bouncing in sequence */
	.dots {
		gap: 4px;
	}
	.dots i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: bounce 1s ease-in-out infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes bounce {
		0%,
		100% {
			opacity: 0.3;
			transform: translateY(1.5px);
		}
		50% {
			opacity: 1;
			transform: translateY(-2.5px);
		}
	}

	/* waiting — one dot breathing */
	.breathe {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: breathe 1.6s ease-in-out infinite;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(0.7);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* connecting — a dot emitting an expanding ring */
	.ring {
		position: relative;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent-bright);
	}
	.ring::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1.5px solid var(--accent-bright);
		animation: ring 1.3s ease-out infinite;
	}
	@keyframes ring {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		100% {
			transform: scale(2.6);
			opacity: 0;
		}
	}

	/* tool — a bar with a sliding highlight, like a scan */
	.scan {
		width: 18px;
		height: 4px;
		border-radius: 999px;
		background: var(--surface2);
		overflow: hidden;
		position: relative;
	}
	.scan::after {
		content: '';
		position: absolute;
		top: 0;
		left: -40%;
		width: 40%;
		height: 100%;
		border-radius: 999px;
		background: var(--accent-bright);
		animation: scan 1.1s ease-in-out infinite;
	}
	@keyframes scan {
		0% {
			left: -40%;
		}
		100% {
			left: 100%;
		}
	}

	/* compacting — two bars converging toward the center */
	.compress {
		gap: 3px;
	}
	.compress i {
		width: 5px;
		height: 11px;
		border-radius: 2px;
		background: var(--accent-bright);
	}
	.compress i:first-child {
		animation: push-right 1.1s ease-in-out infinite;
	}
	.compress i:last-child {
		animation: push-left 1.1s ease-in-out infinite;
	}
	@keyframes push-right {
		0%,
		100% {
			transform: translateX(0);
			opacity: 0.5;
		}
		50% {
			transform: translateX(2px);
			opacity: 1;
		}
	}
	@keyframes push-left {
		0%,
		100% {
			transform: translateX(0);
			opacity: 0.5;
		}
		50% {
			transform: translateX(-2px);
			opacity: 1;
		}
	}
</style>
