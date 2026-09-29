import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
	CHUNK_SIZE,
	FrameReader,
	Initiator,
	generateKeyPair,
	keyPairFromPrivate,
	sealFrame,
	fromBase64Url,
	toBase64Url
} from './noise';
import { respond } from './responder.testing';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('noise IK', () => {
	// cacophony vectors (haskell-cryptography/cacophony, vectors/cacophony.txt).
	it('matches the cacophony Noise_IK_25519_ChaChaPoly_SHA256 vector', () => {
		const prologue = hexToBytes('4a6f686e2047616c74');
		const init = keyPairFromPrivate(hexToBytes('e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1'));
		const resp = keyPairFromPrivate(hexToBytes('4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893'));
		const initiator = new Initiator(
			init,
			resp.pub,
			prologue,
			hexToBytes('893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a')
		);
		const msg1 = initiator.writeMessage1(hexToBytes('4c756477696720766f6e204d69736573'));
		expect(bytesToHex(msg1)).toBe(
			'ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944718da798efbcd91528520204f904b9bd6c7413dccdc214d951e15253e39987f18146e8cd0873654207148333479d4d16c289f0294b29960a72f48e0b7bba2e89083169825e59642148d492020664ccf7'
		);
		const r = respond(
			resp,
			msg1,
			() => hexToBytes('4d757272617920526f746862617264'),
			prologue,
			hexToBytes('bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b')
		);
		expect(bytesToHex(r.msg2)).toBe(
			'95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088435361e70b2ed446e6c9ec387d1d6b3b840f194e373979d241b203c4acafccf5'
		);
		const { payload, transport } = initiator.readMessage2(r.msg2);
		expect(bytesToHex(payload)).toBe('4d757272617920526f746862617264');
		expect(bytesToHex(initiator.handshakeHash)).toBe(
			'0b0f68fb0c27e03ce9b97565995ed4838cc0581b762ef72b062f6a546419fad7'
		);
		const empty = new Uint8Array(0);
		expect(bytesToHex(transport.send.encrypt(empty, hexToBytes('462e20412e20486179656b')))).toBe(
			'050e9f3c8fac16b68dbce8f8c4bfbf6617c897f9ada4aa29aa19c8'
		);
		expect(bytesToHex(transport.recv.decrypt(empty, hexToBytes('344233a6cabb7141d80f3da2fedc311d9646bbb0f505afe403a667')))).toBe(
			'4361726c204d656e676572'
		);
	});

	function handshake() {
		const device = generateKeyPair();
		const host = generateKeyPair();
		const initiator = new Initiator(device, host.pub);
		const msg1 = initiator.writeMessage1(enc.encode(JSON.stringify({ name: 'iPhone', pair: 'ABCD1234' })));
		let seen: { payload: unknown; rs: Uint8Array } | null = null;
		const r = respond(host, msg1, (payload, rs) => {
			seen = { payload: JSON.parse(dec.decode(payload)), rs };
			return enc.encode(JSON.stringify({ ok: true, device: 'd1', name: 'iPhone' }));
		});
		const done = initiator.readMessage2(r.msg2);
		return { device, seen: seen!, done, host: r.transport, initiator, h: r.h };
	}

	it('completes a handshake with a responder', () => {
		const { device, seen, done, initiator, h } = handshake();
		expect(seen.payload).toEqual({ name: 'iPhone', pair: 'ABCD1234' });
		expect(bytesToHex(seen.rs)).toBe(bytesToHex(device.pub));
		expect(JSON.parse(dec.decode(done.payload))).toEqual({ ok: true, device: 'd1', name: 'iPhone' });
		expect(bytesToHex(initiator.handshakeHash)).toBe(bytesToHex(h));
	});

	it('round-trips chunked frames both ways', () => {
		const { done, host } = handshake();
		const big = JSON.stringify({ type: 'x', text: 'é'.repeat(CHUNK_SIZE) + 'a'.repeat(1000) });
		const messages = sealFrame(done.transport.send, big);
		expect(messages.length).toBe(3);
		expect(Math.max(...messages.map((m) => m.length))).toBeLessThanOrEqual(65535);
		const hostReader = new FrameReader(host.recv);
		const results = messages.map((m) => hostReader.push(m));
		expect(results.slice(0, -1)).toEqual([null, null]);
		expect(results.at(-1)).toBe(big);

		const reader = new FrameReader(done.transport.recv);
		for (const frame of ['{"type":"hello"}', '', 'x'.repeat(CHUNK_SIZE)]) {
			const out = sealFrame(host.send, frame).map((m) => reader.push(m));
			expect(out.at(-1)).toBe(frame);
		}
	});

	it('rejects a tampered message', () => {
		const { done, host } = handshake();
		const [message] = sealFrame(done.transport.send, '{"op":"hello"}');
		message[message.length - 1] ^= 1;
		expect(() => new FrameReader(host.recv).push(message)).toThrow();
	});

	it('rejects a message 2 from the wrong host key', () => {
		const device = generateKeyPair();
		const host = generateKeyPair();
		const impostor = generateKeyPair();
		const initiator = new Initiator(device, host.pub);
		const msg1 = initiator.writeMessage1(enc.encode('{}'));
		expect(() => respond(impostor, msg1, () => enc.encode('{}'))).toThrow();
	});

	it('base64url round-trips without padding', () => {
		const key = generateKeyPair().pub;
		const text = toBase64Url(key);
		expect(text).toHaveLength(43);
		expect(text).not.toMatch(/[+/=]/);
		expect(bytesToHex(fromBase64Url(text))).toBe(bytesToHex(key));
	});
});
