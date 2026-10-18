// Pure helpers for the composer's reasoning-effort slider.

import { t } from '$lib/i18n';

/** The effort the engine falls back to for a model (config.rs
 *  read_reasoning_effort): "medium" when offered, else the first tier. An
 *  agent whose effort can be left to it (`unset`, an ACP agent's
 *  `default_effort`) falls back to that. */
export function defaultEffort(efforts: string[], unset = ''): string {
	if (unset) return unset;
	return efforts.includes('medium') ? 'medium' : (efforts[0] ?? '');
}

/** Display label: "high" → "High", "xhigh" → "XHigh"; an ACP agent's unset
 *  values ("default", "auto") in the UI's language. */
export function effortLabel(effort: string): string {
	if (effort === 'xhigh') return 'XHigh';
	if (effort === 'default') return t('chat.optionDefault');
	if (effort === 'auto') return t('chat.optionAuto');
	return effort ? effort[0].toUpperCase() + effort.slice(1) : effort;
}

/** Nearest stop index for a pointer at `x` over a track spanning
 *  [left, left + width] with `count` evenly spaced stops (ends included). */
export function stopAt(x: number, left: number, width: number, count: number): number {
	if (count <= 1 || width <= 0) return 0;
	const ratio = Math.min(1, Math.max(0, (x - left) / width));
	return Math.round(ratio * (count - 1));
}

/** Arrow / Home / End navigation over `count` stops; null for other keys. */
export function stepStop(key: string, idx: number, count: number): number | null {
	const last = count - 1;
	switch (key) {
		case 'ArrowLeft':
		case 'ArrowDown':
			return Math.max(0, idx - 1);
		case 'ArrowRight':
		case 'ArrowUp':
			return Math.min(last, idx + 1);
		case 'Home':
			return 0;
		case 'End':
			return last;
		default:
			return null;
	}
}
