import { describe, it, expect } from 'vitest';
import { ChatState } from './chat.svelte';

const userTexts = (c: ChatState) =>
	c.messages.filter((m) => m.kind === 'user').map((m) => (m.kind === 'user' ? m.text : ''));

describe('ChatState.handle', () => {
	it('projects a user message and streamed assistant deltas', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hello' });
		c.handle({ type: 'assistant_delta', delta: 'hi ' });
		c.handle({ type: 'assistant_delta', delta: 'there' });
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
		const a = c.messages[1];
		expect(a.kind === 'assistant' && a.text).toBe('hi there');
	});

	it('sets the title from the first user message', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'Fix the bug in foo' });
		expect(c.title).toBe('Fix the bug in foo');
	});

	it('de-duplicates the optimistic echo', () => {
		const c = new ChatState();
		c.optimisticUser('refactor foo');
		c.handle({ type: 'user_message', content: 'refactor foo' });
		expect(userTexts(c)).toEqual(['refactor foo']);
	});

	it('still appends a genuinely different message after an optimistic one', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'user_message', content: 'second' });
		expect(userTexts(c)).toEqual(['first', 'second']);
	});

	it('de-duplicates a replay echo that arrives after the assistant reply (claude)', () => {
		// claude's --replay-user-messages re-emits the user turn only after the
		// assistant has answered, so the optimistic bubble is no longer at the tail.
		const c = new ChatState();
		c.optimisticUser('你好');
		c.handle({ type: 'assistant_start' });
		c.handle({ type: 'assistant_delta', text: '你好！' });
		c.handle({ type: 'user_message', content: '你好' });
		expect(userTexts(c)).toEqual(['你好']);
	});

	it('stamps end-of-turn usage tokens onto the last assistant message (claude)', () => {
		// claude reports usage once at the end of the turn, after the assistant
		// finished — #assistantIdx is already reset, so tokens must fall back to
		// the last assistant message (same bubble the elapsed time lands on).
		const c = new ChatState();
		c.optimisticUser('q');
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		c.handle({ type: 'assistant_start' }); // resets #assistantIdx to -1
		c.handle({ type: 'usage', output_tokens: 42, input_tokens: 10 });
		const last = c.messages[c.messages.length - 1] as { kind: string; tokens?: number };
		expect(last.kind).toBe('assistant');
		expect(last.tokens).toBe(42);
	});

	it('aggregates a tool card by call_id and marks it done', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: '1', name: 'read' });
		c.handle({ type: 'tool_output', call_id: '1', name: 'read', output: '{"kind":"text"}', is_error: false });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false, isError: false });
	});

	it('sweeps a still-running tool card to done when the turn ends (lost tool_output)', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 'lost', name: 'read' });
		// No tool_output arrives (e.g. a subagent frame whose tool_result never
		// mapped). The turn ending must not leave the card spinning forever.
		c.handle({ type: 'status', message: 'ready' });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false });
	});

	it('resolves a pencil rewind intent from checkpoint_view by position', () => {
		const c = new ChatState();
		c.rewindIntent = { userIndex: 1, text: 'edit me' };
		c.handle({
			type: 'checkpoint_view',
			items: [
				{ id: 't0', label: 'a', detail: '', active: false },
				{ id: 't1', label: 'b', detail: '', active: false }
			]
		});
		expect(c.picker).toBeNull();
		expect(c.pendingRewind).toEqual({ id: 't1', text: 'edit me' });
	});

	it('opens the checkpoint picker when there is no rewind intent', () => {
		const c = new ChatState();
		c.handle({ type: 'checkpoint_view', items: [{ id: 't0', label: 'a', detail: '', active: false }] });
		expect(c.picker?.kind).toBe('checkpoint');
		expect(c.pendingRewind).toBeNull();
	});

	it('stores the latest mcp_servers view on the state', () => {
		const c = new ChatState();
		expect(c.mcpServers).toBeNull();
		c.handle({
			type: 'mcp_servers',
			servers: [
				{
					name: 'files',
					transport: 'stdio',
					state: 'connected',
					tools: [{ name: 'read_file', description: 'Read a file' }]
				},
				{ name: 'web', transport: 'http', state: 'failed', error: 'boom', tools: [] }
			]
		});
		expect(c.mcpServers).toEqual([
			{
				name: 'files',
				transport: 'stdio',
				state: 'connected',
				tools: [{ name: 'read_file', description: 'Read a file' }]
			},
			{ name: 'web', transport: 'http', state: 'failed', error: 'boom', tools: [] }
		]);
		// A later event replaces the list wholesale.
		c.handle({ type: 'mcp_servers', servers: [] });
		expect(c.mcpServers).toEqual([]);
	});

	it('clears booting on the first engine event and caches the model catalog', () => {
		const c = new ChatState();
		expect(c.booting).toBe(true);
		c.handle({ type: 'model_status', state: 'idle' });
		expect(c.booting).toBe(false);
		c.handle({
			type: 'model_view',
			models: [{ model: 'opus', active: true, reasoning_efforts: ['high', 'max'] }],
			active_effort: 'high'
		});
		expect(c.modelCatalog).toEqual([{ model: 'opus', active: true, reasoning_efforts: ['high', 'max'] }]);
		expect(c.modelCatalogEffort).toBe('high');
	});

	it('collects meta notices into statusLog, keeping them out of the bubble stream', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'retrying' });
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'error', message: 'boom' });
		// statusLog holds only the system/meta notices…
		expect(c.statusLog.length).toBe(2);
		// …while user + error stay as bubbles in messages.
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'system', 'system', 'error']);
	});

	it('estimates cost from token usage when the engine reports none', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-4-8', state: 'idle' });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		// opus: $15/M in + $75/M out = $90 for 1M+1M.
		expect(c.cost).toBeCloseTo(90, 5);
	});

	it('defers to the engine cost once it reports one (no double count)', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		c.handle({ type: 'context_usage', tokens: 100, cost: 0.42 });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		expect(c.cost).toBe(0.42);
	});

	it('truncateToUserTurn drops the target turn and everything after (codex rewind)', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'first' });
		c.handle({ type: 'assistant_delta', delta: 'a1' });
		c.handle({ type: 'user_message', content: 'second' });
		c.handle({ type: 'assistant_delta', delta: 'a2' });
		c.handle({ type: 'user_message', content: 'third' });
		expect(c.userTurns).toBe(3);
		c.truncateToUserTurn(1); // rewind to the 2nd user turn
		expect(userTexts(c)).toEqual(['first']);
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
	});

	it('stamps assistant_uuid and resolves the claude rewind resume-at target', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'q1' });
		c.handle({ type: 'assistant_delta', delta: 'a1' });
		c.handle({ type: 'assistant_uuid', uuid: 'uuid-1' });
		c.handle({ type: 'assistant_start' });
		c.handle({ type: 'user_message', content: 'q2' });
		c.handle({ type: 'assistant_delta', delta: 'a2' });
		c.handle({ type: 'assistant_uuid', uuid: 'uuid-2' });
		// Rewind to turn 1 (2nd user msg) resumes at turn 0's assistant uuid.
		expect(c.claudeRewindTarget(1)).toBe('uuid-1');
		// Rewind to turn 0 has no prior assistant → fresh restart (null).
		expect(c.claudeRewindTarget(0)).toBeNull();
	});

	it('tracks busy state from engine status', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', state: 'streaming' });
		expect(c.busy).toBe(true);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.busy).toBe(false);
	});
});

