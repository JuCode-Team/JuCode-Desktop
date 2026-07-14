// Backend registry: adapter factories + the capability-gating helper.

import type { BackendCaps, BackendId, EngineAdapter } from './types';
import { createJucodeAdapter, JUCODE_CAPS } from './jucode';
import { createCodexAdapter, CODEX_CAPS } from './codex';
import { createClaudeAdapter, CLAUDE_CAPS } from './claude';

export type { BackendCaps, BackendId, EngineAdapter, AdapterIO, SessionCtx, NormalizedEvent } from './types';
export { BACKEND_IDS, BACKEND_LABELS, isBackendId, normalizeBackendId } from './types';

/** Static capability table (adapters declare the same object). */
export const CAPS: Record<BackendId, BackendCaps> = {
	jucode: JUCODE_CAPS,
	codex: CODEX_CAPS,
	claude: CLAUDE_CAPS
};

/** New adapter instance for a session (adapters are per-session stateful). */
export function createAdapter(id: BackendId): EngineAdapter {
	switch (id) {
		case 'codex':
			return createCodexAdapter();
		case 'claude':
			return createClaudeAdapter();
		default:
			return createJucodeAdapter();
	}
}

/**
 * THE capability-gating helper: every UI surface asks this one function.
 * Accepts anything carrying a `backendId` (ChatState does) — or nothing, which
 * gates like the native backend so pre-existing UI behavior is unchanged.
 */
export function caps(chat?: { backendId?: string } | null): BackendCaps {
	const id = chat?.backendId;
	return (id && id in CAPS ? CAPS[id as BackendId] : CAPS.jucode);
}
