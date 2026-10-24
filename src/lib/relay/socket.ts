// A WebSocket-shaped connection to the local daemon's protocol, carried
// through the JuCode relay inside a Noise IK session (JuCode-CLI
// docs/relay-protocol.md). DaemonClient uses it in place of a plain
// WebSocket: "open" means the daemon accepted this device, and text frames in
// and out are encrypted and chunked. The relay socket carries the account's
// access token as a subprotocol (browsers cannot set headers on it).

import type { SocketLike } from '$lib/daemon';
import { FrameReader, Initiator, sealFrame, type CipherState, type KeyPair } from './noise';

export type RelayErrorKind =
	/** The computer's daemon is not connected to the relay (4404). */
	| 'offline'
	/** The computer belongs to another account (4403, or the daemon said
	 *  `wrong account`). */
	| 'not-yours'
	/** The daemon refused this device: its pairing code was wrong or used up. */
	| 'pair-invalid'
	/** The daemon refused this device: not paired, or revoked. */
	| 'revoked'
	/** Asked to connect, but no JuCode window is open on the computer. */
	| 'no-desktop'
	/** The computer's user turned the request down. */
	| 'denied'
	/** Nobody answered the request in time. */
	| 'expired'
	/** The computer has too many requests waiting. */
	| 'requests-busy'
	/** Too many connections (4429). */
	| 'busy'
	/** The daemon ended the stream (4410). */
	| 'closed'
	/** The server is restarting (4503): reconnect right away. */
	| 'restarting'
	/** The relay could not be reached, or the stream broke. */
	| 'network'
	/** The daemon's reply could not be read. */
	| 'protocol';

const FATAL = new Set<RelayErrorKind>(['not-yours', 'pair-invalid', 'revoked', 'no-desktop', 'denied', 'expired', 'requests-busy']);

export class RelayError extends Error {
	constructor(
		readonly kind: RelayErrorKind,
		message: string
	) {
		super(message);
	}

	/** Retrying on its own will not help; the user has to act. */
	get fatal() {
		return FATAL.has(this.kind);
	}
}

export interface RelayOptions {
	/** Relay base, e.g. `wss://api.jucode.net/v1/relay`. */
	relay: string;
	/** The signed-in account's access token. */
	token: string;
	hostId: string;
	hostStatic: Uint8Array;
	device: KeyPair;
	name: string;
	/** One-time pairing code, sent only on the first connection. */
	pair?: string;
	/** Ask the computer to let this device in (its user decides there). */
	request?: boolean;
	/** Called once the request is on its way to the computer (request mode). */
	onWaiting?: () => void;
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
/** The computer's user has 120 s to answer a request. */
const REQUEST_TIMEOUT_MS = 130_000;

export function closeCodeError(code: number, reason: string): RelayError {
	switch (code) {
		case 4404:
			return new RelayError('offline', reason || 'host offline');
		case 4403:
			return new RelayError('not-yours', reason || 'not your computer');
		case 4410:
			return new RelayError('closed', reason || 'host closed');
		case 4429:
			return new RelayError('busy', reason || 'too many connections');
		case 4503:
			return new RelayError('restarting', reason || 'server restarting');
		case 4400:
			return new RelayError('protocol', reason || 'protocol error');
		default:
			return new RelayError('network', reason || `connection closed (${code})`);
	}
}

/** What the daemon's refusal (msg 2 `ok:false`) means for this device. */
export function refusalError(error: string | undefined, pairing: boolean): RelayError {
	const kind: RelayErrorKind | undefined = (
		{
			no_desktop: 'no-desktop',
			denied: 'denied',
			expired: 'expired',
			busy: 'requests-busy',
			'wrong account': 'not-yours'
		} as const
	)[error ?? ''];
	return new RelayError(kind ?? (pairing ? 'pair-invalid' : 'revoked'), error || 'device not authorized');
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
		this.#ws = new Impl(`${base}/connect?host=${encodeURIComponent(opts.hostId)}`, ['jucode-relay', `jucode-bearer.${opts.token}`]);
		this.#ws.binaryType = 'arraybuffer';
		this.#initiator = new Initiator(opts.device, opts.hostStatic);
		this.#timer = setTimeout(
			() => this.#fail(new RelayError(opts.request ? 'expired' : 'network', 'handshake timed out')),
			opts.request ? REQUEST_TIMEOUT_MS : HANDSHAKE_TIMEOUT_MS
		);

		this.#ws.onopen = () => {
			const hello: Record<string, string | boolean> = { name: opts.name };
			if (opts.pair) hello.pair = opts.pair;
			else if (opts.request) hello.request = true;
			this.#ws.send(this.#initiator.writeMessage1(new TextEncoder().encode(JSON.stringify(hello))) as Uint8Array<ArrayBuffer>);
			if (!opts.pair && opts.request) opts.onWaiting?.();
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
		if (!reply.ok) throw refusalError(reply.error, !!this.opts.pair);
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
