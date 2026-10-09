// Native-engine adapter: the desktop's Op / AgentEvent dialect is the jucode
// wire protocol, so events pass through untouched except for two things: the
// `hello` version frame, and approval-mode names (the engine says manual /
// full-access where the desktop says read-only / full-auto; plan and auto are
// the same on both sides).

import type { Op } from '$lib/protocol';
import type { BackendCaps, EngineAdapter, NormalizedEvent } from './types';

export const JUCODE_CAPS: BackendCaps = {
	approvalModes: true,
	extendedApprovalModes: false,
	// Plan mode (proposed_plan cards, approve_plan): off until the bundled CLI
	// is the release that adds it; 0.4.11 rejects approval mode `plan`.
	planMode: false,
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
	slashCommands: true,
	mcpEngineOwned: false,
	ruleScopes: false,
	sideQuestions: false,
	// agent_runs / subagent_transcript (an older engine refuses both: ChatState
	// drops the refusal and the spawn calls report the agents).
	agentTrace: true
};

/** Wire protocol version this desktop speaks (`hello.protocol`). */
export const JUCODE_PROTOCOL = 2;

const TO_ENGINE_MODE: Record<string, string> = {
	'read-only': 'manual',
	'auto-edit': 'auto-edit',
	auto: 'auto',
	plan: 'plan',
	'full-auto': 'full-access'
};
const FROM_ENGINE_MODE: Record<string, string> = {
	manual: 'read-only',
	'full-access': 'full-auto'
};

export function createJucodeAdapter(): EngineAdapter {
	return {
		id: 'jucode',
		caps: JUCODE_CAPS,
		onStart() {
			/* no handshake — the daemon sends the session's startup events */
		},
		translate(raw: unknown): NormalizedEvent[] {
			const ev = raw as Record<string, unknown>;
			if (ev.type === 'hello') {
				if (ev.protocol === JUCODE_PROTOCOL) return [];
				return [
					{
						type: 'error',
						message: `jucode speaks protocol ${String(ev.protocol)}, this desktop speaks ${JUCODE_PROTOCOL}; update both to the same release`
					}
				];
			}
			if (ev.type === 'approval_mode' && typeof ev.mode === 'string' && ev.mode in FROM_ENGINE_MODE) {
				return [{ ...(raw as NormalizedEvent), mode: FROM_ENGINE_MODE[ev.mode] }];
			}
			return [raw as NormalizedEvent];
		},
		encodeOp(op: Op): string[] {
			if (op.op === 'set_approval_mode') {
				return [JSON.stringify({ ...op, mode: TO_ENGINE_MODE[op.mode] ?? op.mode })];
			}
			if (op.op === 'approve_plan' && op.mode) {
				return [JSON.stringify({ ...op, mode: TO_ENGINE_MODE[op.mode] ?? op.mode })];
			}
			return [JSON.stringify(op)];
		}
	};
}
