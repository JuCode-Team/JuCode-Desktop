// One computer the remote page is connected to: its own daemon connection
// through the relay, with its own reconnect backoff, daemon state, projects
// and open-session routes. The page keeps one per connected computer, all
// live at once, and gives each computer's view its own through context.

import { getContext, setContext } from 'svelte';
import { DaemonClient, type DaemonEndpoint, type SocketLike } from '$lib/daemon';
import { DaemonState } from '$lib/daemonState.svelte';
import { provideDaemonState } from '$lib/daemonScope';
import { RELAY_URL, deviceKey, markPaired, unmarkPaired } from '$lib/relay/pairing';
import { fromBase64Url } from '$lib/relay/noise';
import { RelaySocket, type RelayError, type RelayErrorKind } from '$lib/relay/socket';
import { RemoteProjects } from './store.svelte';
import { loadLists, saveLists } from './cache';
import type { DaemonSessionView } from '$lib/daemonState.svelte';
import type { WorkspaceView } from './store.svelte';
import type { AcpPreset } from '$lib/protocol';

/** A computer's lists as kept on the phone (see cache.ts). */
type Lists = {
	sessions: DaemonSessionView[];
	workspaces: WorkspaceView[];
};

/** How long a connection that looks up has to answer when the page wakes. */
const WAKE_PING_MS = 5000;

type Route = { onFrame: (raw: string) => void; onExit: () => void; onIdleClose?: () => void };

export type ConnectionTone = 'ok' | 'wait' | 'off';

/** Why a refused connection is down, as an i18n key. */
const REFUSED: Partial<Record<RelayErrorKind, string>> = {
	'not-yours': 'shell.remote.notYours',
	'pair-invalid': 'shell.remote.relayPairInvalid',
	revoked: 'shell.remote.relayRevoked',
	'no-desktop': 'shell.remote.noDesktop',
	denied: 'shell.remote.denied',
	expired: 'shell.remote.expired',
	'requests-busy': 'shell.remote.requestsBusy'
};

/** How a connection is doing: a tone for its dot, a sentence (`text`) and a
 *  short label (`short`), both i18n keys. `waiting`: a connect request is
 *  waiting for the computer's answer. */
export function connectionState(
	status: DaemonState['status'],
	error: RelayErrorKind | undefined,
	waiting = false
): { tone: ConnectionTone; text: string; short: string } {
	if (status === 'on') return { tone: 'ok', text: 'shell.remote.relayConnected', short: 'shell.remote.relayConnected' };
	const refused = error && REFUSED[error];
	if (refused) return { tone: 'off', text: refused, short: 'shell.remote.refusedShort' };
	if (waiting) return { tone: 'wait', text: 'shell.remote.requestWaiting', short: 'shell.remote.requestWaitingShort' };
	if (!error || error === 'restarting') return { tone: 'wait', text: 'shell.remote.relayConnecting', short: 'shell.remote.connecting' };
	if (error === 'offline') return { tone: 'off', text: 'shell.remote.relayOffline', short: 'shell.remote.hostOffline' };
	if (error === 'busy') return { tone: 'off', text: 'shell.remote.relayBusy', short: 'shell.remote.disconnected' };
	return { tone: 'off', text: 'shell.remote.relayNetwork', short: 'shell.remote.disconnected' };
}

export class HostConnection {
	readonly id: string;
	readonly daemon: DaemonClient;
	readonly daemonState: DaemonState;
	readonly projects: RemoteProjects;
	/** Why the last relay connection failed. */
	relayError = $state<RelayError | null>(null);
	/** A connect request is waiting for the computer's answer. */
	waiting = $state(false);
	/** The daemon accepted this device at least once since the page opened. */
	everConnected = $state(false);
	/** Frames and exits of the sessions open on this computer, by client id. */
	#routes = new Map<string, Route>();
	#socket: SocketLike | null = null;
	#stopped = false;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#presets: Promise<AcpPreset[]> | null = null;

