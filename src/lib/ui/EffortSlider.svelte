<script lang="ts">
	// Faster ↔ Smarter thinking-effort slider: a row of dots filled up to the
	// active level, with a raised handle on it. Options are ordered fastest →
	// smartest (low … max); clicking a dot (or the track) selects that level.
	import { t } from '$lib/i18n';

	let {
		value,
		options,
		onChange
	}: {
		value: string;
		options: string[];
		onChange: (v: string) => void;
	} = $props();

	const activeIndex = $derived(Math.max(0, options.indexOf(value)));
	// Fill runs to the center of the active dot.
	const fillPct = $derived(
		options.length > 1 ? (activeIndex / (options.length - 1)) * 100 : 0
	);
</script>

<div class="es">
	<div class="es-labels">
		<span>{t('chat.effortFaster')}</span>
		<span>{t('chat.effortSmarter')}</span>
	</div>
	<div class="es-track" role="group" aria-label={t('chat.effortTitle')}>
		<div class="es-rail"></div>
		<div class="es-fill" style="width: {fillPct}%"></div>
		{#each options as opt, i (opt)}
			<button
				class="es-dot"
				class:filled={i <= activeIndex}
				class:handle={i === activeIndex}
				style="left: {options.length > 1 ? (i / (options.length - 1)) * 100 : 50}%"
				title={opt}
				aria-label={opt}
				aria-pressed={i === activeIndex}
				onclick={() => onChange(opt)}
			></button>
		{/each}
	</div>
</div>

<style>
	.es {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 4px 6px 10px;
		min-width: 240px;
	}
	.es-labels {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: var(--dim);
	}
	.es-track {
		position: relative;
		height: 22px;
		margin: 0 11px;
		display: flex;
		align-items: center;
	}
	.es-rail {
		position: absolute;
		left: -11px;
		right: -11px;
		height: 22px;
		border-radius: 999px;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.es-fill {
		position: absolute;
		left: -11px;
		height: 22px;
		border-radius: 999px;
		background: var(--accent);
		transition: width 0.15s ease;
	}
	.es-dot {
		position: absolute;
		transform: translateX(-50%);
		width: 6px;
		height: 6px;
		border-radius: 999px;
		border: none;
		padding: 0;
		background: color-mix(in oklab, var(--dim) 60%, transparent);
		cursor: pointer;
		z-index: 1;
	}
	.es-dot.filled {
		background: color-mix(in oklab, white 75%, var(--accent));
	}
	.es-dot.handle {
		width: 22px;
		height: 22px;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
	}
	.es-dot:not(.handle):hover {
		background: #fff;
	}
</style>
