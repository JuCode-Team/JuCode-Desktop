// The PWA's relay pairing state (JuCode-CLI docs/relay-protocol.md §1, §2):
// the computer it pairs with, read from the `#pair=` link fragment, and this
// device's own X25519 key, both in localStorage.

import { fromBase64Url, generateKeyPair, toBase64Url, type KeyPair } from './noise';

export const RELAY_URL = 'wss://app.jucode.net/relay/v1';
const HOST_KEY = 'jucode-relay-host';
const DEVICE_KEY = 'jucode-relay-device';

export interface RelayHost {
	host_id: string;
	host_static_pub: string;
	relay: string;
}

export interface PairLink {
	host: RelayHost;
	code: string;
}

/** Parses `#pair=<host_id>.<host_static_pub>.<code>`; null when absent or malformed. */
export function parsePairFragment(hash: string): PairLink | null {
	const match = /^#?pair=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9]+)$/.exec(hash);
	if (!match) return null;
	return { host: { host_id: match[1], host_static_pub: match[2], relay: RELAY_URL }, code: match[3] };
}

function read<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

export function loadHost(): RelayHost | null {
	const host = read<RelayHost>(HOST_KEY);
	return host?.host_id && host.host_static_pub && host.relay ? host : null;
}

export function saveHost(host: RelayHost) {
	localStorage.setItem(HOST_KEY, JSON.stringify(host));
}

/** Forgets the paired computer and this device's key (a new pairing starts fresh). */
export function forgetHost() {
	try {
		localStorage.removeItem(HOST_KEY);
		localStorage.removeItem(DEVICE_KEY);
	} catch {
		/* storage unavailable: nothing to forget */
	}
}

/** This device's static key, created on first use. */
export function deviceKey(): KeyPair {
	const saved = read<{ priv: string; pub: string }>(DEVICE_KEY);
	if (saved?.priv && saved.pub) return { priv: fromBase64Url(saved.priv), pub: fromBase64Url(saved.pub) };
	const pair = generateKeyPair();
	localStorage.setItem(DEVICE_KEY, JSON.stringify({ priv: toBase64Url(pair.priv), pub: toBase64Url(pair.pub) }));
	return pair;
}

export function hostStaticKey(host: RelayHost): Uint8Array {
	return fromBase64Url(host.host_static_pub);
}
