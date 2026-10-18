import { describe, expect, it } from 'vitest';
import { turnParts } from './turnStats';
import { setLocale } from './i18n';
import type { TurnStats } from './chat.svelte';

describe('turn stats', () => {
	it('gives output speed as output tokens over streaming time, and nothing without either', () => {
		setLocale('zh');
		const turn = { elapsed: 9000, genMs: 4000, outTokens: 210 } as TurnStats;
		expect(turnParts(turn, ['tps'])).toEqual([{ text: '52.5 tok/s', title: expect.stringContaining('输出速度'), mono: true }]);
		expect(turnParts({ ...turn, genMs: undefined }, ['tps'])).toEqual([]);
		expect(turnParts({ ...turn, outTokens: 0 }, ['tps'])).toEqual([]);
	});
});
