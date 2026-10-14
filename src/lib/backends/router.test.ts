import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer (same pattern as session.test.ts).
vi.mock('$lib/protocol', () => ({
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve())
}));

import { sendOp, sendLine } from '$lib/protocol';
import { dispatch, registerAdapter, unregisterAdapter, adapterFor, ioFor, markAsleep, isAsleep, releaseOps, clearDraft, holdOps } from './router';
import { createJucodeAdapter } from './jucode';

beforeEach(() => {
	vi.clearAllMocks();
	for (const id of ['s-ju', 's-none']) unregisterAdapter(id);
});

describe('backend router dispatch', () => {
	it('jucode sessions encode through their adapter (approval-mode names mapped)', () => {
		registerAdapter('s-ju', createJucodeAdapter());
		expect(dispatch('s-ju', { op: 'user_message', content: 'hi' })).toBe(true);
		expect(sendLine).toHaveBeenCalledWith('s-ju', JSON.stringify({ op: 'user_message', content: 'hi' }));
		dispatch('s-ju', { op: 'set_approval_mode', mode: 'full-auto' });
		expect(JSON.parse(vi.mocked(sendLine).mock.calls[1][1]).mode).toBe('full-access');
		expect(sendOp).not.toHaveBeenCalled();
	});

	it('sessions without a registered adapter fall back to send_op', () => {
		const ok = dispatch('s-none', { op: 'interrupt' });
		expect(ok).toBe(true);
		expect(sendOp).toHaveBeenCalledWith('s-none', { op: 'interrupt' });
	});

	it('unregister removes the adapter (falls back to send_op)', () => {
		const adapter = createJucodeAdapter();
		registerAdapter('s-ju', adapter);
		expect(adapterFor('s-ju')).toBe(adapter);
		unregisterAdapter('s-ju');
		expect(adapterFor('s-ju')).toBeUndefined();
		dispatch('s-ju', { op: 'interrupt' });
		expect(sendOp).toHaveBeenCalledWith('s-ju', { op: 'interrupt' });
	});

	it('ioFor writes raw lines for the right session', () => {
		const io = ioFor('s-ju');
		io.sendLine('{"op":"interrupt"}');
		expect(sendLine).toHaveBeenCalledWith('s-ju', '{"op":"interrupt"}');
	});
});

describe('a session the daemon closed for idleness', () => {
	it('drops live-state requests, holds settings, and wakes once on a message', () => {
		registerAdapter('s-ju', createJucodeAdapter());
		const wake = vi.fn(() => holdOps('s-ju'));
		markAsleep('s-ju', wake);
		dispatch('s-ju', { op: 'context_usage' });
		dispatch('s-ju', { op: 'set_approval_mode', mode: 'full-auto' });
		expect(wake).not.toHaveBeenCalled();
		expect(sendLine).not.toHaveBeenCalled();

		dispatch('s-ju', { op: 'user_message', content: 'hi' });
		dispatch('s-ju', { op: 'user_message', content: 'again' });
		expect(wake).toHaveBeenCalledTimes(1);
		expect(isAsleep('s-ju')).toBe(false);

		// The engine is up: what was held goes, in order; the poll did not.
		releaseOps('s-ju');
		const sent = vi.mocked(sendLine).mock.calls.map(([, line]) => JSON.parse(line).op);
		expect(sent).toEqual(['set_approval_mode', 'user_message', 'user_message']);
	});

	it('is forgotten with the session', () => {
		markAsleep('s-ju', () => {});
		clearDraft('s-ju');
		expect(isAsleep('s-ju')).toBe(false);
	});
});
