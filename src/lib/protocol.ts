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

// Events the engine emits on stdout, tagged with the originating session.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}
export interface EventPayload {
	session: string;
	data: string;
}
