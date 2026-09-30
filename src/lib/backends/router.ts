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
/** Ops sent while a session's engine is (re)starting, delivered once it is up. */
const held = new Map<string, Op[]>();

/** Queue this session's ops until `releaseOps`: its engine is (re)starting or
 *  has exited, and an op sent now would reach no child (or a dying one). */
export function holdOps(sessionId: string): void {
	if (!held.has(sessionId)) held.set(sessionId, []);
}

/** The engine is up: deliver the held ops in order and stop holding. */
export function releaseOps(sessionId: string): void {
	const ops = held.get(sessionId);
	held.delete(sessionId);
	for (const op of ops ?? []) dispatch(sessionId, op);
}

/** Stop holding and return what was held, undelivered (the engine is not
 *  coming back). */
export function dropHeldOps(sessionId: string): Op[] {
	const ops = held.get(sessionId) ?? [];
	held.delete(sessionId);
	return ops;
}

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
 * Every adapter encodes its own frames, the native one included (it maps
 * approval-mode names). A session without a registered adapter — one created
 * before this module loaded, which cannot happen in practice but keeps the
 * fallback honest — uses the structured send_op command directly.
 */
export function dispatch(
	sessionId: string,
	op: Op,
	onError: (e: unknown) => void = (e) => console.error('send op failed', e)
): boolean {
	const adapter = adapters.get(sessionId);
	if (!adapter) {
		void protocol.sendOp(sessionId, op)?.catch?.(onError);
		return true;
	}
	const queue = held.get(sessionId);
	if (queue) {
		// Only what still means something to the next engine: an interrupt or
		// an approval answer belongs to the one that is gone.
		if (op.op !== 'interrupt' && op.op !== 'approve') queue.push(op);
		return true;
	}
	const lines = adapter.encodeOp(op);
	if (lines === null) return false;
	for (const line of lines) {
		void protocol.sendLine?.(sessionId, line)?.catch?.(onError);
	}
	return true;
}
