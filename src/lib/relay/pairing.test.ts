import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addHost,
	deviceKey,
	forgetHost,
	loadActive,
	loadHosts,
	nextSeq,
	parsePairLink,
	renameHost,
	saveActive,
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
const HOST3 = 'CCCCCCCCCCCCCCCCCCCCCC';
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

	it('adds computers to a list and keeps one device key for all of them', () => {
		expect(loadHosts()).toEqual([]);
		const first = addHost({ host_id: HOST, host_static_pub: PUB, relay: RELAY_URL });
		const second = addHost({ host_id: HOST2, host_static_pub: PUB, relay: RELAY_URL });
		expect(first).toMatchObject({ host_id: HOST, name: '', seq: 1 });
		expect(second).toMatchObject({ host_id: HOST2, name: '', seq: 2 });
		expect(loadHosts().map((h) => h.host_id)).toEqual([HOST, HOST2]);
		const key = deviceKey();
		expect(deviceKey().pub).toEqual(key.pub);
	});

	it('updates a computer paired again and keeps its name and place', () => {
		addHost({ host_id: HOST, host_static_pub: PUB, relay: RELAY_URL });
		addHost({ host_id: HOST2, host_static_pub: PUB, relay: RELAY_URL });
		renameHost(HOST, '  Office Mac ');
		const pub = 'C'.repeat(42) + 'A';
		const again = addHost({ host_id: HOST, host_static_pub: pub, relay: 'wss://relay.example.com/relay/v1' });
		expect(again).toMatchObject({ host_id: HOST, host_static_pub: pub, name: 'Office Mac', seq: 1 });
		expect(loadHosts()).toHaveLength(2);
		expect(loadHosts()[0]).toMatchObject({ host_id: HOST, relay: 'wss://relay.example.com/relay/v1' });
		renameHost(HOST, '');
		expect(loadHosts()[0].name).toBe('');
	});

	it('forgets one computer at a time and the device key with the last', () => {
		addHost({ host_id: HOST, host_static_pub: PUB, relay: RELAY_URL });
		addHost({ host_id: HOST2, host_static_pub: PUB, relay: RELAY_URL });
		saveActive(HOST2);
		const key = deviceKey();
		forgetHost(HOST);
		expect(loadHosts().map((h) => h.host_id)).toEqual([HOST2]);
		expect(deviceKey().pub).toEqual(key.pub);
		expect(loadActive()).toBe(HOST2);
		forgetHost(HOST2);
		expect(loadHosts()).toEqual([]);
		expect(loadActive()).toBeNull();
		expect(deviceKey().pub).not.toEqual(key.pub);
	});

	it('reuses the lowest free default number', () => {
		expect(nextSeq([])).toBe(1);
		expect(nextSeq([{ seq: 1 }, { seq: 3 }])).toBe(2);
		addHost({ host_id: HOST, host_static_pub: PUB, relay: RELAY_URL });
		addHost({ host_id: HOST2, host_static_pub: PUB, relay: RELAY_URL });
		forgetHost(HOST);
		expect(addHost({ host_id: HOST3, host_static_pub: PUB, relay: RELAY_URL }).seq).toBe(1);
	});

	it('moves the single computer of an older version into the list', () => {
		const old = { host_id: HOST, host_static_pub: PUB, relay: RELAY_URL };
		store.set('jucode-relay-host', JSON.stringify(old));
		const hosts = loadHosts();
		expect(hosts).toHaveLength(1);
		expect(hosts[0]).toMatchObject({ ...old, name: '', seq: 1 });
		expect(store.has('jucode-relay-host')).toBe(false);
		expect(JSON.parse(store.get('jucode-relay-hosts')!)).toEqual(hosts);
		// The next pairing adds to it.
		addHost({ host_id: HOST2, host_static_pub: PUB, relay: RELAY_URL });
		expect(loadHosts().map((h) => h.host_id)).toEqual([HOST, HOST2]);
	});

	it('ignores broken entries', () => {
		store.set('jucode-relay-host', '{not json');
		expect(loadHosts()).toEqual([]);
		store.set('jucode-relay-hosts', JSON.stringify([{ host_id: HOST }, { host_id: HOST2, host_static_pub: PUB, relay: RELAY_URL }]));
		expect(loadHosts().map((h) => h.host_id)).toEqual([HOST2]);
	});
});
