// Pure helpers for the composer's reasoning-effort slider.

/** The effort the engine falls back to for a model (config.rs
 *  read_reasoning_effort): "medium" when offered, else the first tier. */
export function defaultEffort(efforts: string[]): string {
	return efforts.includes('medium') ? 'medium' : (efforts[0] ?? '');
}

/** Display label: "high" → "High", "xhigh" → "XHigh". */
export function effortLabel(effort: string): string {
	if (effort === 'xhigh') return 'XHigh';
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
