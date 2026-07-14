<script lang="ts">
	// Faster ↔ Smarter thinking-effort slider. Draggable handle (pointer capture),
	// clickable track, keyboard-accessible; snaps to the nearest level on release
	// and animates when not actively dragging. Styling follows the app tokens.
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
	// Position shown: the live pointer while dragging, else the active level.
	const frac = $derived(dragging ? dragFrac : fracFor(activeIndex));
	const nearestIndex = $derived(n > 1 ? Math.round(dragFrac * (n - 1)) : 0);
	// Which dots read as filled: follow the pointer while dragging.
	const filledUpto = $derived(dragging ? nearestIndex : activeIndex);
	const pct = $derived(frac * 100);

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
		<span>{t('chat.effortFaster')}</span>
		<span>{t('chat.effortSmarter')}</span>
	</div>
	<div
		class="es-track"
		class:dragging
		role="slider"
		tabindex="0"
		aria-label={t('chat.effortTitle')}
		aria-valuemin={0}
		aria-valuemax={n - 1}
		aria-valuenow={filledUpto}
		aria-valuetext={options[filledUpto]}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onkeydown={onKey}
	>
		<div class="es-inner" bind:this={inner}>
			<div class="es-fill" style="width: {pct}%"></div>
			{#each options as opt, i (opt)}
				<span
					class="es-dot"
					class:filled={i <= filledUpto}
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
		gap: 12px;
		padding: 6px 6px 12px;
		min-width: 248px;
		user-select: none;
	}
	.es-labels {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: var(--dim);
	}
	.es-track {
		position: relative;
		height: 26px;
		padding: 0 13px; /* room for the handle radius at both ends */
		border-radius: 999px;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		touch-action: none;
	}
	.es-track:focus-visible {
		outline: 2px solid color-mix(in oklab, var(--accent) 55%, transparent);
		outline-offset: 2px;
	}
	/* Coordinate space for the fill / dots / handle, inset by the handle radius. */
	.es-inner {
		position: absolute;
		inset: 0 13px;
	}
	.es-fill {
		position: absolute;
		left: -13px;
		top: 0;
		bottom: 0;
		border-radius: 999px 0 0 999px;
		background: var(--accent);
	}
	.es-dot {
		position: absolute;
		top: 50%;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: color-mix(in oklab, var(--dim) 55%, transparent);
		pointer-events: none;
	}
	.es-dot.filled {
		background: color-mix(in oklab, white 78%, var(--accent));
	}
	.es-handle {
		position: absolute;
		top: 50%;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: #fff;
		box-shadow:
			0 1px 4px rgba(0, 0, 0, 0.35),
			0 0 0 0.5px rgba(0, 0, 0, 0.1);
		pointer-events: none;
	}
	/* Animate when settling; follow the finger 1:1 while dragging. */
	.es-track:not(.dragging) .es-fill,
	.es-track:not(.dragging) .es-handle,
	.es-dot {
		transition:
			width 0.16s ease,
			left 0.16s ease,
			background 0.16s ease;
	}
	.es-track.dragging .es-handle {
		transform: translate(-50%, -50%) scale(1.08);
	}
</style>
