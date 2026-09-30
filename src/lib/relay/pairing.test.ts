import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceKey, forgetHost, loadHost, parsePairLink, saveHost, RELAY_URL } from './pairing';

const store = new Map<string, string>();
beforeEach(() => {
	store.clear();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
		removeItem: (k: string) => store.delete(k)
	});
});

const HOST = 'AAAAAAAAAAAAAAAAAAAAAA';
const PUB = 'B'.repeat(42) + 'A';

describe('relay pairing', () => {
	it('parses a pairing fragment', () => {
		expect(parsePairLink(`#pair=${HOST}.${PUB}.ABCD1234`)).toEqual({
			host: { host_id: HOST, host_static_pub: PUB, relay: RELAY_URL },
			code: 'ABCD1234'
		});
		expect(parsePairLink('')).toBeNull();
		expect(parsePairLink(`#pair=${HOST}.short.ABCD1234`)).toBeNull();
	});

	it('takes the relay from the link origin', () => {
		const link = (origin: string) => parsePairLink(`${origin}/remote#pair=${HOST}.${PUB}.ABCD1234`)?.host.relay;
		expect(link('https://relay.example.com')).toBe('wss://relay.example.com/relay/v1');
		expect(link('http://192.168.1.5:8080')).toBe('ws://192.168.1.5:8080/relay/v1');
		expect(link('https://app.jucode.net')).toBe(RELAY_URL);
	});

	it('keeps the host and a stable device key until forgotten', () => {
		saveHost({ host_id: HOST, host_static_pub: PUB, relay: RELAY_URL });
		expect(loadHost()?.host_id).toBe(HOST);
		const key = deviceKey();
		expect(deviceKey().pub).toEqual(key.pub);
		forgetHost();
		expect(loadHost()).toBeNull();
		expect(deviceKey().pub).not.toEqual(key.pub);
	});
});
