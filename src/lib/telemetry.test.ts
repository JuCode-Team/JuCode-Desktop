import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
	removeItem: (k: string) => store.delete(k)
});
const { prefs } = await import('./prefs.svelte');
const { Telemetry } = await import('./telemetry.svelte');

describe('telemetry', () => {
	beforeEach(() => {
		store.clear();
		prefs.telemetry = true;
	});
	afterEach(() => vi.useRealTimers());

	it('counts by day, sends once, and keeps what arrived meanwhile', async () => {
		const sent: { day: string; events: Record<string, number> }[][] = [];
		let release = () => {};
		const send = vi.fn((_install: string, days: { day: string; events: Record<string, number> }[]) => {
			sent.push(days);
			return new Promise<void>((r) => (release = r));
		});
		const t = new Telemetry();
		t.track('session_start:claude');
		expect(t.start(send)).toBe(true);
		t.track('session_start:claude');
		release();
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		await new Promise((r) => setTimeout(r));
		expect(sent[0][0].events).toEqual({ 'session_start:claude': 1, app_start: 1 });
		const second = t.flush();
		release();
		await second;
		expect(sent[1][0].events).toEqual({ 'session_start:claude': 1 });
		expect(new Telemetry().start(async () => {})).toBe(false);
	});

	it('counts nothing and drops what is kept when turned off', async () => {
		const send = vi.fn(async () => {});
		const t = new Telemetry();
		t.track('requirement_create');
		prefs.telemetry = false;
		t.track('requirement_create');
		t.start(send);
		await t.flush();
		expect(send).not.toHaveBeenCalled();
		expect(JSON.parse(store.get('jucode-telemetry')!).days).toEqual({});
	});

	it('keeps counts when sending fails', async () => {
		const t = new Telemetry();
		t.start(async () => {
			throw new Error('offline');
		});
		await new Promise((r) => setTimeout(r));
		expect(Object.values(JSON.parse(store.get('jucode-telemetry')!).days)[0]).toEqual({ app_start: 1 });
	});
});
