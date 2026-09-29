// Svelte transitions on the app's motion tokens (app.css: --t-*, --ease-*), for
// elements that also need an exit animation. CSS-only entrances use the
// keyframes in app.css.
import { cubicOut, backOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export const T_FAST = 140;
export const T_MED = 220;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Backdrops. */
export function scrim(_node: Element, { duration = T_FAST } = {}): TransitionConfig {
	return { duration: reduced() ? 0 : duration, easing: cubicOut, css: (t) => `opacity: ${t}` };
}

/** Modals, sheets and floating cards: rise and settle in, sink out. */
export function sheet(_node: Element, { y = 10, duration = T_MED } = {}): TransitionConfig {
	return {
		duration: reduced() ? 0 : duration,
		easing: backOut,
		css: (t, u) => `opacity: ${Math.min(1, t * 1.6)}; transform: translateY(${u * y}px) scale(${0.985 + 0.015 * t})`
	};
}