describe('approval flow (engine-enforced)', () => {
	it('reduces an approval_request with hunks + subagent into state', () => {
		const c = new ChatState();
		c.handle({
			type: 'approval_request',
			call_id: 'call_1',
			name: 'apply_patch',
			summary: 'src/a.rs',
			subagent_id: 'agent-7',
			hunks: [
				{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
				{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] }
			]
		});
		expect(c.pendingApproval).toEqual({
			callId: 'call_1',
			name: 'apply_patch',
			summary: 'src/a.rs',
			subagentId: 'agent-7',
			hunks: [
				{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
				{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] }
			]
		});
	});

	it('reduces a hunk-less approval_request with null hunks/subagent', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'c2', name: 'bash', summary: 'rm -rf /tmp/x', subagent_id: null, hunks: null });
		expect(c.pendingApproval).toEqual({
			callId: 'c2',
			name: 'bash',
			summary: 'rm -rf /tmp/x',
			subagentId: null,
			hunks: null
		});
	});

	it('never auto-approves client-side: requests surface in every mode', () => {
		const c = new ChatState();
		c.approvalMode = 'all'; // engine decides now — 'all' must not swallow the card
		c.handle({ type: 'approval_request', call_id: 'c3', name: 'apply_patch', summary: 'x' });
		expect(c.pendingApproval?.callId).toBe('c3');
	});

	it("pushes the desktop's persisted mode when the startup announcement diverges", () => {
		const c = new ChatState();
		c.approvalMode = 'all'; // persisted preference
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // engine default
		// desktop mode wins at startup: local state untouched, push requested
		expect(c.approvalMode).toBe('all');
		expect(c.pendingModeSync).toBe('full-auto');
		// the ack after the page sends set_approval_mode reconciles to the same value
		c.pendingModeSync = null;
		c.handle({ type: 'approval_mode', mode: 'full-auto' });
		expect(c.approvalMode).toBe('all');
		expect(c.pendingModeSync).toBeNull();
	});

	it('requests no push when the startup announcement already matches', () => {
		const c = new ChatState();
		c.approvalMode = 'ask';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBeNull();
		expect(c.approvalMode).toBe('ask');
	});

	it('reconciles post-startup approval_mode events from the engine (e.g. /approvals)', () => {
		const c = new ChatState();
		c.approvalMode = 'ask';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // startup announcement, in sync
		c.handle({ type: 'approval_mode', mode: 'auto-edit' }); // user typed /approvals auto-edit
		expect(c.approvalMode).toBe('edits');
		expect(c.pendingModeSync).toBeNull();
		// garbage keeps the current mode
		c.handle({ type: 'approval_mode', mode: 'bogus' });
		expect(c.approvalMode).toBe('edits');
	});

	it('re-arms the startup push after a crash restart', () => {
		const c = new ChatState();
		c.approvalMode = 'edits';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBe('auto-edit');
		c.pendingModeSync = null;
		c.handle({ type: 'approval_mode', mode: 'auto-edit' }); // ack
		// engine crashes; the restarted engine announces its default again
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBe('auto-edit');
		expect(c.approvalMode).toBe('edits');
	});
});
