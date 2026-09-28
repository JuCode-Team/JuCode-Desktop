import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forgetRemoteToken, pairDevice, remoteEndpoint, remoteToken } from './remote';

const store = new Map<string, string>();
beforeEach(() => {
	store.clear();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
		removeItem: (k: string) => store.delete(k)
	});
	vi.stubGlobal('location', { protocol: 'https:', host: 'mac.tailnet.ts.net' });
});

describe('remote pairing', () => {
	it('keeps the token the daemon returns for a good code', async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify({ token: 'tok', device: 'd1' })));
		vi.stubGlobal('fetch', fetch);
		await pairDevice(' ab12cd34 ', 'iPhone');
		expect(fetch).toHaveBeenCalledWith('/api/pair', expect.objectContaining({ method: 'POST' }));
		const body = JSON.parse(
			(fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		);
		expect(body).toEqual({ code: 'ab12cd34', name: 'iPhone' });
		expect(remoteToken()).toBe('tok');
		forgetRemoteToken();
		expect(remoteToken()).toBeNull();
	});

	it('reports the daemon error for a bad code and keeps nothing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: 'pairing code is wrong or expired' }), {
						status: 403
					})
			)
		);
		await expect(pairDevice('nope', 'x')).rejects.toThrow('wrong or expired');
		expect(remoteToken()).toBeNull();
	});

	it('connects back over the page origin, secure when the page is', () => {
		expect(remoteEndpoint('tok')).toEqual({ url: 'wss://mac.tailnet.ts.net/', token: 'tok' });
	});
});
