// Which session's terminals run something (a command, not an idle shell),
// for the sidebar's terminal mark: each terminal tab says whose it is, and
// a poll asks which shells have a child process (Rust `pty_busy`).
import { ptyBusy } from './protocol';

/** A terminal's owner: the session and the tool tab it is in. */
type Owner = { session: string; tab: string };
const owners = new Map<string, Owner>();

class Terminals {
	/** Per session, the terminals running something, by tab. */
	busy = $state<Record<string, { count: number; tab: string }>>({});
}
export const terminals = new Terminals();

export function ownTerminal(pty: string, owner: Owner) {
	owners.set(pty, owner);
}
export function dropTerminal(pty: string) {
	owners.delete(pty);
}

const POLL_MS = 3000;

/** Polls while the app runs; returns the stop. */
export function watchTerminals(): () => void {
	let stopped = false;
	const poll = async () => {
		const ids = [...owners.keys()];
		const running = ids.length ? await ptyBusy(ids).catch(() => [] as string[]) : [];
		if (stopped) return;
		const busy: Record<string, { count: number; tab: string }> = {};
		for (const id of running) {
			const o = owners.get(id);
			if (!o) continue;
			busy[o.session] = { count: (busy[o.session]?.count ?? 0) + 1, tab: busy[o.session]?.tab ?? o.tab };
		}
		if (JSON.stringify(busy) !== JSON.stringify(terminals.busy)) terminals.busy = busy;
	};
	const timer = setInterval(poll, POLL_MS);
	void poll();
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
