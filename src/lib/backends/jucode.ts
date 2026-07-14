// Native-engine adapter: pure passthrough. The desktop's Op / AgentEvent
// dialect IS the jucode wire protocol, so translation is the identity and
// every capability is available.

import type { Op } from '$lib/protocol';
import type { BackendCaps, EngineAdapter, NormalizedEvent } from './types';

export const JUCODE_CAPS: BackendCaps = {
	approvalModes: true,
	extendedApprovalModes: false,
	hunkApproval: true,
	steer: true,
	interrupt: true,
	branchTree: true,
	goals: true,
	skills: true,
	mcpManage: true,
	checkpoints: true,
	contextUsage: true,
	compact: true,
	modelPicker: true,
	resume: true,
	subagents: true,
	transcriptReplay: true,
	slashCommands: true
};

export function createJucodeAdapter(): EngineAdapter {
	return {
		id: 'jucode',
		caps: JUCODE_CAPS,
		onStart() {
			/* no handshake — `jucode serve` announces itself via startup events */
		},
		translate(raw: unknown): NormalizedEvent[] {
			// Identity: the engine already speaks the normalized dialect.
			return [raw as NormalizedEvent];
		},
		encodeOp(op: Op): string[] {
			return [JSON.stringify(op)];
		}
	};
}
