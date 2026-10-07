import { describe, expect, it } from 'vitest';
import { costText, pendingCost, sumCosts } from './sessionCost';
import { turnParts } from './turnStats';
import { setLocale } from './i18n';
import type { TurnStats } from './chat.svelte';

describe('session cost display', () => {
	it('keeps billed points separate from estimated dollars and labels incomplete charges', () => {
		setLocale('zh');
		const settled = { ...pendingCost(), gateway_cost: 0.05, pending_requests: 0 };
		const mixed = sumCosts([settled, { ...pendingCost(), gateway_requests: 0, pending_requests: 0, estimated_cost_usd: 0.12, unpriced_requests: 1 }]);
		expect(costText(99, mixed)).toBe('0.0500 积分 · 估算 $0.1200 · 部分费用未知');
		expect(costText(99, pendingCost())).toBe('待结算');
		expect(costText(99, { ...settled, gateway_cost: 0 })).toBe('0.0000 积分');
		expect(costText(0.05)).toBe('估算 $0.0500');
		expect(costText(0)).toBe('—');
		const turn = { cost: 99, billing: settled } as TurnStats;
		expect(turnParts(turn, ['cost'])).toEqual([{ text: '0.0500 积分', title: '实际扣费，已包含分组倍率', mono: true }]);
	});
});
