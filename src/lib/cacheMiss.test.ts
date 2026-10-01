import { describe, expect, it } from 'vitest';
import { CacheWatch } from './cacheMiss';

describe('CacheWatch', () => {
	it('never flags the first request', () => {
		expect(new CacheWatch().check(20_000, 0, 0)).toBe(false);
	});

	it('flags a request that reads back less than half of the previous prompt', () => {
		const w = new CacheWatch();
		w.check(10_000, 0, 0);
		expect(w.check(14_000, 9_990, 1000)).toBe(false);
		expect(w.check(18_000, 6_000, 2000)).toBe(true);
		expect(w.check(22_000, 0, 3000)).toBe(true);
	});

	it('ignores prompts too short to cache', () => {
		const w = new CacheWatch();
		w.check(600, 0, 0);
		expect(w.check(900, 0, 1000)).toBe(false);
	});

	it('starts over after a reset or past the cache lifetime', () => {
		const w = new CacheWatch();
		w.check(10_000, 0, 0);
		w.reset();
		expect(w.check(4_000, 0, 1000)).toBe(false);
		expect(w.check(8_000, 0, 1000 + 6 * 60_000)).toBe(false);
		expect(w.check(9_000, 0, 1000 + 6 * 60_000 + 1000)).toBe(true);
	});
});
