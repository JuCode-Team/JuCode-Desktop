// The account's computers (GET /v1/oauth/computers): every daemon signed in
// to the same JuCode account, with whether it is online now. Renaming and
// removing go to the account, so every device sees the same names.

import { json } from '$lib/web/api';

export interface Computer {
	host_id: string;
	name: string;
	/** `macos` / `windows` / `linux`. */
	platform: string;
	version: string;
	/** The daemon's Noise static key (base64url): the key a connection
	 *  checks the computer against. */
	static_pub: string;
	online: boolean;
	last_seen_at: string;
	created_at: string;
}

const PLATFORMS: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

export function platformName(platform: string): string {
	return PLATFORMS[platform] ?? platform;
}

const path = (hostId: string) => `/v1/oauth/computers/${encodeURIComponent(hostId)}`;

export class Computers {
	list = $state<Computer[]>([]);
	/** The list arrived at least once. */
	loaded = $state(false);
	/** Why the last refresh failed. */
	error = $state('');

	get(hostId: string): Computer | undefined {
		return this.list.find((c) => c.host_id === hostId);
	}

	async refresh(): Promise<void> {
		try {
			const reply = await json<{ computers?: Computer[] }>('/v1/oauth/computers');
			this.list = reply.computers ?? [];
			this.loaded = true;
			this.error = '';
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			throw e;
		}
	}

	/** An empty name gives the computer back its own (the hostname). */
	async rename(hostId: string, name: string): Promise<void> {
		const next = await json<Computer>(path(hostId), { method: 'PATCH', body: { name: name.trim() } });
		this.list = this.list.map((c) => (c.host_id === hostId ? { ...c, ...next } : c));
	}

	async remove(hostId: string): Promise<void> {
		await json<void>(path(hostId), { method: 'DELETE' });
		this.list = this.list.filter((c) => c.host_id !== hostId);
	}
}
