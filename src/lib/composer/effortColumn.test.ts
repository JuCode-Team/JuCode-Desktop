import { describe, expect, it } from 'vitest';
import { effortColumnIdx } from './effortColumn';

const rows = (actives: boolean[]) => actives.map((active) => ({ active }));

describe('effortColumnIdx', () => {
	it('hovered row wins over keyboard focus', () => {
		expect(effortColumnIdx(rows([false, false, true]), 1, true, 2)).toBe(1);
	});

	it('follows selIdx only after arrow-key navigation', () => {
		expect(effortColumnIdx(rows([true, false, false]), null, true, 2)).toBe(2);
	});

	it('ignores the default selection and falls back to the active row', () => {
		expect(effortColumnIdx(rows([false, true, false]), null, false, 0)).toBe(1);
	});

	it('returns null when nothing is focused and no row is active', () => {
		expect(effortColumnIdx(rows([false, false]), null, false, 0)).toBeNull();
	});

	it('treats a stale out-of-range focus as unfocused', () => {
		expect(effortColumnIdx(rows([true, false]), 5, false, 0)).toBe(0);
		expect(effortColumnIdx(rows([false, false]), 5, true, 9)).toBeNull();
	});

	it('handles empty row lists', () => {
		expect(effortColumnIdx([], null, false, 0)).toBeNull();
	});
});
