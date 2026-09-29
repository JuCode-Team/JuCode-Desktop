import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceKey, forgetHost, loadHost, parsePairFragment, saveHost, RELAY_URL } from './pairing';

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
		expect(parsePairFragment(`#pair=${HOST}.${PUB}.ABCD1234`)).toEqual({
			host: { host_id: HOST, host_static_pub: PUB, relay: RELAY_URL },
			code: 'ABCD1234'
		});
		expect(parsePairFragment('')).toBeNull();
		expect(parsePairFragment(`#pair=${HOST}.short.ABCD1234`)).toBeNull();
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
