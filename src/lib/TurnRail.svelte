<script lang="ts">
	import { t } from '$lib/i18n';

	// One tick per user message along the chat's left edge: the one in view is
	// lit, hovering previews it, clicking jumps to it.
	let {
		marks,
		current,
		onJump
	}: {
		/** Each user message's text, in order. */
		marks: string[];
		/** Index of the mark in view, -1 for none. */
		current: number;
		onJump: (n: number) => void;
	} = $props();

	let hover = $state<{ n: number; y: number } | null>(null);
	let rail = $state<HTMLElement | null>(null);

	// More marks than fit: the rail shows a window of them, which moves only
	// when the lit tick nears its edge (so it does not shift on every change),
	// its edge ticks fading where more lie beyond.
	const SHOWN = 30;
	const MARGIN = 4;
	let start = 0;
	const view = $derived.by(() => {
		const n = marks.length;
		let from = start;
		if (current >= 0) from = Math.min(Math.max(from, current - (SHOWN - 1 - MARGIN)), current - MARGIN);
		from = Math.max(0, Math.min(from, n - SHOWN));
		start = from;
		return { from, to: Math.min(n, from + SHOWN) };
	});
	// 1 inside; less towards an edge that has more beyond it.
	function fade(n: number) {
		const fromTop = view.from > 0 ? n - view.from : Infinity;
		const fromBottom = view.to < marks.length ? view.to - 1 - n : Infinity;
		return Math.min(1, (Math.min(fromTop, fromBottom) + 1) / 4);
	}

	function enter(n: number, e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		hover = { n, y: r.top + r.height / 2 };
	}
	// One line of a message, markdown marks dropped.
	const line = (text: string) => text.replace(/[#*`>_~|]/g, '').replace(/\s+/g, ' ').trim();
</script>

<svelte:window onblur={() => (hover = null)} />

<div class="gutter">
	<nav class="rail" aria-label={t('chat.turnRail')} bind:this={rail} onpointerleave={() => (hover = null)}>
		{#each marks.slice(view.from, view.to) as mark, k (view.from + k)}
			{@const n = view.from + k}
			<button class="tick" style:opacity={fade(n)} class:on={n === current} aria-label={line(mark).slice(0, 80)} onclick={() => onJump(n)} onpointerenter={(e) => enter(n, e)}>
				<span></span>
			</button>
		{/each}
	</nav>
	<!-- Next to the rail so it hides with the rail's :hover even when a
	     pointerleave is missed (the window losing the pointer). -->
	{#if hover && rail}
		<div class="preview" style:top="{hover.y}px" style:left="{rail.getBoundingClientRect().right + 4}px">{line(marks[hover.n] ?? '')}</div>
	{/if}
</div>

<style>
	/* Centres the rail vertically without a transform, which would capture the
	   fixed preview. */
	.gutter {
		position: absolute;
		left: 4px;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		pointer-events: none;
		z-index: 5;
	}
	/* Its own compositing layer: overlaying the scrolling chat, WebKit left
	   stale pixels of a tick that shrank or moved. */
	.rail {
		display: flex;
		flex-direction: column;
		pointer-events: auto;
		will-change: transform;
	}
	.tick {
		flex: none;
		display: flex;
		align-items: center;
		width: 28px;
		height: 10px;
		padding: 0 4px;
		border: none;
		background: none;
		cursor: pointer;
	}
	/* Lengths are scales of the full 18px, so a change repaints no layout. */
	.tick span {
		width: 18px;
		height: 2px;
		border-radius: 1px;
		background: var(--dim2);
		opacity: 0.55;
		transform: scaleX(0.56);
		transform-origin: left;
		transition:
			transform var(--t-fast) var(--ease-out),
			opacity var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
	}
	.tick.on span {
		transform: scaleX(0.78);
		background: var(--text);
		opacity: 1;
	}
	/* The ticks next to the pointer lengthen too. */
	.tick:has(+ .tick:hover) span,
	.tick:hover + .tick span {
		transform: scaleX(0.72);
		opacity: 0.85;
	}
	.tick:hover span {
		transform: none;
		background: var(--text);
		opacity: 1;
	}
	.tick:focus-visible {
		outline: 1px solid var(--accent-bright);
		outline-offset: -1px;
		border-radius: var(--r-xs);
	}
	.preview {
		position: fixed;
		z-index: 400;
		max-width: min(360px, 60vw);
		padding: 10px 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-pop);
		color: var(--text);
		font-size: var(--fs-sm);
		line-height: 1.4;
		transform: translateY(-50%);
		pointer-events: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		animation: preview-in var(--t-fast) var(--ease-out);
	}
	.rail:not(:hover) + .preview {
		display: none;
	}
	@keyframes preview-in {
		from {
			opacity: 0;
			transform: translate(-4px, -50%);
		}
	}
</style>
