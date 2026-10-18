// Backend registry: the capability table and its gating helper.

import type { BackendCaps, BackendId } from './types';
import { JUCODE_CAPS } from './jucode';
import { ACP_CAPS, CLAUDE_CAPS, CODEX_CAPS } from './caps';

export type { BackendCaps, BackendId, EngineAdapter, AdapterIO, SessionCtx, NormalizedEvent } from './types';
export { BACKEND_IDS, NATIVE_BACKEND_IDS, BACKEND_LABELS, isBackendId, normalizeBackendId } from './types';

/** Static capability table. */
export const CAPS: Record<BackendId, BackendCaps> = {
	jucode: JUCODE_CAPS,
	codex: CODEX_CAPS,
	claude: CLAUDE_CAPS,
	acp: ACP_CAPS
};

/**
 * THE capability-gating helper: every UI surface asks this one function.
 * Accepts anything carrying a `backendId` (ChatState does) — or nothing, which
 * gates like the native backend so pre-existing UI behavior is unchanged.
 * An ACP session's caps are its agent's: the daemon's `engine_caps`
 * (`engineCaps`) over the all-off ACP baseline.
 */
export function caps(chat?: { backendId?: string; engineCaps?: Partial<BackendCaps> | null } | null): BackendCaps {
	const id = chat?.backendId;
	if (id === 'acp') {
		const merged = { ...ACP_CAPS };
		for (const [k, v] of Object.entries(chat?.engineCaps ?? {}))
			if (k in ACP_CAPS && typeof v === 'boolean') merged[k as keyof BackendCaps] = v;
		return merged;
	}
	return (id && id in CAPS ? CAPS[id as BackendId] : CAPS.jucode);
}
