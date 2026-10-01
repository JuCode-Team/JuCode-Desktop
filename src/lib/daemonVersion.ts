// A release build ships its own jucode (src-tauri/src/app_cli.rs). After an
// app update the daemon still runs the previous one: it is asked to restart
// once no session is running, so no running task is cut off. A daemon too old
// to do that is replaced right away.
import { invoke } from '@tauri-apps/api/core';
import { daemon } from './protocol';

/** Versions already handled in this app run (one request per daemon). */
const handled = new Set<string>();

export type DaemonVersionOutcome =
	| { kind: 'current' }
	| { kind: 'restart-when-idle'; version: string }
	| { kind: 'replaced'; version: string }
	| { kind: 'failed'; version: string; error: string };

export async function checkDaemonVersion(running: string): Promise<DaemonVersionOutcome> {
	const expected = await invoke<string | null>('app_cli_version').catch(() => null);
	if (!expected || running === expected || handled.has(running)) return { kind: 'current' };
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
