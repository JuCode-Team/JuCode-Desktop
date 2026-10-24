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
	constructor(
		readonly url: string,
		readonly protocols?: string[]
	) {
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

function setup(pair?: string, reply: object = { ok: true, device: 'd1', name: 'iPhone' }, request = false) {
	const host = generateKeyPair();
	const device = generateKeyPair();
	const errors: RelayError[] = [];
	const accepted = vi.fn();
	const waiting = vi.fn();
	const socket = new RelaySocket({
		relay: 'wss://api.test/v1/relay/',
		token: 'tok',
		hostId: 'H'.repeat(22),
		hostStatic: host.pub,
		device,
		name: 'iPhone',
		pair,
		request,
		onWaiting: waiting,
		onAccepted: accepted,
		onRelayError: (e) => errors.push(e),
		WebSocketImpl: FakeWs as unknown as typeof WebSocket
	});
	const ws = FakeWs.last;
	let hello: unknown;
	let daemon: Transport | undefined;
	const sendHello = () => ws.onopen?.();
	const answer = () => {
		const r = respond(host, ws.sent[0], (payload) => {
			hello = JSON.parse(dec.decode(payload));
			return enc.encode(JSON.stringify(reply));
		});
		daemon = r.transport;
		ws.deliver(r.msg2);
	};
	const handshake = () => {
		sendHello();
		answer();
	};
	return { socket, ws, errors, accepted, waiting, sendHello, answer, handshake, hello: () => hello, daemon: () => daemon! };
}

describe('RelaySocket', () => {
	it('opens after the daemon accepts, then carries encrypted frames', () => {
		const { socket, ws, accepted, handshake, hello, daemon } = setup('ABCD1234');
		expect(ws.url).toBe(`wss://api.test/v1/relay/connect?host=${'H'.repeat(22)}`);
		// Browsers cannot set headers on a WebSocket: the token rides as a subprotocol.
		expect(ws.protocols).toEqual(['jucode-relay', 'jucode-bearer.tok']);
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

	it('asks the computer to let the device in, and waits for its answer', () => {
		vi.useFakeTimers();
		try {
			const { socket, sendHello, answer, hello, waiting, accepted, errors } = setup(undefined, { ok: true, device: 'd1' }, true);
			sendHello();
			expect(hello()).toBeUndefined();
			expect(waiting).toHaveBeenCalledOnce();
			// Longer than an ordinary handshake: the user is deciding.
			vi.advanceTimersByTime(60_000);
			expect(errors).toEqual([]);
			answer();
			expect(hello()).toEqual({ name: 'iPhone', request: true });
			expect(socket.readyState).toBe(1);
			expect(accepted).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up on an unanswered request after 130 s, an ordinary handshake after 15 s', () => {
		vi.useFakeTimers();
		try {
			const asked = setup(undefined, {}, true);
			asked.sendHello();
			vi.advanceTimersByTime(129_000);
			expect(asked.errors).toEqual([]);
			vi.advanceTimersByTime(1_000);
			expect(asked.errors[0].kind).toBe('expired');
			expect(asked.ws.closed).toBe(true);

			const plain = setup();
			plain.sendHello();
			vi.advanceTimersByTime(15_000);
			expect(plain.errors[0].kind).toBe('network');
		} finally {
			vi.useRealTimers();
		}
	});

	it('sends a pairing code instead of a request when it has one', () => {
		const { handshake, hello, waiting } = setup('ABCD1234', { ok: true }, true);
		handshake();
		expect(hello()).toEqual({ name: 'iPhone', pair: 'ABCD1234' });
		expect(waiting).not.toHaveBeenCalled();
	});

	it('reports why the computer refused, all of them fatal', () => {
		for (const [error, kind] of [
			['no_desktop', 'no-desktop'],
			['denied', 'denied'],
			['expired', 'expired'],
			['busy', 'requests-busy'],
			['wrong account', 'not-yours'],
			['not paired', 'revoked']
		] as const) {
			const { handshake, errors, socket } = setup(undefined, { ok: false, error }, true);
			handshake();
			expect(socket.readyState).toBe(3);
			expect(errors[0].kind).toBe(kind);
			expect(errors[0].fatal).toBe(true);
		}
	});

	it('maps relay close codes', () => {
		for (const [code, kind] of [
			[4404, 'offline'],
			[4403, 'not-yours'],
			[4410, 'closed'],
			[4429, 'busy'],
			[4503, 'restarting'],
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
