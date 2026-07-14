<script lang="ts">
	// Faster ↔ Smarter thinking-effort slider (thick capsule). The current level's
	// name shows live and centered. Top tiers recolor: `max` → orange, `ultra` →
	// purple; reaching them animates a flowing shimmer across the fill. Draggable
	// (pointer capture), clickable, keyboard-accessible; snaps to the nearest level.
	import { t } from '$lib/i18n';

	let {
		value,
		options,
		backendId = '',
		onChange
	}: {
		value: string;
		options: string[];
		backendId?: string;
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

	function labelFor(v: string): string {
		if (!v) return '';
		const l = v.toLowerCase();
		if (l === 'xhigh') return 'X-High';
		return v.charAt(0).toUpperCase() + v.slice(1);
	}
	const currentLabel = $derived(labelFor(options[shownIndex]));
	// Special top tiers get their own accent + a flowing shimmer. Backend-scoped:
	// claude's `max` → orange, codex's `ultra` → purple. Codex's own `max` (and any
	// other backend) stays on the default accent.
	const tier = $derived.by(() => {
		const v = (options[shownIndex] ?? '').toLowerCase();
		if (backendId === 'claude' && v === 'max') return 'max';
		if (backendId === 'codex' && v === 'ultra') return 'ultra';
		return '';
	});

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

<div class="es" data-tier={tier}>
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
			<div class="es-fill" class:flowing={tier !== ''} style="width: calc({pct}% + 22px)"></div>
			{#each options as opt, i (opt)}
				<span
					class="es-dot"
					class:filled={i <= shownIndex}
					class:on={i === shownIndex}
					style="left: {fracFor(i) * 100}%"
					title={labelFor(opt)}
				></span>
			{/each}
			<div class="es-handle" class:dragging style="left: {pct}%"></div>
		</div>
	</div>
</div>

<style>
	.es {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 6px 6px 10px;
		min-width: 248px;
		user-select: none;
		/* Tier palette — default accent; overridden per data-tier below. */
		--eff-a: color-mix(in oklab, var(--accent) 82%, #fff);
		--eff-b: var(--accent);
		--eff-solid: var(--accent);
	}
	.es[data-tier='max'] {
		--eff-a: #ffb24d;
		--eff-b: #f97316;
		--eff-solid: #f97316;
	}
	.es[data-tier='ultra'] {
		--eff-a: #c79bff;
		--eff-b: #8b5cf6;
		--eff-solid: #8b5cf6;
	}
	.es-head {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: baseline;
		font-size: 12px;
	}
	.es-head .edge {
		color: var(--dim2);
		transition: color 0.18s ease;
	}
	.es-head .edge:last-child {
		text-align: right;
	}
	.es-head .edge.on {
		color: var(--text);
	}
	.es-head .now {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--eff-solid);
		text-align: center;
		padding: 0 10px;
		transition: color 0.35s ease;
	}
	/* Thick capsule track. */
	.es-track {
		position: relative;
		height: 24px;
		padding: 0 11px; /* handle radius room at both ends */
		border-radius: 999px;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		touch-action: none;
	}
	.es-track:focus-visible {
		outline: 2px solid color-mix(in oklab, var(--eff-solid) 55%, transparent);
		outline-offset: 3px;
	}
	.es-inner {
		position: absolute;
		inset: 0 11px;
	}
	.es-fill {
		position: absolute;
		left: -11px;
		top: 0;
		bottom: 0;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--eff-a), var(--eff-b));
		/* Animate width (snap between levels) and the color transition (tier swap). */
		transition:
			width 0.16s ease,
			background 0.4s ease;
	}
	/* Flowing shimmer for the special tiers: a moving highlight band scrolls
	   across the fill. */
	.es-fill.flowing {
		background:
			linear-gradient(
				100deg,
				transparent 20%,
				color-mix(in oklab, #fff 45%, transparent) 42%,
				color-mix(in oklab, #fff 45%, transparent) 50%,
				transparent 72%
			),
			linear-gradient(90deg, var(--eff-a), var(--eff-b));
		background-size:
			220% 100%,
			100% 100%;
		background-repeat: no-repeat;
		animation: eff-flow 1.6s linear infinite;
	}
	@keyframes eff-flow {
		from {
			background-position:
				160% 0,
				0 0;
		}
		to {
			background-position:
				-120% 0,
				0 0;
		}
	}
	.es-dot {
		position: absolute;
		top: 50%;
		width: 5px;
		height: 5px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: color-mix(in oklab, var(--dim) 60%, transparent);
		pointer-events: none;
		transition:
			background 0.16s ease,
			opacity 0.12s ease;
	}
	.es-dot.filled {
		background: color-mix(in oklab, #fff 82%, transparent);
	}
	.es-dot.on {
		opacity: 0; /* under the handle */
	}
	.es-handle {
		position: absolute;
		top: 50%;
		width: 20px;
		height: 20px;
		border-radius: 999px;
		transform: translate(-50%, -50%);
		background: #fff;
		box-shadow:
			0 1px 4px rgba(0, 0, 0, 0.35),
			0 0 0 0.5px rgba(0, 0, 0, 0.12);
		transition:
			left 0.16s ease,
			box-shadow 0.2s ease;
	}
	.es-handle.dragging {
		box-shadow:
			0 1px 6px rgba(0, 0, 0, 0.4),
			0 0 0 4px color-mix(in oklab, var(--eff-solid) 28%, transparent);
	}
</style>
