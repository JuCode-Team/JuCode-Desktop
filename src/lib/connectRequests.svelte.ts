// Phones and browsers of the same JuCode account asking to connect to this
// computer (JuCode-CLI docs/relay-protocol.md): the daemon tells its local
// clients of each request (`connect_request`) and of its end
// (`connect_request_closed`), and waits up to 120 s for one of them to
// decide (`connect_decide`). A desktop that connects after a request was
// made asks for the open ones (`connect_requests`).

import { daemon as sharedDaemon } from './protocol';
import type { DaemonClient } from './daemon';

export interface ConnectRequest {
	id: string;
	/** The device's name as it gave it. */
	name: string;
	/** Its OAuth client: `jucode-mobile`, `jucode-web` or `jucode-cli`. */
	client: string;
	/** ms */
	at: number;
}

function parse(raw: unknown): ConnectRequest | null {
	const r = raw as Partial<ConnectRequest> | null;
	if (!r || typeof r.id !== 'string') return null;
	return { id: r.id, name: typeof r.name === 'string' ? r.name : '', client: typeof r.client === 'string' ? r.client : '', at: Number(r.at) || 0 };
}

/** The i18n key naming a kind of client (empty when unknown). */
export function clientKind(client: string | undefined): string {
	return client === 'jucode-mobile'
		? 'settings.backend.clientMobile'
		: client === 'jucode-web'
			? 'settings.backend.clientWeb'
			: client === 'jucode-cli'
				? 'settings.backend.clientDesktop'
				: '';
}

export class ConnectRequests {
	/** Open requests, oldest first. */
	open = $state<ConnectRequest[]>([]);
	/** A new request arrived (the app shows an OS notification). */
	onRequest: ((request: ConnectRequest) => void) | null = null;
	#daemon: DaemonClient;

	constructor(daemon: DaemonClient = sharedDaemon) {
		this.#daemon = daemon;
	}

	/** A daemon-wide frame (wired to the daemon's `onEvent`). */
	handle(frame: Record<string, unknown>) {
		if (frame.type === 'connect_request') {
			const request = parse(frame);
			if (!request || this.open.some((r) => r.id === request.id)) return;
			this.open = [...this.open, request];
			this.onRequest?.(request);
		} else if (frame.type === 'connect_request_closed' && typeof frame.id === 'string') {
			this.open = this.open.filter((r) => r.id !== frame.id);
		}
	}

	/** Takes the daemon's open requests (on each connection). A daemon
	 *  without the op leaves the list as it is. */
	async sync() {
		try {
			const reply = await this.#daemon.request({ op: 'connect_requests' });
			if (!Array.isArray(reply.requests)) return;
			this.open = reply.requests.map(parse).filter((r): r is ConnectRequest => r !== null);
		} catch {
			/* an older daemon, or the connection dropped: nothing to show */
		}
	}

	/** Allows or denies a request. It leaves the list at once; the daemon
	 *  closes it for every client. */
	async decide(id: string, allow: boolean) {
		this.open = this.open.filter((r) => r.id !== id);
		await this.#daemon.request({ op: 'connect_decide', request: id, allow });
	}
}

export const connectRequests = new ConnectRequests();
