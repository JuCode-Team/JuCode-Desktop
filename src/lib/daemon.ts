// Client for `jucode daemon` (JuCode-CLI docs/daemon-protocol.md): one
// WebSocket carries every hosted session. To the rest of the desktop a hosted
// session looks like a jucode child process: frames arrive through `onFrame`
// keyed by the desktop session id, `send` writes one op line, and `onExit`
// fires when the session stops or the connection drops — so the existing
// adapter, ChatState and restart logic apply unchanged.
//
// Transport only: the endpoint (URL + token) comes from the caller, so the
// same client can run in the desktop and in a plain browser page.

export const DAEMON_PROTOCOL = 2;

export interface DaemonEndpoint {
	url: string;
	token: string;
}

type Frame = Record<string, unknown>;
type Pending = {
	resolve: (frame: Frame) => void;
	reject: (error: Error) => void;
};

/** The subset of the browser WebSocket the client uses (tests pass a fake). */
export interface SocketLike {
	readyState: number;
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
}

const OPEN = 1;
/** Frames about the daemon as a whole rather than one session's engine. */
const DAEMON_EVENTS = new Set([
	'agents',
	'sessions',
	'message_delivered',
	'questions',
	'actions',
	'report_posted'
]);
const CLOSE_TIMEOUT_MS = 10_000;

export class DaemonClient {
	/** Called with the desktop session id and one raw frame (JSON text). */
	onFrame: (desktopId: string, raw: string) => void = () => {};
	/** Called when a hosted session stops or the connection is lost. */
	onExit: (desktopId: string) => void = () => {};
	/** Daemon-wide frames: agents, sessions, deliveries, questions, pending
	 *  actions and new reports. */
	onEvent: (frame: Record<string, unknown>) => void = () => {};
	/** Called when an established connection is lost. */
	onDisconnect: () => void = () => {};

	#socket: SocketLike | null = null;
	#connecting: Promise<void> | null = null;
	#nextId = 1;
	#pending = new Map<number, Pending>();
	#closing = new Map<string, () => void>();
	#toDaemon = new Map<string, string>();
	#toDesktop = new Map<string, string>();

	constructor(
		private endpoint: () => Promise<DaemonEndpoint>,
		private openSocket: (url: string) => SocketLike = (url) =>
			new WebSocket(url) as unknown as SocketLike
	) {}

	/** Whether the desktop session is hosted by the daemon. */
	owns(desktopId: string): boolean {
		return this.#toDaemon.has(desktopId);
	}

	/** The daemon session backing a desktop session, if any. */
	sessionOf(desktopId: string): string | undefined {
		return this.#toDaemon.get(desktopId);
	}

	/** Creates a daemon session in `cwd` (as `agent`, when given), or
	 *  reopens `resume` (a daemon session id), then watches it. The watch snapshot (startup state and
	 *  transcript) arrives through `onFrame`. */
	async open(desktopId: string, cwd: string, resume?: string, agent?: string): Promise<void> {
		await this.connect();
		const reply = resume
			? await this.request({ op: 'session_open', session: resume })
			: await this.request(agent ? { op: 'session_create', agent } : { op: 'session_create', cwd });
		const session = String(reply.session);
		this.#toDaemon.set(desktopId, session);
		this.#toDesktop.set(session, desktopId);
		this.#write({ op: 'watch', session });
	}

	/** Writes one op line (as composed by the jucode adapter) to the
	 *  desktop session's daemon session. */
	async send(desktopId: string, line: string): Promise<void> {
		const session = this.#toDaemon.get(desktopId);
		if (!session) throw new Error('session is not hosted by the daemon');
		const op = JSON.parse(line) as Frame;
		this.#write({ ...op, session });
	}

