<script lang="ts">
	// Faster ↔ Smarter thinking-effort slider: a slim track with tick marks and a
	// compact accent handle. Draggable (pointer capture), clickable, keyboard-
	// accessible; snaps to the nearest level on release and animates when settling.
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
	// While dragging the handle snaps to the nearest tick (no free-floating), so
	// the fill, handle and dots stay perfectly aligned to the levels.
	const shownIndex = $derived(dragging ? nearestIndex : activeIndex);
	const pct = $derived(fracFor(shownIndex) * 100);

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
	<div class="es-labels">
		<span class:on={shownIndex === 0}>{t('chat.effortFaster')}</span>
		<span class:on={shownIndex === n - 1}>{t('chat.effortSmarter')}</span>
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
		aria-valuetext={options[shownIndex]}
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
					title={opt}
				></span>
			{/each}
			<div class="es-handle" style="left: {pct}%"></div>
		</div>
	</div>
</div>

<style>
	.es {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 4px 4px 8px;
		min-width: 240px;
		user-select: none;
	}
	.es-labels {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--dim2);
	}
	.es-labels .on {
		color: var(--text);
	}
	/* The interactive area is generous (easy to grab), but the visible track is a
	   slim rail — matching the app's restrained control style. */
	.es-track {
		position: relative;
		height: 20px;
		cursor: pointer;
		touch-action: none;
		border-radius: 999px;
	}
	.es-track:focus-visible {
		outline: 2px solid color-mix(in oklab, var(--accent) 50%, transparent);
		outline-offset: 3px;
	}
	/* Coordinate space for rail / fill / dots / handle, inset by the handle radius
	   so the handle centre reaches but never overflows the ends. */
	.es-inner {
		position: absolute;
		inset: 0 8px;
	}
	.es-rail {
		position: absolute;
		left: -8px;
		right: -8px;
		top: 50%;
		height: 4px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.es-fill {
		position: absolute;
		left: -8px;
		top: 50%;
		height: 4px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--accent);
	}
	.es-dot {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 4px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: var(--surface);
		box-shadow: 0 0 0 1px color-mix(in oklab, var(--dim2) 60%, transparent);
		pointer-events: none;
	}
	.es-dot.filled {
		background: color-mix(in oklab, white 55%, var(--accent));
		box-shadow: none;
	}
	.es-dot.on {
		opacity: 0; /* hidden under the handle */
	}
	.es-handle {
		position: absolute;
		top: 50%;
		width: 16px;
		height: 16px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: var(--text);
		box-shadow:
			0 0 0 3px var(--panel),
			0 1px 3px rgba(0, 0, 0, 0.3);
		pointer-events: none;
	}
	/* Animate when settling; the handle already snaps per-tick while dragging, so
	   even mid-drag it eases smoothly between levels. */
	.es-fill,
	.es-handle,
	.es-dot {
		transition:
			width 0.14s ease,
			left 0.14s ease,
			background 0.14s ease,
			opacity 0.1s ease;
	}
	.es-track.dragging .es-handle {
		box-shadow:
			0 0 0 3px var(--panel),
			0 0 0 5px color-mix(in oklab, var(--accent) 30%, transparent),
			0 1px 3px rgba(0, 0, 0, 0.3);
	}
</style>