	constructor(
		id: string,
		endpoint: () => Promise<DaemonEndpoint>,
		openSocket: (url: string) => SocketLike
	) {
		this.id = id;
		this.daemon = new DaemonClient(endpoint, (url) => {
			if (this.#stopped) throw new Error('connection stopped');
			this.#socket = openSocket(url);
			return this.#socket;
		});
		this.daemonState = new DaemonState(this.daemon);
		this.projects = new RemoteProjects(this.daemon, this.daemonState);
		// What this phone saw last shows until the computer is reached.
		const kept = loadLists<Lists>(id);
		if (kept) {
			this.daemonState.sessions = kept.sessions ?? [];
			this.projects.workspaces = kept.workspaces ?? [];
			this.everConnected = true;
		}
	}

	/** A computer of the account through the relay, checked against its
	 *  static key from the account (`staticPub`). `token` gives the account's
	 *  access token for each connection. Until the daemon accepts this device
	 *  once, the first connection carries `pair` (a code), or `request` asks
	 *  the computer's user to let it in. */
	static relay(
		computer: { host_id: string; static_pub: string },
		token: (refresh?: boolean) => Promise<string>,
		name: string,
		admit: { pair?: string; request?: boolean } = {}
	): HostConnection {
		const device = deviceKey();
		const hostStatic = fromBase64Url(computer.static_pub);
		let { pair, request } = admit;
		let bearer = '';
		// A browser cannot see the relay's HTTP 401: a socket that fails
		// before the daemon answers gets one fresh token, so a revoked login
		// signs out instead of retrying on the same token.
		let refreshNext = false;
		let refreshed = false;
		const conn: HostConnection = new HostConnection(
			computer.host_id,
			async () => {
				const refresh = refreshNext && !refreshed;
				refreshNext = false;
				if (refresh) refreshed = true;
				bearer = await token(refresh);
				return { url: RELAY_URL, token: '' };
			},
			() =>
				new RelaySocket({
					relay: RELAY_URL,
					token: bearer,
					hostId: computer.host_id,
					hostStatic,
					device,
					name,
					pair,
					request,
					onWaiting: () => (conn.waiting = true),
					onAccepted: () => {
						refreshed = false;
						pair = request = undefined;
						conn.waiting = false;
						conn.relayError = null;
						conn.everConnected = true;
						markPaired(computer.host_id);
					},
					onRelayError: (error) => {
						if (conn.#stopped) return;
						conn.waiting = false;
						conn.relayError = error;
						if (error.kind === 'network') refreshNext = true;
						// The daemon no longer knows this device: not paired any more.
						if (error.kind === 'revoked') unmarkPaired(computer.host_id);
						if (error.fatal) conn.daemonState.stop();
						// The server restarts: the other one takes over at once.
						else if (error.kind === 'restarting') setTimeout(() => conn.daemonState.retryNow(), 0);
					}
				})
		);
		return conn;
	}

	/** Connects and keeps reconnecting, with backoff, until stopped. */
	start() {
		this.daemon.onEvent = (frame) => {
			this.daemonState.handle(frame);
			this.projects.handle(frame);
			this.#keepLists();
		};
		this.daemon.onDisconnect = () => {
			// The lists stay, as last seen, until the computer is back.
			this.daemonState.disconnected();
			this.projects.reset();
			this.#presets = null;
		};
		this.daemon.onFrame = (id, raw) => this.#routes.get(id)?.onFrame(raw);
		this.daemon.onExit = (id) => this.#routes.get(id)?.onExit();
		this.daemon.onIdleClose = (id) => {
			const route = this.#routes.get(id);
			(route?.onIdleClose ?? route?.onExit)?.();
		};
		this.daemonState.start();
	}

	/** The page came back to the foreground. A socket the phone suspended can
	 *  still look open, so a connection that seems up must answer a ping
	 *  within a few seconds or is dropped (and reconnects); one that is down
	 *  retries now instead of waiting out its backoff. */
	async wake() {
		if (this.#stopped) return;
		if (this.daemonState.status !== 'on') return this.daemonState.retryNow();
		const socket = this.#socket;
		// Any reply counts, an older daemon's error to `ping` included.
		const answered = await Promise.race([
			this.daemon.request({ op: 'ping' }).then(
				() => true,
				() => true
			),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), WAKE_PING_MS))
		]);
		if (!answered && this.#socket === socket) socket?.close();
	}

	/** The computer's built-in ACP agents (`acp_presets`): asked once per
	 *  connection, since the daemon probes their versions to answer. */
	acpPresets(): Promise<AcpPreset[]> {
		this.#presets ??= this.daemon.request({ op: 'acp_presets' }).then((reply) => (reply.presets as AcpPreset[]) ?? []);
		this.#presets.catch(() => (this.#presets = null));
		return this.#presets;
	}

	/** Keeps the lists on the phone, a moment after they last changed. */
	#keepLists() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			const lists: Lists = {
				sessions: this.daemonState.sessions,
				workspaces: this.projects.workspaces
			};
			saveLists(this.id, $state.snapshot(lists));
		}, 1000);
	}

	/** Disconnects for good (closing a waiting request cancels it). */
	stop() {
		this.#stopped = true;
		clearTimeout(this.#saveTimer);
		this.daemonState.stop();
		this.#socket?.close();
		this.#socket = null;
	}

	/** How the connection is doing (see connectionState). */
	get state() {
		return connectionState(this.daemonState.status, this.relayError?.kind, this.waiting);
	}

	/** Routes daemon frames and exits for session `id` here (`onIdleClose`:
	 *  its engine was closed for idleness, see DaemonClient); returns an
	 *  unregister. */
	register = (id: string, onFrame: (raw: string) => void, onExit: () => void, onIdleClose?: () => void) => {
		this.#routes.set(id, { onFrame, onExit, onIdleClose });
		return () => {
			this.#routes.delete(id);
		};
	};
}

const KEY = Symbol('remote-host');

/** Makes `conn` the computer the components below this one show. */
export function provideHost(conn: HostConnection) {
	setContext(KEY, conn);
	provideDaemonState(conn.daemonState);
}

/** The computer this part of the remote page shows. */
export function useHost(): HostConnection {
	const conn = getContext<HostConnection | undefined>(KEY);
	if (!conn) throw new Error('useHost outside a remote computer view');
	return conn;
}
