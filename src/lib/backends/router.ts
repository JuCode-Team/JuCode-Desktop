// Per-session adapter registry + outgoing-op dispatch.
//
// The SessionStore registers each session's adapter on spawn and unregisters
// it on close; every UI call site sends ops through `dispatch()` instead of
// protocol.sendOp, so non-jucode sessions get their ops encoded by their
// adapter (or politely refused when unsupported).

import * as protocol from '$lib/protocol';
import type { Op } from '$lib/protocol';
import type { AdapterIO, EngineAdapter } from './types';

const adapters = new Map<string, EngineAdapter>();

export function registerAdapter(sessionId: string, adapter: EngineAdapter): void {
	adapters.set(sessionId, adapter);
}

export function unregisterAdapter(sessionId: string): void {
	adapters.delete(sessionId);
}

export function adapterFor(sessionId: string): EngineAdapter | undefined {
	return adapters.get(sessionId);
}

/** The AdapterIO handed to `adapter.onStart` — raw line writes to this
 *  session's child stdin, fire-and-forget. */
export function ioFor(sessionId: string): AdapterIO {
	return {
		sendLine(line: string) {
			void protocol.sendLine?.(sessionId, line)?.catch(() => {});
		}
	};
}

/**
 * Sends a desktop Op to a session through its adapter.
 * Returns false when the session's backend doesn't support the op (the caller
 * should tell the user); true when the op was handed to the child.
 *
 * The native backend (and any session without a registered adapter — e.g. one
 * created before this module loaded, which cannot happen in practice but keeps
 * the fallback honest) uses the structured send_op command directly: that is
 * byte-for-byte the pre-adapter behavior.
 */
export function dispatch(
	sessionId: string,
	op: Op,
	onError: (e: unknown) => void = (e) => console.error('send op failed', e)
): boolean {
	const adapter = adapters.get(sessionId);
	if (!adapter || adapter.id === 'jucode') {
		void protocol.sendOp(sessionId, op)?.catch?.(onError);
		return true;
	}
	const lines = adapter.encodeOp(op);
	if (lines === null) return false;
	for (const line of lines) {
		void protocol.sendLine?.(sessionId, line)?.catch?.(onError);
	}
	return true;
}
