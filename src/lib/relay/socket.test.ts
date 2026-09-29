import { describe, expect, it, vi } from 'vitest';
import { FrameReader, generateKeyPair, sealFrame, type Transport } from './noise';
import { respond } from './responder.testing';
import { RelaySocket, type RelayError } from './socket';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A fake browser WebSocket; the test plays relay + daemon. */
class FakeWs {
	static last: FakeWs;
	binaryType = 'blob';
	sent: Uint8Array[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	closed = false;
	constructor(readonly url: string) {
		FakeWs.last = this;
	}
	send(data: Uint8Array) {
		this.sent.push(new Uint8Array(data));
	}
	close() {
		this.closed = true;
	}
	deliver(bytes: Uint8Array) {
		this.onmessage?.({ data: bytes.slice().buffer });
	}
	drop(code: number, reason = '') {
		this.onclose?.({ code, reason });
	}
}

function setup(pair?: string, reply: object = { ok: true, device: 'd1', name: 'iPhone' }) {
	const host = generateKeyPair();
	const device = generateKeyPair();
	const errors: RelayError[] = [];
	const accepted = vi.fn();
	const socket = new RelaySocket({
		relay: 'wss://relay.test/relay/v1/',
		hostId: 'H'.repeat(22),
		hostStatic: host.pub,
		device,
		name: 'iPhone',
		pair,
		onAccepted: accepted,
		onRelayError: (e) => errors.push(e),
		WebSocketImpl: FakeWs as unknown as typeof WebSocket
	});
	const ws = FakeWs.last;
	let hello: unknown;
	let daemon: Transport | undefined;
	const handshake = () => {
		ws.onopen?.();
		const r = respond(host, ws.sent[0], (payload) => {
			hello = JSON.parse(dec.decode(payload));
			return enc.encode(JSON.stringify(reply));
		});
		daemon = r.transport;
		ws.deliver(r.msg2);
	};
	return { socket, ws, errors, accepted, handshake, hello: () => hello, daemon: () => daemon! };
}

describe('RelaySocket', () => {
	it('opens after the daemon accepts, then carries encrypted frames', () => {
		const { socket, ws, accepted, handshake, hello, daemon } = setup('ABCD1234');
		expect(ws.url).toBe(`wss://relay.test/relay/v1/connect?host=${'H'.repeat(22)}`);
		expect(ws.binaryType).toBe('arraybuffer');
		const opened = vi.fn();
		socket.onopen = opened;
		const got: unknown[] = [];
		socket.onmessage = (event) => got.push(event.data);
		handshake();
		expect(hello()).toEqual({ name: 'iPhone', pair: 'ABCD1234' });
		expect(socket.readyState).toBe(1);
		expect(opened).toHaveBeenCalledOnce();
		expect(accepted).toHaveBeenCalledWith({ device: 'd1', name: 'iPhone' });

		const big = JSON.stringify({ type: 'hello', protocol: 2, pad: 'x'.repeat(70_000) });
		for (const message of sealFrame(daemon().send, big)) ws.deliver(message);
		expect(got).toEqual([big]);

		socket.send('{"op":"session_list","id":1}');
		const reader = new FrameReader(daemon().recv);
		expect(reader.push(ws.sent[1])).toBe('{"op":"session_list","id":1}');
	});

	it('omits pair when there is no code', () => {
		const { handshake, hello } = setup();
		handshake();
		expect(hello()).toEqual({ name: 'iPhone' });
	});

	it('reports a refused pairing code as fatal', () => {
		const { socket, handshake, errors } = setup('ABCD1234', { ok: false, error: 'bad code' });
		const onclose = vi.fn();
		socket.onclose = onclose;
		handshake();
		expect(socket.readyState).toBe(3);
		expect(errors[0].kind).toBe('pair-invalid');
		expect(errors[0].fatal).toBe(true);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('maps relay close codes', () => {
		for (const [code, kind] of [
			[4404, 'offline'],
			[4410, 'closed'],
			[4429, 'busy'],
			[4401, 'revoked'],
			[1006, 'network']
		] as const) {
			const { ws, errors, socket } = setup();
			const onerror = vi.fn();
			socket.onerror = onerror;
			ws.drop(code);
			expect(errors[0].kind).toBe(kind);
			expect(onerror).toHaveBeenCalledOnce();
		}
	});
});
