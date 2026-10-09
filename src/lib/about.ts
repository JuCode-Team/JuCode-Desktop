// This app's version, the engine it ships and where the logs are, from the
// app's own command (the `app` plugin's getVersion can be left out of a
// capability, which showed the version as … on Windows).
import { invoke } from '@tauri-apps/api/core';

export interface AboutApp {
	version: string;
	cli: string | null;
	os: string;
	arch: string;
	logs: string;
	daemon_log: string;
}

let cached: Promise<AboutApp | null> | null = null;

export function aboutApp(): Promise<AboutApp | null> {
	cached ??= invoke<AboutApp>('about_app').catch(() => null);
	return cached;
}

/** The app version ('' when unknown). */
export async function appVersion(): Promise<string> {
	return (await aboutApp())?.version ?? '';
}

export function openLogsFolder(): Promise<void> {
	return invoke('open_logs_folder');
}
