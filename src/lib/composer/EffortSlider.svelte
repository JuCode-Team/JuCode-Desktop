<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import { effortLabel, stepStop, stopAt } from './effort';

	// Reasoning-effort slider: one stop per effort the model offers, labels
	// under the stops. A pick is committed on release so a drag sends one
	// /model command, not one per stop crossed.
	let {
		efforts,
		effort,
		disabled = false,
		onEffort,
		accent = '',
		current = $bindable('')
	}: {
		efforts: string[];
		effort: string;
		disabled?: boolean;
		onEffort: (effort: string) => void;
		/** The model's colour (modelColor); '' keeps the neutral fill. */
		accent?: string;
		/** The shown effort (optimistic while the engine confirms), for the caller's label. */
		current?: string;
	} = $props();

	// Optimistic value between the commit and the engine's model_status ack.
	let pending = $state('');
	$effect(() => {
		effort;
		untrack(() => (pending = ''));
	});
	let railEl = $state<HTMLDivElement>();
	let drag = $state<number | null>(null);

	const shownEffort = $derived(pending || effort);
	$effect(() => {
		current = shownEffort;
	});
	const idx = $derived(Math.max(0, efforts.indexOf(shownEffort)));
	const shown = $derived(drag ?? idx);
	const last = $derived(Math.max(1, efforts.length - 1));
	// The highest effort gets the sweeping fill (see .effort-max in app.css).
	const top = $derived(efforts.length > 1 && shown === efforts.length - 1);
	const pct = (i: number) => (efforts.length > 1 ? (i / last) * 100 : 0);

	function commit(i: number) {
		const e = efforts[i];
		if (disabled || !e || e === shownEffort) return;
		pending = e;
		onEffort(e);
	}
	function stopFor(e: PointerEvent) {
		const r = railEl!.getBoundingClientRect();
		return stopAt(e.clientX, r.left, r.width, efforts.length);
	}
	function onDown(e: PointerEvent) {
		if (disabled || e.button !== 0 || !railEl) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = stopFor(e);
	}
	function onMove(e: PointerEvent) {
		if (drag !== null) drag = stopFor(e);
	}
	function onUp() {
		if (drag === null) return;
		const i = drag;
		drag = null;
		commit(i);
	}
	function onKey(e: KeyboardEvent) {
		if (disabled) return;
		const next = stepStop(e.key, idx, efforts.length);
		if (next === null) return;
		e.preventDefault();
		commit(next);
	}
</script>

<div
	class="slider"
	class:disabled
	class:dragging={drag !== null}
	class:top
	class:tinted={!!accent}
	style:--effort-accent={accent || 'var(--text)'}
	role="slider"
	tabindex="0"
	aria-label={t('chat.effortTitle')}
	aria-valuemin={0}
	aria-valuemax={efforts.length - 1}
	aria-valuenow={shown}
	aria-valuetext={effortLabel(efforts[shown] ?? '')}
	aria-disabled={disabled}
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={() => (drag = null)}
	onkeydown={onKey}
>
	<div class="rail" bind:this={railEl}>
		<div class="track"></div>
		<div class="fill" style:width="calc({pct(shown)}% + 24px)"></div>
		{#each efforts as e, i (e)}
			<span class="stop" class:passed={i <= shown} style:left="{pct(i)}%"></span>
		{/each}
		<span class="thumb" style:left="{pct(shown)}%"></span>
	</div>
</div>
<div class="ticks">
	{#each efforts as e, i (e)}
		<span class="tick" class:on={i === shown} style:left="{pct(i)}%">{effortLabel(e)}</span>
	{/each}
</div>

<style>
	/* The slider: padded hit area around a rail; the thumb is centred on a stop. */
	/* A 24px pill: stops sit on an inner line inset by the thumb's radius, so
	   the thumb stays inside the pill at both ends. */
	.slider {
		padding: 0 12px;
		border-radius: var(--r-sm);
		cursor: pointer;
		touch-action: none;
		outline: none;
	}
	.slider:focus-visible {
		box-shadow: 0 0 0 2px var(--border);
	}
	.slider.disabled {
		opacity: 0.5;
		cursor: default;
	}
	.rail {
		position: relative;
		height: 24px;
	}
	.track,
	.fill {
		position: absolute;
		top: 0;
		left: -12px;
		height: 24px;
		border-radius: var(--r-full);
	}
	.track {
		right: -12px;
		background: var(--surface2);
	}
	.fill {
		background: color-mix(in oklab, var(--text) 16%, transparent);
		transition:
			width var(--t-fast) var(--ease-out),
			background var(--t-med) var(--ease-out);
	}
	.slider.tinted .fill {
		background: color-mix(in oklab, var(--effort-accent) 30%, transparent);
	}
	/* Top effort: the fill sweeps in the model's colour and the thumb glows. */
	.slider.top .fill {
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--effort-accent) 22%, transparent) 0%,
			color-mix(in oklab, var(--effort-accent) 55%, transparent) 50%,
			color-mix(in oklab, var(--effort-accent) 22%, transparent) 100%
		);
		background-size: 200% 100%;
		animation: sweep 2.4s linear infinite;
	}
	.slider.top .thumb {
		box-shadow:
			var(--shadow-pop),
			0 0 0 3px color-mix(in oklab, var(--effort-accent) 30%, transparent),
			0 0 18px color-mix(in oklab, var(--effort-accent) 55%, transparent);
	}
	.stop {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 4px;
		border-radius: var(--r-full);
		background: var(--dim2);
		transform: translate(-50%, -50%);
	}
	.stop.passed {
		background: color-mix(in oklab, var(--text) 55%, transparent);
	}
	.thumb {
		position: absolute;
		top: 50%;
		width: 20px;
		height: 20px;
		border-radius: var(--r-full);
		background: var(--text);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-pop);
		transform: translate(-50%, -50%);
		transition:
			left var(--t-fast) var(--ease-out),
			box-shadow var(--t-med) var(--ease-out);
	}
	:global([data-theme='light']) .thumb {
		background: var(--panel);
	}
	.slider.dragging .thumb,
	.slider.dragging .fill {
		transition: none;
	}
	.ticks {
		position: relative;
		height: 14px;
		margin: 2px 6px 0;
	}
	.tick {
		position: absolute;
		transform: translateX(-50%);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
	}
	.tick:first-child {
		transform: none;
		margin-left: -4px;
	}
	.tick:last-child {
		transform: translateX(-100%);
		margin-left: 4px;
	}
	.tick.on {
		color: var(--text);
	}
</style>
