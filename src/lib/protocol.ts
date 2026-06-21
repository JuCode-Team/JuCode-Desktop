import { invoke } from '@tauri-apps/api/core';

// Commands the GUI sends to a session's `jucode serve` over stdin.
export type Op =
	| { op: 'user_message'; content: string; images?: string[] }
	| { op: 'command'; input: string }
	| { op: 'steer' }
	| { op: 'interrupt' }
	| { op: 'shutdown' };

export function createSession(session: string): Promise<void> {
	return invoke('create_session', { session });
}

export function closeSession(session: string): Promise<void> {
	return invoke('close_session', { session });
}

export function sendOp(session: string, op: Op): Promise<void> {
	return invoke('send_op', { session, op });
}

// Config / auth (read & write ~/.jucode/{config.json,auth.json} via Tauri fs).
export function readConfig(): Promise<Record<string, unknown>> {
	return invoke('read_config');
}
export function writeConfig(patch: Record<string, unknown>): Promise<void> {
	return invoke('write_config', { patch });
}
export function readAuthProviders(): Promise<string[]> {
	return invoke('read_auth_providers');
}
export function setAuthKey(provider: string, key: string): Promise<void> {
	return invoke('set_auth_key', { provider, key });
}

// Events the engine emits on stdout, tagged with the originating session.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}
export interface EventPayload {
	session: string;
	data: string;
}
