import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer (same pattern as session.test.ts).
vi.mock('$lib/protocol', () => ({
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve())
}));

import { sendOp, sendLine } from '$lib/protocol';
import { dispatch, registerAdapter, unregisterAdapter, adapterFor, ioFor } from './router';
import { createJucodeAdapter } from './jucode';
import { createClaudeAdapter } from './claude';
import { createCodexAdapter } from './codex';

beforeEach(() => {
	vi.clearAllMocks();
	for (const id of ['s-ju', 's-cl', 's-cx', 's-none']) unregisterAdapter(id);
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

	it('non-jucode adapters encode to raw lines via send_line', () => {
		const adapter = createClaudeAdapter();
		registerAdapter('s-cl', adapter);
		// A turn must be running for interrupt to produce a frame.
		adapter.translate({ type: 'system', subtype: 'status', status: 'requesting' });
		const ok = dispatch('s-cl', { op: 'interrupt' });
		expect(ok).toBe(true);
		expect(sendOp).not.toHaveBeenCalled();
		expect(sendLine).toHaveBeenCalledTimes(1);
		const [sid, line] = vi.mocked(sendLine).mock.calls[0];
		expect(sid).toBe('s-cl');
		expect(JSON.parse(line).request).toEqual({ subtype: 'interrupt' });
	});

	it('unsupported ops return false and send nothing', () => {
		registerAdapter('s-cl', createClaudeAdapter());
		const ok = dispatch('s-cl', { op: 'command', input: '/resume x' });
		expect(ok).toBe(false);
		expect(sendOp).not.toHaveBeenCalled();
		expect(sendLine).not.toHaveBeenCalled();
	});

	it('routes per session — adapters are isolated', () => {
		const claude = createClaudeAdapter();
		registerAdapter('s-ju', createJucodeAdapter());
		registerAdapter('s-cl', claude);
		registerAdapter('s-cx', createCodexAdapter());
		claude.translate({ type: 'system', subtype: 'status', status: 'requesting' }); // turn running

		expect(dispatch('s-ju', { op: 'steer' })).toBe(true); // native: everything
		expect(dispatch('s-cl', { op: 'steer' })).toBe(false); // claude: stdin is already a queue
		expect(dispatch('s-cx', { op: 'steer' })).toBe(false); // codex: steer unsupported
		expect(dispatch('s-cx', { op: 'interrupt' })).toBe(true); // codex: idle no-op (0 frames)
		expect(dispatch('s-cl', { op: 'interrupt' })).toBe(true); // claude: control_request

		expect(sendOp).not.toHaveBeenCalled();
		expect(vi.mocked(sendLine).mock.calls.map(([sid]) => sid)).toEqual(['s-ju', 's-cl']);
	});

	it('unregister removes the adapter (falls back to send_op)', () => {
		const adapter = createClaudeAdapter();
		registerAdapter('s-cl', adapter);
		expect(adapterFor('s-cl')).toBe(adapter);
		unregisterAdapter('s-cl');
		expect(adapterFor('s-cl')).toBeUndefined();
		dispatch('s-cl', { op: 'interrupt' });
		expect(sendOp).toHaveBeenCalledWith('s-cl', { op: 'interrupt' });
	});

	it('ioFor writes raw lines for the right session', () => {
		const io = ioFor('s-cl');
		io.sendLine('{"type":"control_response"}');
		expect(sendLine).toHaveBeenCalledWith('s-cl', '{"type":"control_response"}');
	});
});
