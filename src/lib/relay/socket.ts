// A WebSocket-shaped connection to the local daemon's protocol, carried
// through the JuCode relay inside a Noise IK session (JuCode-CLI
// docs/relay-protocol.md §3.2, §4). DaemonClient uses it in place of a plain
// WebSocket: "open" means the daemon accepted this device, and text frames in
// and out are encrypted and chunked.

import type { SocketLike } from '$lib/daemon';
import { FrameReader, Initiator, sealFrame, type CipherState, type KeyPair } from './noise';

export type RelayErrorKind =
	/** The computer's daemon is not connected to the relay (4404). */
	| 'offline'
	/** The daemon refused this device: its pairing code was wrong or used up. */
	| 'pair-invalid'
	/** The daemon refused this device: not paired, or revoked (also 4401). */
	| 'revoked'
	/** Too many connections (4429). */
	| 'busy'
	/** The daemon ended the stream (4410). */
	| 'closed'
	/** The relay could not be reached, or the stream broke. */
	| 'network'
	/** The daemon's reply could not be read. */
	| 'protocol';

export class RelayError extends Error {
	constructor(
		readonly kind: RelayErrorKind,
		message: string
	) {
		super(message);
	}

	/** Retrying will not help; the user has to pair again. */
	get fatal() {
		return this.kind === 'pair-invalid' || this.kind === 'revoked';
	}
}

export interface RelayOptions {
	/** Relay base, e.g. `wss://app.jucode.net/relay/v1`. */
	relay: string;
	hostId: string;
	hostStatic: Uint8Array;
	device: KeyPair;
	name: string;
	/** One-time pairing code, sent only on the first connection. */
	pair?: string;
	/** Called once the daemon accepted the device (msg 2 `ok:true`). */
	onAccepted?: (reply: { device?: string; name?: string }) => void;
	/** Called with the reason whenever the socket fails or closes. */
	onRelayError?: (error: RelayError) => void;
	/** For tests. */
	WebSocketImpl?: typeof WebSocket;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
const HANDSHAKE_TIMEOUT_MS = 15_000;

export function closeCodeError(code: number, reason: string): RelayError {
	switch (code) {
		case 4404:
			return new RelayError('offline', reason || 'host offline');
		case 4410:
			return new RelayError('closed', reason || 'host closed');
		case 4429:
			return new RelayError('busy', reason || 'too many connections');
		case 4401:
			return new RelayError('revoked', reason || 'unauthorized');
		case 4400:
			return new RelayError('protocol', reason || 'protocol error');
		default:
			return new RelayError('network', reason || `connection closed (${code})`);
	}
}

export class RelaySocket implements SocketLike {
	readyState = CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	/** Why the socket failed or closed, once it has. */
	error: RelayError | null = null;

	#ws: WebSocket;
	#initiator: Initiator;
	#send: CipherState | null = null;
	#reader: FrameReader | null = null;
	#timer: ReturnType<typeof setTimeout>;

	constructor(private opts: RelayOptions) {
		const Impl = opts.WebSocketImpl ?? WebSocket;
		const base = opts.relay.replace(/\/+$/, '');
		this.#ws = new Impl(`${base}/connect?host=${encodeURIComponent(opts.hostId)}`);
		this.#ws.binaryType = 'arraybuffer';
		this.#initiator = new Initiator(opts.device, opts.hostStatic);
		this.#timer = setTimeout(
			() => this.#fail(new RelayError('network', 'handshake timed out')),
			HANDSHAKE_TIMEOUT_MS
		);

		this.#ws.onopen = () => {
			const hello: Record<string, string> = { name: opts.name };
			if (opts.pair) hello.pair = opts.pair;
			this.#ws.send(this.#initiator.writeMessage1(new TextEncoder().encode(JSON.stringify(hello))) as Uint8Array<ArrayBuffer>);
		};
		this.#ws.onmessage = (event) => {
			if (!(event.data instanceof ArrayBuffer)) return this.#fail(new RelayError('protocol', 'unexpected text frame'));
			try {
				this.#receive(new Uint8Array(event.data));
			} catch (e) {
				this.#fail(e instanceof RelayError ? e : new RelayError('protocol', String(e)));
			}
		};
		this.#ws.onerror = () => {
			// A close event (with the relay's code) always follows.
		};
		this.#ws.onclose = (event) => {
			this.#finish(this.error ?? closeCodeError(event.code, event.reason));
		};
	}

	#receive(message: Uint8Array) {
		if (this.#reader) {
			const text = this.#reader.push(message);
			if (text !== null) this.onmessage?.({ data: text });
			return;
		}
		const { payload, transport } = this.#initiator.readMessage2(message);
		let reply: { ok?: boolean; error?: string; device?: string; name?: string };
		try {
			reply = JSON.parse(new TextDecoder().decode(payload));
		} catch {
			throw new RelayError('protocol', 'unreadable handshake reply');
		}
		if (!reply.ok) {
			throw new RelayError(
				this.opts.pair ? 'pair-invalid' : 'revoked',
				reply.error || 'device not authorized'
			);
		}
		clearTimeout(this.#timer);
		this.#send = transport.send;
		this.#reader = new FrameReader(transport.recv);
		this.readyState = OPEN;
		this.opts.onAccepted?.({ device: reply.device, name: reply.name });
		this.onopen?.();
	}

	send(text: string) {
		if (this.readyState !== OPEN || !this.#send) throw new Error('relay socket is not open');
		for (const message of sealFrame(this.#send, text)) this.#ws.send(message as Uint8Array<ArrayBuffer>);
	}

	close() {
		if (this.readyState === CLOSED) return;
		this.#ws.close(1000);
		this.#finish(this.error ?? new RelayError('closed', 'closed'));
	}

	#fail(error: RelayError) {
		this.error ??= error;
		try {
			this.#ws.close(1000);
		} catch {
			/* already closing */
		}
		this.#finish(error);
	}

	#finish(error: RelayError) {
		if (this.readyState === CLOSED) return;
		const wasOpen = this.readyState === OPEN;
		clearTimeout(this.#timer);
		this.readyState = CLOSED;
		this.error ??= error;
		this.opts.onRelayError?.(this.error);
		if (!wasOpen) this.onerror?.();
		this.onclose?.();
	}
}
