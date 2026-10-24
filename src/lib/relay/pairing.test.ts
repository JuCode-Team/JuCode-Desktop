import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deviceKey,
	forgetPairing,
	loadActive,
	loadPaired,
	markPaired,
	pairLinkProblem,
	parsePairLink,
	saveActive,
	unmarkPaired,
	RELAY_URL
} from './pairing';

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
const HOST2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const PUB = 'B'.repeat(42) + 'A';
const OTHER_PUB = 'C'.repeat(42) + 'A';

describe('relay pairing', () => {
	it('connects through the API server', () => {
		expect(RELAY_URL).toBe('wss://api.jucode.net/v1/relay');
	});

	it('parses a pairing link or its bare fragment', () => {
		const want = { hostId: HOST, staticPub: PUB, code: 'ABCD1234' };
		expect(parsePairLink(`#pair=${HOST}.${PUB}.ABCD1234`)).toEqual(want);
		expect(parsePairLink(`pair=${HOST}.${PUB}.ABCD1234`)).toEqual(want);
		expect(parsePairLink(`https://app.jucode.net/remote#pair=${HOST}.${PUB}.ABCD1234`)).toEqual(want);
		// The link's origin does not choose the relay.
		expect(parsePairLink(`https://elsewhere.example/remote#pair=${HOST}.${PUB}.ABCD1234`)).toEqual(want);
	});

	it('rejects malformed links', () => {
		expect(parsePairLink('')).toBeNull();
		expect(parsePairLink('https://app.jucode.net/remote')).toBeNull();
		expect(parsePairLink(`#pair=${HOST}.short.ABCD1234`)).toBeNull();
		expect(parsePairLink(`#pair=${HOST}.${PUB}.`)).toBeNull();
		expect(parsePairLink(`#pair=${HOST}.${PUB}.AB-CD`)).toBeNull();
	});

	it('accepts a link only for an account computer with the same key', () => {
		const link = parsePairLink(`#pair=${HOST}.${PUB}.ABCD1234`)!;
		expect(pairLinkProblem(link, [{ host_id: HOST, static_pub: PUB }])).toBeNull();
		expect(pairLinkProblem(link, [{ host_id: HOST2, static_pub: PUB }])).toBe('shell.remote.notInAccount');
		expect(pairLinkProblem(link, [])).toBe('shell.remote.notInAccount');
		expect(pairLinkProblem(link, [{ host_id: HOST, static_pub: OTHER_PUB }])).toBe('shell.remote.keyMismatch');
	});

	it('marks the computers this browser connected to', () => {
		expect(loadPaired()).toEqual([]);
		markPaired(HOST);
		markPaired(HOST2);
		markPaired(HOST);
		expect(loadPaired()).toEqual([HOST, HOST2]);
		unmarkPaired(HOST);
		expect(loadPaired()).toEqual([HOST2]);
	});

	it('ignores unreadable marks', () => {
		store.set('jucode-relay-paired', '{not json');
		expect(loadPaired()).toEqual([]);
		store.set('jucode-relay-paired', JSON.stringify([HOST, 3, null]));
		expect(loadPaired()).toEqual([HOST]);
	});

	it('keeps one device key, and forgets it with the marks on sign-out', () => {
		const key = deviceKey();
		expect(deviceKey().pub).toEqual(key.pub);
		markPaired(HOST);
		saveActive(HOST);
		expect(loadActive()).toBe(HOST);
		forgetPairing();
		expect(loadPaired()).toEqual([]);
		expect(loadActive()).toBeNull();
		expect(deviceKey().pub).not.toEqual(key.pub);
	});
});