	/** Ends the daemon session (the tab was closed or its engine is being
	 *  restarted). Resolves once the daemon reports the engine stopped, so a
	 *  follow-up `open` of the same session does not race the old engine. */
	async close(desktopId: string): Promise<void> {
		const session = this.#toDaemon.get(desktopId);
		if (!session || !this.#socket || this.#socket.readyState !== OPEN) return;
		// Success is the `session_closed` broadcast (no direct reply); an error
		// reply (the session was not open) or the timeout ends the wait too.
		const id = this.#nextId++;
		await new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.#closing.delete(session);
				this.#pending.delete(id);
				resolve();
			};
			const timer = setTimeout(done, CLOSE_TIMEOUT_MS);
			this.#closing.set(session, done);
			this.#pending.set(id, { resolve: done, reject: done });
			try {
				this.#write({ op: 'session_close', session, id });
			} catch {
				done();
			}
		});
	}

	/** Connects if needed; resolves once the daemon has said hello. */
	connect(): Promise<void> {
		if (this.#socket?.readyState === OPEN) return Promise.resolve();
		if (this.#connecting) return this.#connecting;
		this.#connecting = this.endpoint()
			.then(
				({ url, token }) =>
					new Promise<void>((resolve, reject) => {
						const socket = this.openSocket(`${url}?token=${encodeURIComponent(token)}`);
						let greeted = false;
						socket.onmessage = (event) => {
							const frame = parse(event.data);
							if (!frame) return;
							if (!greeted && frame.type === 'hello') {
								greeted = true;
								if (frame.protocol === DAEMON_PROTOCOL) {
									this.#socket = socket;
									resolve();
								} else {
									reject(
										new Error(
											`jucode daemon speaks protocol ${String(frame.protocol)}, this client speaks ${DAEMON_PROTOCOL}`
										)
									);
									socket.close();
								}
								return;
							}
							this.#receive(frame, String(event.data));
						};
						socket.onerror = () => {
							if (!greeted)
								reject(new Error(`cannot reach jucode daemon at ${url} — is it running?`));
						};
						socket.onclose = () => {
							if (!greeted) reject(new Error(`jucode daemon at ${url} refused the connection`));
							if (this.#socket === socket) this.#lost();
						};
					})
			)
			.finally(() => {
				this.#connecting = null;
			});
		return this.#connecting;
	}

	#receive(frame: Frame, raw: string) {
		if (typeof frame.id === 'number' && this.#pending.has(frame.id)) {
			const pending = this.#pending.get(frame.id)!;
			this.#pending.delete(frame.id);
			if (frame.type === 'error') pending.reject(new Error(String(frame.message)));
			else pending.resolve(frame);
			return;
		}
		if (DAEMON_EVENTS.has(String(frame.type))) {
			this.onEvent(frame);
			return;
		}
		const session = typeof frame.session === 'string' ? frame.session : undefined;
		if (!session) return;
		const desktopId = this.#toDesktop.get(session);
		if (frame.type === 'session_closed') {
			this.#closing.get(session)?.();
			if (desktopId) {
				this.#toDaemon.delete(desktopId);
				this.#toDesktop.delete(session);
				this.onExit(desktopId);
			}
			return;
		}
		// `watching` answers our own watch op; everything else is engine output.
		if (desktopId && frame.type !== 'watching') this.onFrame(desktopId, raw);
	}

	/** The connection dropped: every hosted session looks exited to the
	 *  desktop, whose restart logic reopens them on a new connection. */
	#lost() {
		this.#socket = null;
		this.onDisconnect();
		for (const pending of this.#pending.values())
			pending.reject(new Error('connection to jucode daemon lost'));
		this.#pending.clear();
		for (const resolve of this.#closing.values()) resolve();
		const hosted = [...this.#toDaemon.keys()];
		this.#toDaemon.clear();
		this.#toDesktop.clear();
		for (const desktopId of hosted) this.onExit(desktopId);
	}

	/** Sends an op that has no reply of its own (its effect arrives as
	 *  broadcasts), connecting first if needed. */
	async post(op: Frame): Promise<void> {
		await this.connect();
		this.#write(op);
	}

	/** Sends a daemon op and resolves with its reply (rejects on `error`). */
	request(op: Frame): Promise<Frame> {
		const id = this.#nextId++;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			try {
				this.#write({ ...op, id });
			} catch (error) {
				this.#pending.delete(id);
				reject(error as Error);
			}
		});
	}

	#write(frame: Frame) {
		if (!this.#socket || this.#socket.readyState !== OPEN)
			throw new Error('not connected to jucode daemon');
		this.#socket.send(JSON.stringify(frame));
	}
}

function parse(data: unknown): Frame | null {
	try {
		const value = JSON.parse(String(data));
		return value && typeof value === 'object' ? (value as Frame) : null;
	} catch {
		return null;
	}
}
