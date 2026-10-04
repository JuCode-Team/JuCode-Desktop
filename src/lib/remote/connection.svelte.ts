// One computer the remote page is connected to: its own daemon connection
// (through the relay, or over the LAN with a device token), with its own
// reconnect backoff, agent directory, projects and open-session routes. The
// page keeps one per paired computer, all live at once, and gives each
// computer's view its own through context.

import { getContext, setContext } from 'svelte';
import { DaemonClient, type DaemonEndpoint, type SocketLike } from '$lib/daemon';
import { AgentDirectory } from '$lib/agents.svelte';
import { Dispatches } from './dispatch.svelte';
import { resubscribe } from './push';
import { provideAgents } from '$lib/agentScope';
import { deviceKey, hostStaticKey, type RelayHost } from '$lib/relay/pairing';
import { RelaySocket, type RelayError, type RelayErrorKind } from '$lib/relay/socket';
import { deviceName, remoteEndpoint } from '$lib/remote';
import { RemoteProjects } from './store.svelte';
import { Requirements, provideRequirements } from '$lib/requirements.svelte';

/** The id of the LAN connection (relay computers use their host id). */
export const LAN_ID = 'lan';
/** How long a connection that looks up has to answer when the page wakes. */
const WAKE_PING_MS = 5000;

type Route = { onFrame: (raw: string) => void; onExit: () => void };

export type ConnectionTone = 'ok' | 'wait' | 'off';

/** How a connection is doing: a tone for its dot, a sentence (`text`) and a
 *  short label (`short`), both i18n keys. */
export function connectionState(
	kind: 'relay' | 'lan',
	status: AgentDirectory['status'],
	error: RelayErrorKind | undefined
): { tone: ConnectionTone; text: string; short: string } {
	if (status === 'on') return { tone: 'ok', text: 'shell.remote.relayConnected', short: 'shell.remote.relayConnected' };
	if (kind === 'lan')
		return status === 'unreachable'
			? { tone: 'off', text: 'shell.remote.disconnected', short: 'shell.remote.disconnected' }
			: { tone: 'wait', text: 'shell.remote.connecting', short: 'shell.remote.connecting' };
	if (!error) return { tone: 'wait', text: 'shell.remote.relayConnecting', short: 'shell.remote.connecting' };
	if (error === 'pair-invalid' || error === 'revoked')
		return { tone: 'off', text: 'shell.remote.relayFatalTitle', short: 'shell.remote.relayFatalTitle' };
	if (error === 'offline') return { tone: 'off', text: 'shell.remote.relayOffline', short: 'shell.remote.hostOffline' };
	if (error === 'busy') return { tone: 'off', text: 'shell.remote.relayBusy', short: 'shell.remote.disconnected' };
	return { tone: 'off', text: 'shell.remote.relayNetwork', short: 'shell.remote.disconnected' };
}

export class HostConnection {
	readonly id: string;
	readonly kind: 'relay' | 'lan';
	readonly daemon: DaemonClient;
	readonly agents: AgentDirectory;
	readonly projects: RemoteProjects;
	readonly dispatches: Dispatches;
	readonly requirements: Requirements;
	/** Why the last relay connection failed (relay only). */
	relayError = $state<RelayError | null>(null);
	/** The daemon accepted this device at least once since the page opened. */
	everConnected = $state(false);
	/** Frames and exits of the sessions open on this computer, by client id. */
	#routes = new Map<string, Route>();
	#socket: SocketLike | null = null;
	#stopped = false;

	constructor(
		id: string,
		kind: 'relay' | 'lan',
		endpoint: () => Promise<DaemonEndpoint>,
		openSocket: (url: string) => SocketLike
	) {
		this.id = id;
		this.kind = kind;
		this.daemon = new DaemonClient(endpoint, (url) => {
			if (this.#stopped) throw new Error('connection stopped');
			this.#socket = openSocket(url);
			return this.#socket;
		});
		this.agents = new AgentDirectory(this.daemon);
		this.projects = new RemoteProjects(this.daemon, this.agents);
		this.dispatches = new Dispatches(this.daemon);
		this.requirements = new Requirements(this.daemon);
		this.everConnected = kind === 'lan';
	}

	/** A paired computer through the relay; `pair` goes along until its
	 *  daemon accepts this device once. */
	static relay(host: RelayHost, pair?: string): HostConnection {
		const device = deviceKey();
		const name = deviceName();
		const conn: HostConnection = new HostConnection(
			host.host_id,
			'relay',
			async () => ({ url: host.relay, token: '' }),
			() =>
				new RelaySocket({
					relay: host.relay,
					hostId: host.host_id,
					hostStatic: hostStaticKey(host),
					device,
					name,
					pair,
					onAccepted: () => {
						pair = undefined;
						conn.relayError = null;
						conn.everConnected = true;
					},
					onRelayError: (error) => {
						if (conn.#stopped) return;
						conn.relayError = error;
						if (error.fatal) conn.agents.stop();
					}
				})
		);
		return conn;
	}

	/** The daemon that served this page, with this device's LAN token. */
	static lan(token: string): HostConnection {
		return new HostConnection(
			LAN_ID,
			'lan',
			async () => remoteEndpoint(token),
			(url) => new WebSocket(url) as unknown as SocketLike
		);
	}

	/** Connects and keeps reconnecting, with backoff, until stopped. */
	start() {
		this.daemon.onEvent = (frame) => {
			this.agents.handle(frame);
			this.projects.handle(frame);
			this.dispatches.handle(frame);
			this.requirements.handle(frame);
		};
		// Notifications keep reaching this phone after the computer restarts
		// or the browser renews its subscription.
		this.daemon.onHello = () => {
			resubscribe(this.daemon).catch(() => {});
		};
		this.daemon.onDisconnect = () => {
			this.agents.disconnected();
			this.projects.reset();
			this.requirements.reset();
		};
		this.daemon.onFrame = (id, raw) => this.#routes.get(id)?.onFrame(raw);
		this.daemon.onExit = (id) => this.#routes.get(id)?.onExit();
		this.agents.start();
	}

	/** The page came back to the foreground. A socket the phone suspended can
	 *  still look open, so a connection that seems up must answer a ping
	 *  within a few seconds or is dropped (and reconnects); one that is down
	 *  retries now instead of waiting out its backoff. */
	async wake() {
		if (this.#stopped) return;
		if (this.agents.status !== 'on') return this.agents.retryNow();
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

	/** Disconnects for good (the computer was forgotten or paired again). */
	stop() {
		this.#stopped = true;
		this.agents.stop();
		this.#socket?.close();
		this.#socket = null;
	}

	/** How the connection is doing (see connectionState). */
	get state() {
		return connectionState(this.kind, this.agents.status, this.relayError?.kind);
	}

	/** Routes daemon frames and exits for session `id` here; returns an unregister. */
	register = (id: string, onFrame: (raw: string) => void, onExit: () => void) => {
		this.#routes.set(id, { onFrame, onExit });
		return () => {
			this.#routes.delete(id);
		};
	};
}

const KEY = Symbol('remote-host');

/** Makes `conn` the computer the components below this one show. */
export function provideHost(conn: HostConnection) {
	setContext(KEY, conn);
	provideAgents(conn.agents);
	provideRequirements(conn.requirements);
}

/** The computer this part of the remote page shows. */
export function useHost(): HostConnection {
	const conn = getContext<HostConnection | undefined>(KEY);
	if (!conn) throw new Error('useHost outside a remote computer view');
	return conn;
}
