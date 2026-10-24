// The web app's relay pairing state (JuCode-CLI docs/relay-protocol.md): the
// computers this browser has connected to (paired), `#pair=` link
// fragments, and this device's own X25519 key (one per browser, used for
// every computer), all in localStorage. Which computers exist comes from
// the account (computers.svelte.ts), not from here.

import { API } from '$lib/web/auth.svelte';
import { fromBase64Url, generateKeyPair, toBase64Url, type KeyPair } from './noise';

/** The relay is part of the API server. */
export const RELAY_URL = `${API.replace(/^http/, 'ws')}/v1/relay`;
const PAIRED_KEY = 'jucode-relay-paired';
const ACTIVE_KEY = 'jucode-relay-active';
const DEVICE_KEY = 'jucode-relay-device';

export interface PairLink {
	hostId: string;
	/** The computer's Noise static key as the link names it (base64url). */
	staticPub: string;
	code: string;
}

/**
 * Parses a pairing link `<origin>/remote#pair=<host_id>.<static_pub>.<code>`
 * or its bare fragment; null when absent or malformed. The link only names
 * the computer and the code: the relay is always this app's own.
 */
export function parsePairLink(text: string): PairLink | null {
	const hashAt = text.indexOf('#');
	const match = /^#?pair=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9]+)$/.exec(
		hashAt < 0 ? text : text.slice(hashAt)
	);
	return match ? { hostId: match[1], staticPub: match[2], code: match[3] } : null;
}

/** Why a pairing link cannot be used with the account's computers (an i18n
 *  key), or null when it can: the computer must be the account's, and its
 *  key in the link the one the account knows. */
export function pairLinkProblem(link: PairLink, computers: { host_id: string; static_pub: string }[]): string | null {
	const computer = computers.find((c) => c.host_id === link.hostId);
	if (!computer) return 'shell.remote.notInAccount';
	if (computer.static_pub !== link.staticPub) return 'shell.remote.keyMismatch';
	return null;
}

function read<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* storage unavailable: lasts for this visit */
	}
}

/** The computers this browser has connected to (their daemons accepted
 *  this device), by host id. */
export function loadPaired(): string[] {
	const list = read<unknown>(PAIRED_KEY);
	return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

export function markPaired(hostId: string) {
	const paired = loadPaired();
	if (!paired.includes(hostId)) write(PAIRED_KEY, [...paired, hostId]);
}

export function unmarkPaired(hostId: string) {
	write(PAIRED_KEY, loadPaired().filter((id) => id !== hostId));
}

/** Signed out: this device's key and its paired marks go, so the next
 *  account starts fresh. */
export function forgetPairing() {
	try {
		localStorage.removeItem(DEVICE_KEY);
		localStorage.removeItem(PAIRED_KEY);
		localStorage.removeItem(ACTIVE_KEY);
	} catch {
		/* storage unavailable: nothing to forget */
	}
}

/** The computer shown last (a host id). */
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
