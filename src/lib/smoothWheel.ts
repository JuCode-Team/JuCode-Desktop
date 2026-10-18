// Mouse wheels scroll smoothly on macOS. WebKit moves a wheel's notches in
// steps; the app takes a mouse wheel's events over the interface (trackpads
// keep their native scrolling) and hands them here (src-tauri/src/wheel.rs),
// in view points. Each one is first offered to the page as a `wheel` event,
// so handlers that read the wheel still do (the terminal, the chat leaving
// the end); unless one cancels it, the scroller under the pointer glides by
// the distance WebKit would have jumped.
//
// The glide moves by steps relative to where the scroller is each frame,
// not towards a fixed position: rows joining above the view (the
// conversation keeps its place by scroll anchoring) shift the position
// mid-glide, and the glide carries on from there.

import { invoke } from '@tauri-apps/api/core';
import { motionMs } from '$lib/ui/motion';

/** Time constant of the glide, ms: about 95% of the way after 3×. */
const TAU = 60;

type Glide = { el: Element; vertical: boolean; left: number; carry: number };
const glides: Glide[] = [];
let frame = 0;
let last = 0;

export function installSmoothWheel(zoom: () => number) {
	// Where the pointer is, as the page measures it; the app's own point
	// (converted from the window) serves until the pointer has moved.
	let pointer: { x: number; y: number } | null = null;
	window.addEventListener('pointermove', (e) => (pointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
	(window as unknown as { __jucodeWheel: unknown }).__jucodeWheel = (x: number, y: number, dx: number, dy: number) => {
		const z = zoom() || 1;
		const at = pointer ?? { x: x / z, y: y / z };
		wheel(at.x, at.y, dx / z, dy / z);
	};
	// Any other way of scrolling takes over from a glide.
	const stop = (e: Event) => e.isTrusted && glides.splice(0);
	window.addEventListener('wheel', stop, { capture: true, passive: true });
	window.addEventListener('keydown', stop, { capture: true });
	window.addEventListener('pointerdown', stop, { capture: true });
	invoke('smooth_wheel_ready', { ready: true }).catch((e) => console.error('smooth wheel', e));
}

function wheel(x: number, y: number, dx: number, dy: number) {
	const target = document.elementFromPoint(x, y) ?? document.body;
	const ev = new WheelEvent('wheel', { deltaX: dx, deltaY: dy, deltaMode: WheelEvent.DOM_DELTA_PIXEL, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true });
	if (!target.dispatchEvent(ev)) return;
	const vertical = Math.abs(dy) >= Math.abs(dx);
	const d = vertical ? dy : dx;
	const el = scrollerFor(target, vertical, d);
	if (!el) return;
	if (!motionMs(TAU)) {
		if (vertical) el.scrollTop += d;
		else el.scrollLeft += d;
		return;
	}
	const g = glides.find((g) => g.el === el && g.vertical === vertical);
	// A notch the other way starts over from here.
	if (g && Math.sign(g.left) === Math.sign(d)) g.left += d;
	else {
		if (g) glides.splice(glides.indexOf(g), 1);
		glides.push({ el, vertical, left: d, carry: 0 });
	}
	if (!frame) {
		last = performance.now();
		frame = requestAnimationFrame(step);
	}
}

function step(now: number) {
	const dt = Math.min(64, now - last);
	last = now;
	const k = 1 - Math.exp(-dt / TAU);
	for (const g of [...glides]) {
		const el = g.el;
		const move = Math.abs(g.left) < 1 ? g.left : g.left * k;
		g.left -= move;
		const from = g.vertical ? el.scrollTop : el.scrollLeft;
		// Positions are whole pixels: the part a step cannot move yet is
		// carried to the next one.
		const want = from + move + g.carry;
		if (g.vertical) el.scrollTop = want;
		else el.scrollLeft = want;
		const got = g.vertical ? el.scrollTop : el.scrollLeft;
		g.carry = want - got;
		// At an end: nothing left to glide.
		if (Math.abs(g.carry) >= 1 || (Math.abs(g.left) < 0.5 && Math.abs(g.carry) < 0.5)) glides.splice(glides.indexOf(g), 1);
	}
	frame = glides.length ? requestAnimationFrame(step) : 0;
}

/** The element under the pointer, or an ancestor, that can still scroll
 *  the wheel's way; else the page. */
function scrollerFor(from: Element, vertical: boolean, d: number): Element | null {
	for (let el: Element | null = from; el; el = el.parentElement) if (canScroll(el, vertical, d)) return el;
	return null;
}

function canScroll(el: Element, vertical: boolean, d: number): boolean {
	const size = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
	if (size < 1) return false;
	if (el !== document.scrollingElement) {
		const overflow = getComputedStyle(el)[vertical ? 'overflowY' : 'overflowX'];
		if (overflow !== 'auto' && overflow !== 'scroll') return false;
	}
	const pos = vertical ? el.scrollTop : el.scrollLeft;
	return d < 0 ? pos > 0 : pos < size - 1;
}
