// Noise_IK_25519_ChaChaPoly_SHA256, initiator side, after the Noise Protocol
// Framework rev 34 (§5 processing rules, §7.5 IK), plus the relay's chunking
// layer (JuCode-CLI docs/relay-protocol.md §4). The daemon is the responder;
// the client knows its static key from the pairing link.

import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';

export const PROTOCOL_NAME = 'Noise_IK_25519_ChaChaPoly_SHA256';
export const PROLOGUE = new TextEncoder().encode('jucode-relay-v1');
/** Largest plaintext chunk per transport message (§4). */
export const CHUNK_SIZE = 65000;
const TAG = 16;
const DH = 32;

export interface KeyPair {
	priv: Uint8Array;
	pub: Uint8Array;
}

export function generateKeyPair(): KeyPair {
	const { secretKey, publicKey } = x25519.keygen();
	return { priv: secretKey, pub: publicKey };
}

export function keyPairFromPrivate(priv: Uint8Array): KeyPair {
	return { priv, pub: x25519.getPublicKey(priv) };
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** HKDF as defined by Noise §4.3 (two outputs are all IK needs). */
function hkdf2(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
	const temp = hmac(sha256, ck, ikm);
	const o1 = hmac(sha256, temp, Uint8Array.of(1));
	const o2 = hmac(sha256, temp, concat(o1, Uint8Array.of(2)));
	return [o1, o2];
}

/** A CipherState (§5.1): key + 64-bit counter nonce, ChaChaPoly with the
 *  nonce as 32 zero bits then the counter little-endian. */
export class CipherState {
	#k: Uint8Array | null;
	#n = 0n;

	constructor(k: Uint8Array | null = null) {
		this.#k = k;
	}

	get hasKey() {
		return this.#k !== null;
	}

	#nonce(): Uint8Array {
		if (this.#n >= 0xffffffffffffffffn) throw new Error('noise: nonce exhausted');
		const nonce = new Uint8Array(12);
		new DataView(nonce.buffer).setBigUint64(4, this.#n, true);
		return nonce;
	}

	encrypt(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
		if (!this.#k) return plaintext;
		const out = chacha20poly1305(this.#k, this.#nonce(), ad).encrypt(plaintext);
		this.#n++;
		return out;
	}

	/** Throws on a bad tag; the nonce only advances on success. */
	decrypt(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
		if (!this.#k) return ciphertext;
		const out = chacha20poly1305(this.#k, this.#nonce(), ad).decrypt(ciphertext);
		this.#n++;
		return out;
	}
}

/** The SymmetricState (§5.2). Exported for the test's responder. */
export class SymmetricState {
	ck: Uint8Array;
	h: Uint8Array;
	#cipher = new CipherState();

	constructor(protocolName = PROTOCOL_NAME) {
		const name = new TextEncoder().encode(protocolName);
		this.h = name.length <= 32 ? concat(name, new Uint8Array(32 - name.length)) : sha256(name);
		this.ck = this.h;
	}

	mixKey(ikm: Uint8Array) {
		const [ck, k] = hkdf2(this.ck, ikm);
		this.ck = ck;
		this.#cipher = new CipherState(k);
	}

	mixHash(data: Uint8Array) {
		this.h = sha256(concat(this.h, data));
	}

	encryptAndHash(plaintext: Uint8Array): Uint8Array {
		const c = this.#cipher.encrypt(this.h, plaintext);
		this.mixHash(c);
		return c;
	}

	decryptAndHash(ciphertext: Uint8Array): Uint8Array {
		const p = this.#cipher.decrypt(this.h, ciphertext);
		this.mixHash(ciphertext);
		return p;
	}

	/** Returns the (first-to-second, second-to-first) cipher states. */
	split(): [CipherState, CipherState] {
		const [k1, k2] = hkdf2(this.ck, new Uint8Array(0));
		return [new CipherState(k1), new CipherState(k2)];
	}
}

/** One direction pair after the handshake. */
export interface Transport {
	send: CipherState;
	recv: CipherState;
}

/** The IK initiator: `-> e, es, s, ss` then `<- e, ee, se`. */
export class Initiator {
	#ss: SymmetricState;
	#s: KeyPair;
	#rs: Uint8Array;
	#e: KeyPair;
	#sent = false;

	/** `ephemeral` is for test vectors only; normally a fresh key is drawn. */
	constructor(s: KeyPair, rs: Uint8Array, prologue: Uint8Array = PROLOGUE, ephemeral?: Uint8Array) {
		if (rs.length !== DH) throw new Error('noise: remote static key must be 32 bytes');
		this.#s = s;
		this.#rs = rs;
		this.#e = ephemeral ? keyPairFromPrivate(ephemeral) : generateKeyPair();
		this.#ss = new SymmetricState();
		this.#ss.mixHash(prologue);
		this.#ss.mixHash(rs); // pre-message `<- s`
	}

	/** The handshake hash (channel binding; test vectors check it). */
	get handshakeHash() {
		return this.#ss.h;
	}

	writeMessage1(payload: Uint8Array): Uint8Array {
		if (this.#sent) throw new Error('noise: message 1 already written');
		this.#sent = true;
		const ss = this.#ss;
		ss.mixHash(this.#e.pub);
		ss.mixKey(x25519.getSharedSecret(this.#e.priv, this.#rs));
		const s = ss.encryptAndHash(this.#s.pub);
		ss.mixKey(x25519.getSharedSecret(this.#s.priv, this.#rs));
		return concat(this.#e.pub, s, ss.encryptAndHash(payload));
	}

	readMessage2(message: Uint8Array): { payload: Uint8Array; transport: Transport } {
		if (!this.#sent) throw new Error('noise: message 1 not written yet');
		if (message.length < DH + TAG) throw new Error('noise: message 2 too short');
		const ss = this.#ss;
		const re = message.subarray(0, DH);
		ss.mixHash(re);
		ss.mixKey(x25519.getSharedSecret(this.#e.priv, re));
		ss.mixKey(x25519.getSharedSecret(this.#s.priv, re));
		const payload = ss.decryptAndHash(message.subarray(DH));
		const [send, recv] = ss.split();
		return { payload, transport: { send, recv } };
	}
}

const EMPTY = new Uint8Array(0);

/** Encrypts one daemon frame (UTF-8 text) as one or more transport messages. */
export function sealFrame(send: CipherState, text: string): Uint8Array[] {
	const bytes = new TextEncoder().encode(text);
	const out: Uint8Array[] = [];
	let at = 0;
	do {
		const chunk = bytes.subarray(at, at + CHUNK_SIZE);
		at += chunk.length;
		const more = at < bytes.length ? 1 : 0;
		out.push(send.encrypt(EMPTY, concat(Uint8Array.of(more), chunk)));
	} while (at < bytes.length);
	return out;
}

/** Reassembles frames from transport messages: feed each message in order;
 *  returns the frame text when its last chunk arrives, else null. Throws
 *  when a message fails to decrypt. */
export class FrameReader {
	#recv: CipherState;
	#parts: Uint8Array[] = [];
	#decoder = new TextDecoder('utf-8', { fatal: true });

	constructor(recv: CipherState) {
		this.#recv = recv;
	}

	push(message: Uint8Array): string | null {
		const plain = this.#recv.decrypt(EMPTY, message);
		if (plain.length === 0) throw new Error('noise: empty chunk');
		const flag = plain[0];
		if (flag !== 0 && flag !== 1) throw new Error('noise: bad chunk flag');
		this.#parts.push(plain.subarray(1));
		if (flag === 1) return null;
		const whole = concat(...this.#parts);
		this.#parts = [];
		return this.#decoder.decode(whole);
	}
}

export function toBase64Url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
