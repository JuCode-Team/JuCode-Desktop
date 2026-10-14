// Dev servers the daemon saw an agent start (`dev_servers` frames, see the
// CLI's devservers.rs). A new one is announced in the corner, or opened in
// the built-in browser when the user asked for that.

import { browser } from '$lib/browser.svelte';
import { prefs } from '$lib/prefs.svelte';
import { notices } from '$lib/ui/notices.svelte';
import { t } from '$lib/i18n';

export interface DevServer {
	port: number;
	url: string;
	pid: number;
	name: string;
	/** The daemon session it most likely belongs to. */
	session: string | null;
}

const key = (s: DevServer) => `dev-server:${s.port}:${s.pid}`;

export function parseDevServers(frame: Record<string, unknown>): DevServer[] | null {
	if (frame.type !== 'dev_servers' || !Array.isArray(frame.servers)) return null;
	return frame.servers.flatMap((raw) => {
		const s = raw as Record<string, unknown>;
		if (typeof s.port !== 'number' || typeof s.url !== 'string' || !s.url) return [];
		return [
			{
				port: s.port,
				url: s.url,
				pid: typeof s.pid === 'number' ? s.pid : 0,
				name: typeof s.name === 'string' ? s.name : '',
				session: typeof s.session === 'string' ? s.session : null
			}
		];
	});
}

class DevServers {
	list = $state<DevServer[]>([]);
	/** Servers already shown or announced: a reconnect lists them again. */
	#seen = new Set<string>();
	/** The first list of a connection is what was already up: not announced. */
	#primed = false;

	handle(frame: Record<string, unknown>) {
		const next = parseDevServers(frame);
		if (!next) return;
		const fresh = this.#primed ? next.filter((s) => !this.#seen.has(key(s))) : [];
		for (const s of this.list) if (!next.some((n) => key(n) === key(s))) notices.dismissKey(key(s));
		for (const s of next) this.#seen.add(key(s));
		this.#primed = true;
		this.list = next;
		for (const s of fresh) this.#announce(s);
	}

	disconnected() {
		this.#primed = false;
		this.list = [];
	}

	#announce(s: DevServer) {
		if (prefs.devServerAutoOpen) {
			browser.open(s.url);
			notices.show(t('shell.devServer.opened'), { detail: s.url, key: key(s) });
			return;
		}
		notices.show(t('shell.devServer.started'), {
			detail: s.url,
			key: key(s),
			action: { label: t('shell.devServer.open'), run: () => browser.open(s.url) }
		});
	}
}

export const devServers = new DevServers();
