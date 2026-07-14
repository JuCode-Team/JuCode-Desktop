<script lang="ts">
	// Faster ↔ Smarter thinking-effort slider. A slim gradient track with tick
	// marks and a compact accent handle; the current level's name shows live,
	// centered above the track, while dragging or on focus. Draggable (pointer
	// capture), clickable, keyboard-accessible; snaps to the nearest level.
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

	let inner = $state<HTMLDivElement | null>(null);
	let dragging = $state(false);
	let dragFrac = $state(0); // 0..1 pointer position while dragging

	const n = $derived(options.length);
	const activeIndex = $derived(Math.max(0, options.indexOf(value)));
	const fracFor = (i: number) => (n > 1 ? i / (n - 1) : 0);
	const nearestIndex = $derived(n > 1 ? Math.round(dragFrac * (n - 1)) : 0);
	// While dragging the handle snaps to the nearest tick so fill, handle and dots
	// stay aligned to the levels.
	const shownIndex = $derived(dragging ? nearestIndex : activeIndex);
	const pct = $derived(fracFor(shownIndex) * 100);

	// "xhigh" → "X-High"; otherwise capitalize.
	function labelFor(v: string): string {
		if (!v) return '';
		if (v.toLowerCase() === 'xhigh') return 'X-High';
		return v.charAt(0).toUpperCase() + v.slice(1);
	}
	const currentLabel = $derived(labelFor(options[shownIndex]));

	function fracFromEvent(e: PointerEvent): number {
		if (!inner) return 0;
		const r = inner.getBoundingClientRect();
		if (r.width <= 0) return 0;
		return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	}
	function commit(i: number) {
		const opt = options[i];
		if (opt && opt !== value) onChange(opt);
	}
	function onDown(e: PointerEvent) {
		if (n <= 1) return;
		dragging = true;
		dragFrac = fracFromEvent(e);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}
	function onMove(e: PointerEvent) {
		if (dragging) dragFrac = fracFromEvent(e);
	}
	function onUp(e: PointerEvent) {
		if (!dragging) return;
		const i = Math.round(fracFromEvent(e) * (n - 1));
		dragging = false;
		commit(i);
	}
	function onKey(e: KeyboardEvent) {
		let i = activeIndex;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
		else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(n - 1, i + 1);
		else if (e.key === 'Home') i = 0;
		else if (e.key === 'End') i = n - 1;
		else return;
		e.preventDefault();
		commit(i);
	}
</script>

<div class="es">
	<div class="es-head">
		<span class="edge" class:on={shownIndex === 0}>{t('chat.effortFaster')}</span>
		<span class="now">{currentLabel}</span>
		<span class="edge" class:on={shownIndex === n - 1}>{t('chat.effortSmarter')}</span>
	</div>
	<div
		class="es-track"
		class:dragging
		role="slider"
		tabindex="0"
		aria-label={t('chat.effortTitle')}
		aria-valuemin={0}
		aria-valuemax={n - 1}
		aria-valuenow={shownIndex}
		aria-valuetext={currentLabel}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onkeydown={onKey}
	>
		<div class="es-inner" bind:this={inner}>
			<div class="es-rail"></div>
			<div class="es-fill" style="width: {pct}%"></div>
			{#each options as opt, i (opt)}
				<span
					class="es-dot"
					class:filled={i <= shownIndex}
					class:on={i === shownIndex}
					style="left: {fracFor(i) * 100}%"
					title={labelFor(opt)}
				></span>
			{/each}
			<div class="es-handle" class:dragging style="left: {pct}%">
				<span class="es-core"></span>
			</div>
		</div>
	</div>
</div>

<style>
	.es {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 6px 6px 10px;
		min-width: 244px;
		user-select: none;
	}
	.es-head {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: baseline;
		font-size: 12px;
	}
	.es-head .edge {
		color: var(--dim2);
		transition: color 0.14s ease;
	}
	.es-head .edge:first-child {
		text-align: left;
	}
	.es-head .edge:last-child {
		text-align: right;
	}
	.es-head .edge.on {
		color: var(--text);
	}
	/* The live level name — the centered focal point. */
	.es-head .now {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--accent);
		text-align: center;
		padding: 0 10px;
	}
	.es-track {
		position: relative;
		height: 22px;
		cursor: pointer;
		touch-action: none;
		border-radius: 999px;
	}
	.es-track:focus-visible {
		outline: 2px solid color-mix(in oklab, var(--accent) 50%, transparent);
		outline-offset: 3px;
	}
	/* Coordinate space inset by the handle radius so the handle centre reaches
	   but never overflows the ends. */
	.es-inner {
		position: absolute;
		inset: 0 9px;
	}
	.es-rail {
		position: absolute;
		left: -9px;
		right: -9px;
		top: 50%;
		height: 5px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.es-fill {
		position: absolute;
		left: -9px;
		top: 50%;
		height: 5px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--accent) 78%, #fff),
			var(--accent)
		);
	}
	.es-dot {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 4px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: color-mix(in oklab, var(--dim2) 55%, transparent);
		pointer-events: none;
		transition:
			background 0.14s ease,
			opacity 0.1s ease;
	}
	.es-dot.filled {
		background: color-mix(in oklab, white 70%, var(--accent));
	}
	.es-dot.on {
		opacity: 0; /* hidden under the handle */
	}
	.es-handle {
		position: absolute;
		top: 50%;
		width: 18px;
		height: 18px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		justify-content: center;
		background: #fff;
		box-shadow:
			0 1px 4px rgba(0, 0, 0, 0.35),
			0 0 0 0.5px rgba(0, 0, 0, 0.12);
		transition:
			left 0.14s ease,
			box-shadow 0.14s ease;
	}
	.es-fill {
		transition: width 0.14s ease;
	}
	/* Accent core dot inside the white handle — ties it to the fill color. */
	.es-core {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--accent);
		transition: transform 0.14s ease;
	}
	.es-handle.dragging {
		box-shadow:
			0 1px 5px rgba(0, 0, 0, 0.4),
			0 0 0 4px color-mix(in oklab, var(--accent) 26%, transparent);
	}
	.es-handle.dragging .es-core {
		transform: scale(1.15);
	}
</style>
