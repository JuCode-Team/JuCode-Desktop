// A release build ships its own jucode (src-tauri/src/app_cli.rs). After an
// app update the daemon still runs the previous one: it is asked to restart
// once no session is running, so no running task is cut off. A daemon too old
// to do that is replaced right away. A development build has no jucode of
// its own: its daemon is stale when the jucode it runs was rebuilt after it
// started (`daemon_stale`), and restarts once idle too.
import { invoke } from '@tauri-apps/api/core';
import { daemon } from './protocol';

/** Versions already handled in this app run (one request per daemon). */
const handled = new Set<string>();

export type DaemonVersionOutcome =
	| { kind: 'current' }
	/** `version` is empty for a development build's rebuilt jucode. */
	| { kind: 'restart-when-idle'; version: string }
	| { kind: 'replaced'; version: string }
	| { kind: 'failed'; version: string; error: string };

export async function checkDaemonVersion(running: string): Promise<DaemonVersionOutcome> {
	const expected = await invoke<string | null>('app_cli_version').catch(() => null);
	if (!expected) {
		if (!(await invoke<boolean>('daemon_stale').catch(() => false))) return { kind: 'current' };
		// Asked again on a later connection, the daemon already waits: a no-op.
		// One too old for that stays: ending it would cut off running turns.
		return daemon.request({ op: 'restart_when_idle' }).then(
			() => ({ kind: 'restart-when-idle', version: '' }),
			(e) => ({ kind: 'failed', version: '', error: String(e) })
		);
	}
	if (running === expected || handled.has(running)) return { kind: 'current' };
	handled.add(running);
	try {
		await daemon.request({ op: 'restart_when_idle' });
		return { kind: 'restart-when-idle', version: expected };
	} catch {
		try {
			await invoke('replace_daemon');
			return { kind: 'replaced', version: expected };
		} catch (e) {
			return { kind: 'failed', version: expected, error: String(e) };
		}
	}
}
