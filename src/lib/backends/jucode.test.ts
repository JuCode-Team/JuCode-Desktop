import { describe, it, expect } from 'vitest';
import { createJucodeAdapter, JUCODE_CAPS } from './jucode';
import type { Op } from '$lib/protocol';

describe('jucode adapter (passthrough)', () => {
	const adapter = createJucodeAdapter();

	it('declares every capability', () => {
		expect(adapter.id).toBe('jucode');
		// extendedApprovalModes is a claude-only quirk (its native plan/auto
		// permission modes), not a superset capability — the native engine uses the
		// shared read-only/auto-edit/full-auto trio, so it is legitimately false.
		for (const [key, value] of Object.entries(JUCODE_CAPS)) {
			if (key === 'extendedApprovalModes') continue;
			expect(value, `cap ${key} must be true for the native engine`).toBe(true);
		}
		expect(JUCODE_CAPS.extendedApprovalModes).toBe(false);
		expect(adapter.caps).toEqual(JUCODE_CAPS);
	});

	it('translate is the identity over representative engine events', () => {
		const samples = [
			{ type: 'startup', model: 'gpt-5.5', cwd: '/tmp/p', session_id: 'sid', context_window: 200000 },
			{ type: 'assistant_delta', delta: '你好' },
			{ type: 'reasoning_delta', delta: 'thinking…' },
			{ type: 'tool_start', call_id: 'c1', name: 'bash' },
			{ type: 'tool_output', call_id: 'c1', name: 'bash', output: 'ok', is_error: false },
			{
				type: 'approval_request',
				call_id: 'c2',
				name: 'edit',
				summary: 'edit src/a.ts',
				subagent_id: null,
				hunks: [{ id: 'h1', file: 'a.ts', header: '@@', lines: ['+x'] }]
			},
			{ type: 'approval_mode', mode: 'auto-edit' },
			{ type: 'context_usage', tokens: 1234, cost: 0.01 },
			{ type: 'usage', input_tokens: 10, output_tokens: 20 },
			{ type: 'tree_view', nodes: [] },
			{ type: 'model_view', models: [], active_effort: 'medium' },
			{ type: 'resume_view', items: [] },
			{ type: 'transcript', items: [{ role: 'user', content: 'hi' }] },
			{ type: 'goal', goal: { objective: 'x', status: 'active' } },
			{ type: 'plan', plan: [{ step: 's', status: 'todo' }] },
			{ type: 'subagent_lifecycle', path: 'sub/1', status: 'running', message: '' },
			{ type: 'compaction_progress', output_tokens: 5 },
			{ type: 'trust_prompt', cwd: '/tmp', repo_root: '/tmp' },
			{ type: 'mcp_servers', servers: [] },
			{ type: 'status', message: 'new session abc' },
			{ type: 'model_status', provider: 'jucode', model: 'gpt-5.5', state: 'idle' },
			{ type: 'error', message: 'boom' }
		];
		for (const ev of samples) {
			const out = adapter.translate(ev);
			expect(out).toHaveLength(1);
			// Same object, untouched — not a copy, not a re-shape.
			expect(out[0]).toBe(ev);
		}
	});

	it('encodeOp is JSON.stringify for every Op variant', () => {
		const ops: Op[] = [
			{ op: 'user_message', content: 'hi' },
			{ op: 'user_message', content: 'look', images: ['/tmp/a.png'] },
			{ op: 'command', input: '/resume abc' },
			{ op: 'steer' },
			{ op: 'interrupt' },
			{ op: 'shutdown' },
			{ op: 'approve', call_id: 'c1', decision: 'allow' },
			{ op: 'approve', call_id: 'c1', decision: 'allow', hunks: ['h1', 'h2'] },
			{ op: 'approve', call_id: 'c1', decision: 'deny' },
			{ op: 'approve', call_id: 'c1', decision: 'allow', always: true },
			{ op: 'set_approval_mode', mode: 'read-only' },
			{ op: 'set_approval_mode', mode: 'auto-edit' },
			{ op: 'set_approval_mode', mode: 'full-auto' },
			{ op: 'mcp_list' },
			{
				op: 'mcp_set',
				server: { name: 'fs', transport: 'stdio', command: 'mcp-fs', args: [], env: {}, enabled: true }
			},
			{ op: 'mcp_remove', name: 'fs' },
			{ op: 'mcp_toggle', name: 'fs', enabled: false }
		];
		for (const op of ops) {
			const lines = adapter.encodeOp(op);
			expect(lines).toHaveLength(1);
			expect(lines![0]).toBe(JSON.stringify(op));
			// Round-trips to a deep-equal op (single-line frame).
			expect(JSON.parse(lines![0])).toEqual(op);
			expect(lines![0]).not.toContain('\n');
		}
	});
});
