import { describe, it, expect, vi, beforeEach } from 'vitest';

const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('$lib/browser.svelte', () => ({ browser: { open } }));

import { devServers, parseDevServers } from './devServers.svelte';
import { notices } from './ui/notices.svelte';
import { prefs } from './prefs.svelte';

const frame = (...ports: number[]) => ({
	type: 'dev_servers',
	servers: ports.map((port) => ({ port, url: `http://localhost:${port}/`, pid: port * 10, name: 'node', session: 's1' }))
});

describe('devServers', () => {
	beforeEach(() => {
		devServers.disconnected();
		for (const n of notices.items) notices.dismiss(n.id);
		open.mockClear();
		prefs.devServerAutoOpen = false;
	});

	it('reads the frame and skips malformed entries', () => {
		expect(parseDevServers({ type: 'sessions' })).toBeNull();
		expect(parseDevServers({ type: 'dev_servers', servers: [{ port: 1 }, { port: 2, url: 'http://localhost:2/' }] })).toEqual([
			{ port: 2, url: 'http://localhost:2/', pid: 0, name: '', session: null }
		]);
	});

	it('announces servers that come up after the first list, once', () => {
		devServers.handle(frame(3000));
		expect(notices.items).toHaveLength(0);
		devServers.handle(frame(3000, 5173));
		expect(notices.items.map((n) => n.detail)).toEqual(['http://localhost:5173/']);
		notices.items[0].action?.run();
		expect(open).toHaveBeenCalledWith('http://localhost:5173/');
		// A reconnect lists them again: nothing new.
		devServers.disconnected();
		devServers.handle(frame(3000, 5173));
		devServers.handle(frame(3000, 5173));
		expect(notices.items).toHaveLength(1);
	});

	it('drops the notice of a server that stopped', () => {
		devServers.handle(frame());
		devServers.handle(frame(4100));
		expect(notices.items).toHaveLength(1);
		devServers.handle(frame());
		expect(notices.items).toHaveLength(0);
		expect(devServers.list).toEqual([]);
	});

	it('opens a new server straight away when asked to', () => {
		prefs.devServerAutoOpen = true;
		devServers.handle(frame());
		devServers.handle(frame(4200));
		expect(open).toHaveBeenCalledWith('http://localhost:4200/');
		expect(notices.items[0].action).toBeUndefined();
	});
});

describe('notices', () => {
	it('close by themselves unless the pointer holds them', () => {
		for (const n of notices.items) notices.dismiss(n.id);
		vi.useFakeTimers();
		const a = notices.show('a', { duration: 2000 });
		const b = notices.show('b', { duration: 2000 });
		notices.hold(b);
		vi.advanceTimersByTime(5000);
		expect(notices.items.map((n) => n.id)).toEqual([b]);
		notices.resume(b);
		vi.advanceTimersByTime(2000);
		expect(notices.items).toHaveLength(0);
		expect(a).not.toBe(b);
		vi.useRealTimers();
	});
});
