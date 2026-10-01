import { describe, it, expect, vi } from 'vitest';
import { dayRange, groupChannels, importLegacyUsage, EMPTY_TOKENS } from './usageStats';

function makeStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	} as Storage;
}

const tokens = (input: number, output: number, cost?: string) => ({ ...EMPTY_TOKENS, input_tokens: input, output_tokens: output, turns: 1, ...(cost ? { cost } : {}) });

describe('groupChannels', () => {
	it('groups by kind, JuCode by group, the rest by provider', () => {
		const groups = groupChannels([
			{ channel_kind: 'jucode', channel: 'jucode', group: 'claude-max', ...tokens(10, 1, '0.5') },
			{ channel_kind: 'jucode', channel: 'jucode', group: '', ...tokens(30, 3, '0.25') },
			{ channel_kind: 'local', channel: 'anthropic', ...tokens(5, 5) },
			{ channel_kind: 'third_party', channel: 'kimi-code', ...tokens(7, 0) },
			{ channel_kind: 'legacy', channel: 'anthropic', ...tokens(2, 0) }
		]);
		expect(groups.map((g) => g.kind)).toEqual(['jucode', 'third_party', 'local', 'legacy']);
		const jucode = groups[0];
		expect(jucode.rows.map((r) => r.key)).toEqual(['', 'claude-max']);
		expect(jucode.usage.input_tokens).toBe(40);
		expect(Number(jucode.usage.cost)).toBeCloseTo(0.75);
		expect(jucode.usage.turns).toBe(2);
		expect(groups[2].rows[0].key).toBe('anthropic');
	});
});

describe('dayRange', () => {
	it('lists every day oldest first', () => {
		expect(dayRange(3, new Date(2026, 0, 2))).toEqual(['2025-12-31', '2026-01-01', '2026-01-02']);
	});
});

describe('importLegacyUsage', () => {
	it('hands the old counts to the daemon once and forgets them', async () => {
		const days = { '2026-09-30': { in: 10, out: 2, prov: { jucode: { in: 10, out: 2 } } } };
		(globalThis as { localStorage: Storage }).localStorage = makeStorage({ 'jucode-usage-daily': JSON.stringify(days) });
		const request = vi.fn(async () => ({ imported: true }));
		await importLegacyUsage(request);
		expect(request).toHaveBeenCalledWith({ op: 'usage_import_legacy', days });
		expect(localStorage.getItem('jucode-usage-daily')).toBeNull();
		await importLegacyUsage(request);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('keeps the old counts when the daemon cannot take them', async () => {
		(globalThis as { localStorage: Storage }).localStorage = makeStorage({ 'jucode-usage-daily': '{"2026-09-30":{"in":1,"out":1}}' });
		await expect(importLegacyUsage(async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
		expect(localStorage.getItem('jucode-usage-daily')).not.toBeNull();
	});
});
