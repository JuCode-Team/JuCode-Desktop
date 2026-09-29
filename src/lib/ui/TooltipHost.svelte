<script lang="ts">
	// Replaces the native `title` tooltip for the whole app: components keep
	// writing `title=`; on hover the text moves to data-tip (so the WebView shows
	// nothing) and appears here after a short delay, below the element or above
	// it near the bottom edge. Once one tooltip has shown, the next one within
	// a moment appears immediately, as in native toolbars.
	const DELAY = 450;
	const WARM = 400;

	let tip = $state<{ text: string; x: number; y: number; above: boolean } | null>(null);
	let current: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastHide = 0;

	function claim(el: HTMLElement): string {
		const title = el.getAttribute('title');
		if (title !== null) {
			el.removeAttribute('title');
			el.dataset.tip = title;
			// Icon-only controls relied on the title for their accessible name.
			if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
		}
		return el.dataset.tip ?? '';
	}

	function show(el: HTMLElement, text: string) {
		const r = el.getBoundingClientRect();
		const above = r.bottom + 40 > window.innerHeight;
		tip = { text, x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above };
	}
	function hide() {
		clearTimeout(timer);
		if (tip) lastHide = performance.now();
		tip = null;
		current = null;
	}

	function onOver(e: PointerEvent) {
		const el = (e.target as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
		if (el === current) return;
		hide();
		if (!el) return;
		const text = claim(el);
		if (!text) return;
		current = el;
		const warm = performance.now() - lastHide < WARM;
		timer = setTimeout(() => current === el && el.isConnected && show(el, text), warm ? 0 : DELAY);
	}
	function onOut(e: PointerEvent) {
		if (current && !current.contains(e.relatedTarget as Node | null)) hide();
	}
</script>

<svelte:document onpointerover={onOver} onpointerout={onOut} />
<svelte:window onpointerdown={hide} onkeydown={hide} onblur={hide} onwheel={hide} />

{#if tip}
	<div class="tip" class:above={tip.above} role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">{tip.text}</div>
{/if}

<style>
	.tip {
		position: fixed;
		z-index: 400;
		max-width: 320px;
		padding: 5px 9px;
		border-radius: var(--r-sm);
		background: var(--text);
		color: var(--bg);
		box-shadow: var(--shadow-pop);
		font-size: var(--fs-xs);
		line-height: 1.4;
		white-space: pre-line;
		pointer-events: none;
		transform: translateX(-50%);
		animation: tip-in var(--t-fast) var(--ease-out);
	}
	.tip.above {
		transform: translate(-50%, -100%);
	}
	@keyframes tip-in {
		from {
			opacity: 0;
		}
	}
</style>
