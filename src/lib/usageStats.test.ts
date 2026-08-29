import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DayUsage } from './usageStats';

// usageStats 持有模块级内存缓存，因此每个用例都通过 resetModules + 动态导入
// 拿到一份全新的模块；localStorage 在 node 环境下不存在，这里注入内存实现。
function makeStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
		key: (i: number) => [...store.keys()][i] ?? null,
		get length() {
			return store.size;
		}
	} as Storage;
}

async function fresh(initial?: Record<string, string>) {
	vi.resetModules();
	(globalThis as { localStorage: Storage }).localStorage = makeStorage(initial);
	return import('./usageStats');
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('recordUsage', () => {
	it('increments day totals and all three dimension maps', async () => {
		const m = await fresh();
		m.recordUsage(100, 20, { provider: 'anthropic', model: 'opus-4.8', agent: 'claude' });
		m.recordUsage(50, 5, { provider: 'anthropic', model: 'opus-4.8', agent: 'claude' });
		const day = m.getDailyUsage()[m.dayKey(new Date())];
		expect(day).toEqual({
			in: 150,
			out: 25,
			prov: { anthropic: { in: 150, out: 25 } },
			models: { 'opus-4.8': { in: 150, out: 25 } },
			agents: { claude: { in: 150, out: 25 } }
		});
	});

	it('falls back to the other bucket when meta is missing or blank', async () => {
		const m = await fresh();
		m.recordUsage(10, 1);
		m.recordUsage(5, 2, { provider: '  ', model: '', agent: undefined });
		const day = m.getDailyUsage()[m.dayKey(new Date())];
		expect(day.prov).toEqual({ other: { in: 15, out: 3 } });
		expect(day.models).toEqual({ other: { in: 15, out: 3 } });
		expect(day.agents).toEqual({ other: { in: 15, out: 3 } });
	});

	it('ignores zero-token events', async () => {
		const m = await fresh();
		m.recordUsage(0, 0, { provider: 'openai' });
		expect(m.getDailyUsage()).toEqual({});
	});

	it('stores agent display labels for stable keys', async () => {
		const m = await fresh();
		m.recordUsage(10, 1, { agent: 'acp:gemini-cli', agentLabel: 'Gemini CLI' });
		m.recordUsage(10, 1, { agent: 'jucode' });
		const day = m.getDailyUsage()[m.dayKey(new Date())];
		expect(day.agentLabels).toEqual({ 'acp:gemini-cli': 'Gemini CLI' });
		expect(Object.keys(day.agents!).sort()).toEqual(['acp:gemini-cli', 'jucode']);
	});

	it('persists to localStorage after the debounce window', async () => {
		const m = await fresh();
		m.recordUsage(7, 3, { provider: 'openai', model: 'gpt-6', agent: 'codex' });
		vi.advanceTimersByTime(1000);
		const raw = localStorage.getItem('jucode-usage-daily');
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw!) as Record<string, unknown>;
		expect(parsed[m.dayKey(new Date())]).toEqual({
			in: 7,
			out: 3,
			prov: { openai: { in: 7, out: 3 } },
			models: { 'gpt-6': { in: 7, out: 3 } },
			agents: { codex: { in: 7, out: 3 } }
		});
	});
});

describe('load compatibility', () => {
	it('parses old v1 days without models or agents', async () => {
		const m = await fresh({
			'jucode-usage-daily': JSON.stringify({
				'2026-01-02': { in: 10, out: 5, prov: { openai: { in: 10, out: 5 } } },
				'2026-01-03': { in: 4, out: 2 }
			})
		});
		const usage = m.getDailyUsage();
		expect(usage['2026-01-02']).toEqual({
			in: 10,
			out: 5,
			prov: { openai: { in: 10, out: 5 } }
		});
		expect(usage['2026-01-03']).toEqual({ in: 4, out: 2 });
	});

	it('ignores malformed day keys and coerces bad values', async () => {
		const m = await fresh({
			'jucode-usage-daily': JSON.stringify({
				'not-a-day': { in: 99, out: 99 },
				'2026-1-2': { in: 99, out: 99 },
				'2026-01-02': { in: 'x', out: 5, models: { m1: { in: 'y', out: 1 } } }
			})
		});
		const usage = m.getDailyUsage();
		expect(Object.keys(usage)).toEqual(['2026-01-02']);
		expect(usage['2026-01-02']).toEqual({ in: 0, out: 5, models: { m1: { in: 0, out: 1 } } });
	});

	it('starts empty when the stored JSON is corrupt', async () => {
		const m = await fresh({ 'jucode-usage-daily': '{oops' });
		expect(m.getDailyUsage()).toEqual({});
	});
});

describe('sumDimension', () => {
	it('aggregates a dimension across days sorted by total desc', async () => {
		const m = await fresh();
		const days: DayUsage[] = [
			{ in: 0, out: 0, models: { a: { in: 10, out: 1 }, b: { in: 1, out: 1 } } },
			{ in: 0, out: 0, models: { b: { in: 100, out: 1 } } },
			{ in: 0, out: 0 } // 旧数据无该维度：跳过
		];
		expect(m.sumDimension(days, 'models')).toEqual([
			['b', { in: 101, out: 2 }],
			['a', { in: 10, out: 1 }]
		]);
	});

	it('returns empty for days without the dimension', async () => {
		const m = await fresh();
		expect(m.sumDimension([{ in: 5, out: 5 }], 'agents')).toEqual([]);
	});
});

describe('collectAgentLabels', () => {
	it('merges labels across days with later days winning', async () => {
		const m = await fresh();
		const days: DayUsage[] = [
			{ in: 0, out: 0, agentLabels: { 'acp:x': 'Old name' } },
			{ in: 0, out: 0 },
			{ in: 0, out: 0, agentLabels: { 'acp:x': 'New name', 'acp:y': 'Why' } }
		];
		expect(m.collectAgentLabels(days)).toEqual({ 'acp:x': 'New name', 'acp:y': 'Why' });
	});
});
