import { describe, expect, it } from 'vitest';
import { renderChime } from './chime';

describe('renderChime', () => {
	it('renders a finite sound under full scale that ends in silence', () => {
		for (const kind of ['done', 'attention'] as const) {
			const s = renderChime(kind, 48000);
			expect(s.length / 48000).toBeGreaterThan(0.25);
			expect(s.length / 48000).toBeLessThan(0.6);
			let peak = 0;
			for (const v of s) {
				expect(Number.isFinite(v)).toBe(true);
				peak = Math.max(peak, Math.abs(v));
			}
			expect(peak).toBeGreaterThan(0.3);
			expect(peak).toBeLessThan(1);
			expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-3);
		}
	});

	it('is the same every time', () => {
		expect(renderChime('done', 44100)).toEqual(renderChime('done', 44100));
	});
});
