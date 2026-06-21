import { invoke } from '@tauri-apps/api/core';

// Commands the GUI sends to `jucode serve` over stdin.
export type Op =
	| { op: 'user_message'; content: string; images?: string[] }
	| { op: 'command'; input: string }
	| { op: 'steer' }
	| { op: 'interrupt' }
	| { op: 'shutdown' };

export function sendOp(op: Op): Promise<void> {
	return invoke('send_op', { op });
}

// Events the engine emits on stdout. Only the fields the GUI uses are typed;
// `type` discriminates and unknown variants are ignored.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}
