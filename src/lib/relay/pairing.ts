// The PWA's relay pairing state (JuCode-CLI docs/relay-protocol.md §1, §2):
// the computers it is paired with, read from `#pair=` link fragments, and
// this device's own X25519 key (one per browser, used for every computer),
// all in localStorage.

import { fromBase64Url, generateKeyPair, toBase64Url, type KeyPair } from './noise';

export const RELAY_URL = 'wss://app.jucode.net/relay/v1';
const HOSTS_KEY = 'jucode-relay-hosts';
/** The single computer kept before there was a list; moved into it once. */
const LEGACY_HOST_KEY = 'jucode-relay-host';
const ACTIVE_KEY = 'jucode-relay-active';
const DEVICE_KEY = 'jucode-relay-device';

export interface RelayHost {
	host_id: string;
	host_static_pub: string;
	relay: string;
}

/** A paired computer as this browser keeps it. The daemon does not tell
 *  clients its machine name, so it is named here: `name` when the user
 *  renamed it, else 「电脑 {seq}」. */
export interface SavedHost extends RelayHost {
	name: string;
	/** Numbers the default name; stays with the computer. */
	seq: number;
	/** ms */
	added_at: number;
}

export interface PairLink {
	host: RelayHost;
	code: string;
}

/**
 * Parses a pairing link `<origin>/remote#pair=<host_id>.<host_static_pub>.<code>`
 * or its bare fragment; null when absent or malformed. The daemon puts the
 * page on the relay's own origin, so a full link names its relay; a bare
 * fragment falls back to the default relay.
 */
export function parsePairLink(text: string): PairLink | null {
	const hashAt = text.indexOf('#');
	const match = /^#?pair=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9]+)$/.exec(
		hashAt < 0 ? text : text.slice(hashAt)
	);
	if (!match) return null;
	return { host: { host_id: match[1], host_static_pub: match[2], relay: relayOf(text.slice(0, Math.max(hashAt, 0))) }, code: match[3] };
}

/** `https://host[:port]/…` → `wss://host[:port]/relay/v1` (the daemon's `app_origin` inverse). */
function relayOf(page: string): string {
	const url = /^(https?):\/\/([^/?#]+)/.exec(page);
	if (!url) return RELAY_URL;
	return `${url[1] === 'http' ? 'ws' : 'wss'}://${url[2]}/relay/v1`;
}

function read<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

const validHost = <T extends Partial<RelayHost>>(h: T | null | undefined): h is T & RelayHost =>
	!!h?.host_id && !!h.host_static_pub && !!h.relay;

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* storage unavailable: lasts for this visit */
	}
}

/** The paired computers, oldest first. Moves the single computer an older
 *  version kept into the list. */
export function loadHosts(): SavedHost[] {
	const list = read<Partial<SavedHost>[]>(HOSTS_KEY);
	if (Array.isArray(list)) {
		return list.filter(validHost).map((h, i) => ({
			host_id: h.host_id,
			host_static_pub: h.host_static_pub,
			relay: h.relay,
			name: typeof h.name === 'string' ? h.name : '',
			seq: Number.isInteger(h.seq) && h.seq! > 0 ? h.seq! : i + 1,
			added_at: Number(h.added_at) || 0
		}));
	}
	const legacy = read<RelayHost>(LEGACY_HOST_KEY);
	const hosts = validHost(legacy)
		? [{ host_id: legacy.host_id, host_static_pub: legacy.host_static_pub, relay: legacy.relay, name: '', seq: 1, added_at: Date.now() }]
		: [];
	if (hosts.length) write(HOSTS_KEY, hosts);
	try {
		localStorage.removeItem(LEGACY_HOST_KEY);
	} catch {
		/* storage unavailable */
	}
	return hosts;
}

/** The lowest default-name number no saved computer uses. */
export function nextSeq(hosts: Pick<SavedHost, 'seq'>[]): number {
	let seq = 1;
	while (hosts.some((h) => h.seq === seq)) seq++;
	return seq;
}

/** Adds a newly paired computer; pairing one already saved again updates its
 *  key and relay and keeps its name. Returns the saved entry. */
export function addHost(host: RelayHost): SavedHost {
	const hosts = loadHosts();
	const known = hosts.find((h) => h.host_id === host.host_id);
	const saved: SavedHost = known
		? { ...known, host_static_pub: host.host_static_pub, relay: host.relay }
		: { ...host, name: '', seq: nextSeq(hosts), added_at: Date.now() };
	write(
		HOSTS_KEY,
		known ? hosts.map((h) => (h.host_id === host.host_id ? saved : h)) : [...hosts, saved]
	);
	return saved;
}

/** Names a computer here; an empty name goes back to the default one. */
export function renameHost(hostId: string, name: string) {
	write(
		HOSTS_KEY,
		loadHosts().map((h) => (h.host_id === hostId ? { ...h, name: name.trim() } : h))
	);
}

/** Forgets one computer. With none left, this device's key goes too, so a
 *  new pairing starts fresh. */
export function forgetHost(hostId: string) {
	const hosts = loadHosts().filter((h) => h.host_id !== hostId);
	write(HOSTS_KEY, hosts);
	if (hosts.length) return;
	try {
		localStorage.removeItem(DEVICE_KEY);
		localStorage.removeItem(ACTIVE_KEY);
	} catch {
		/* storage unavailable: nothing to forget */
	}
}

/** The computer shown last (a host id, or `lan`). */
export function loadActive(): string | null {
	try {
		return localStorage.getItem(ACTIVE_KEY);
	} catch {
		return null;
	}
}

export function saveActive(id: string) {
	try {
		localStorage.setItem(ACTIVE_KEY, id);
	} catch {
		/* storage unavailable: the first computer next time */
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
