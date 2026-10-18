// Svelte transitions on the app's motion tokens (app.css: --t-*, --ease-*), for
// elements that also need an exit animation. CSS-only entrances use the
// keyframes in app.css. Everything here fades and moves a few pixels: no
// scale, no overshoot, nothing longer than T_MED; reduced motion makes them
// instant.
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export const T_FAST = 140;
export const T_MED = 220;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `ms`, or 0 when the user asked for reduced motion (for svelte/transition's own). */
export const motionMs = (ms: number) => (reduced() ? 0 : ms);

/** Backdrops. */
export function scrim(_node: Element, { duration = T_FAST } = {}): TransitionConfig {
	return { duration: motionMs(duration), easing: cubicOut, css: (t) => `opacity: ${t}` };
}

/** Modals and sheets: rise in, sink out. */
export function sheet(_node: Element, { y = 6, duration = T_MED } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

/** A page or section coming in (settings sections): fade and rise a little. */
export function paneIn(_node: Element, { y = 4, duration = T_MED } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

/** A page leaving (settings, home, project page), or a settings section
 *  giving way to the next: fade and sink a little. */
export function paneOut(_node: Element, { y = 4, duration = T_FAST } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

// Rows that arrive in the same update: a list loading or filling in, which
// appears at once instead of sliding row by row.
let arriving = 0;

/** A list row arriving (a new session in the sidebar): slide in from the left. */
export function rowIn(_node: Element, { x = -6, duration = 180 } = {}): () => TransitionConfig {
	arriving++;
	// Svelte calls a returned function in the next microtask, after every
	// row of this update has counted itself.
	return () => {
		const together = arriving;
		queueMicrotask(() => (arriving = 0));
		if (together > 2) return { duration: 0 };
		return {
			duration: motionMs(duration),
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; transform: translateX(${u * x}px)`
		};
	};
}

/** A menu or popover closing: fade and draw back a little towards its
 *  anchor (`y` is the way back: negative for a menu below its anchor). */
export function popOut(_node: Element, { y = -3, duration = 110 } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

let leaving = 0;

/** A row leaving a list (a session closed or archived): fade while the
 *  rows below close the gap. Many at once (a search narrowing the list)
 *  go without it, as rowIn's arrive. */
export function rowOut(node: Element, { duration = T_FAST } = {}): () => TransitionConfig {
	leaving++;
	const h = (node as HTMLElement).offsetHeight;
	return () => {
		const together = leaving;
		queueMicrotask(() => (leaving = 0));
		if (together > 2) return { duration: 0 };
		return {
			duration: motionMs(duration),
			easing: cubicOut,
			css: (t) => `opacity: ${t}; height: ${t * h}px; overflow: hidden`
		};
	};
}

/** Small controls going away (a jump button, a chip): fade only. */
export function fadeOut(_node: Element, { duration = T_FAST } = {}): TransitionConfig {
	return { duration: motionMs(duration), easing: cubicOut, css: (t) => `opacity: ${t}` };
}

/** A side region opening beside the content (background tasks): slide in
 *  from its edge a little and fade; it leaves the same way, quicker. */
export function sideIn(_node: Element, { x = 16, duration = T_MED } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateX(${u * x}px)`
	};
}
export function sideOut(_node: Element, { x = 12, duration = T_FAST } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateX(${u * x}px)`
	};
}

/** A tab closing: fade while the tabs beside it close the gap. Several at
 *  once (关闭其他 / 关闭全部) go without it. */
export function tabOut(node: Element, { duration = T_FAST } = {}): () => TransitionConfig {
	leaving++;
	const w = (node as HTMLElement).offsetWidth;
	return () => {
		const together = leaving;
		queueMicrotask(() => (leaving = 0));
		if (together > 2) return { duration: 0 };
		return {
			duration: motionMs(duration),
			easing: cubicOut,
			css: (t) => `opacity: ${t}; width: ${t * w}px; min-width: 0; overflow: hidden`
		};
	};
}
