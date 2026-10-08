import { describe, it, expect, vi } from 'vitest';
import { ChatState, countDiffLines } from './chat.svelte';
import { setLocale } from './i18n';

const userTexts = (c: ChatState) =>
	c.messages.filter((m) => m.kind === 'user').map((m) => (m.kind === 'user' ? m.text : ''));

describe('countDiffLines', () => {
	it('counts +/- lines, ignoring +++/--- headers', () => {
		expect(countDiffLines('--- a\n+++ b\n@@\n-old\n+new\n ctx')).toEqual({ added: 1, removed: 1 });
	});
	it('handles pure additions', () => {
		expect(countDiffLines('+a\n+b\n+c')).toEqual({ added: 3, removed: 0 });
	});
});

describe('ChatState.handle', () => {
	it('keeps a just-sent message that the arriving snapshot does not have yet', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'transcript', items: [] });
		expect(userTexts(c)).toEqual(['first']);
		// Its echo arrives next and is not shown twice.
		c.handle({ type: 'user_message', content: 'first' });
		expect(userTexts(c)).toEqual(['first']);
	});

	it('takes the snapshot copy of a just-sent message when it already has it', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'first' }] });
		expect(userTexts(c)).toEqual(['first']);
		c.handle({ type: 'user_message', content: 'second' });
		expect(userTexts(c)).toEqual(['first', 'second']);
	});

	it('notes deferred and decided actions of a hosted session in the chat', () => {
		setLocale('en');
		const c = new ChatState();
		c.handle({ type: 'action_deferred', id: 'act-1', name: 'bash', summary: 'make deploy' });
		c.handle({ type: 'action_decided', id: 'act-1', decision: 'deny' });
		const texts = c.messages.map((m) => (m.kind === 'system' ? m.text : ''));
		expect(texts[0]).toContain('bash (make deploy)');
		expect(texts[1]).toBe('Pending action act-1 denied');
	});

	it('projects a user message and streamed assistant deltas', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hello' });
		c.handle({ type: 'assistant_delta', delta: 'hi ' });
		c.handle({ type: 'assistant_delta', delta: 'there' });
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
		const a = c.messages[1];
		expect(a.kind === 'assistant' && a.text).toBe('hi there');
	});

	it('leaves the title to the daemon', () => {
		const c = new ChatState();
		c.optimisticUser('do the thing');
		c.handle({ type: 'user_message', content: 'do the thing again' });
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'earlier' }] });
		expect(c.title).toBe('New session');
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

	it('builds a per-turn diff timeline from edit tool outputs', () => {
		const c = new ChatState();
		// Turn 1: edit a.ts (+2/-1)
		c.handle({ type: 'user_message', content: 'edit a' });
		c.handle({ type: 'tool_start', call_id: 't1', name: 'str_replace' });
		c.handle({
			type: 'tool_output',
			call_id: 't1',
			name: 'str_replace',
			output: JSON.stringify({ path: '/proj/a.ts', diff: '-old\n+new1\n+new2' })
		});
		// Turn 2: edit b.ts (+1/-0)
		c.handle({ type: 'user_message', content: 'edit b' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'write' });
		c.handle({
			type: 'tool_output',
			call_id: 't2',
			name: 'write',
			output: JSON.stringify({ path: '/proj/b.ts', diff: '+only' })
		});
		const tl = c.turnTimeline;
		expect(tl.map((t) => t.index)).toEqual([1, 0]); // newest first
		expect(tl[1]).toMatchObject({ index: 0, text: 'edit a', added: 2, removed: 1 });
		expect(tl[1].files).toEqual([{ path: '/proj/a.ts', added: 2, removed: 1 }]);
		expect(tl[0]).toMatchObject({ index: 1, text: 'edit b', added: 1, removed: 0 });
	});

	it('drops per-turn diffs when truncating to an earlier turn', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'edit a' });
		c.handle({ type: 'tool_start', call_id: 't1', name: 'write' });
		c.handle({ type: 'tool_output', call_id: 't1', name: 'write', output: JSON.stringify({ path: '/a', diff: '+x' }) });
		c.handle({ type: 'user_message', content: 'edit b' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'write' });
		c.handle({ type: 'tool_output', call_id: 't2', name: 'write', output: JSON.stringify({ path: '/b', diff: '+y' }) });
		c.truncateToUserTurn(1); // drop turn 2 (index 1)
		expect(c.turnTimeline.map((t) => t.index)).toEqual([0]);
	});

	it('summarizes raw frames for the diagnostics trace (incl. unparseable)', () => {
		const c = new ChatState();
		c.captureFrame(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } }));
		c.captureFrame(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_9' }] } }));
		c.captureFrame(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] }, parent_tool_use_id: 'toolu_p' }));
		c.captureFrame('{not json');
		expect(c.frameTrace[0]).toBe('stream_event/content_block_start tool_use:Bash');
		expect(c.frameTrace[1]).toBe('user/tool_result toolu_9');
		expect(c.frameTrace[2]).toContain('⤷sub');
		expect(c.frameTrace[3]).toMatch(/^⚠ unparseable/);
	});

	it('caps the frame trace ring buffer at 200', () => {
		const c = new ChatState();
		for (let i = 0; i < 250; i++) c.captureFrame(JSON.stringify({ type: 'system', subtype: `s${i}` }));
		expect(c.frameTrace.length).toBe(200);
		expect(c.frameTrace[c.frameTrace.length - 1]).toBe('system/s249');
	});

	it('aggregates turn timing and message stats for diagnostics', () => {
		const c = new ChatState();
		const a1 = { kind: 'assistant', text: 'x', elapsed: 1000 } as const;
		const a2 = { kind: 'assistant', text: 'y', elapsed: 3000 } as const;
		c.messages.push({ kind: 'user', text: 'q1' }, { ...a1 }, { kind: 'user', text: 'q2' }, { ...a2 });
		expect(c.turnTiming).toEqual({ turns: 2, totalMs: 4000, meanMs: 2000 });
		expect(c.messageStats).toMatchObject({ user: 2, assistant: 2 });
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
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'error', message: 'boom' });
		// statusLog holds only the system/meta notices…
		expect(c.statusLog.length).toBe(2);
		// …while user + error stay as bubbles in messages.
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'system', 'system', 'error']);
	});

	it('shows a retry as live state, not a log line, until output flows again', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'retrying', attempt: 3, max_attempts: 6, reason: 'unexpected status 503: busy', delay_ms: 2000 });
		expect(c.retry).toMatchObject({ attempt: 3, max: 6, reason: 'unexpected status 503: busy', delayMs: 2000 });
		expect(c.messages.map((m) => m.kind)).toEqual(['user']);
		c.handle({ type: 'assistant_delta', delta: 'ok' });
		expect(c.retry).toBeNull();
		c.handle({ type: 'retrying', attempt: 2, max_attempts: 3, reason: 'timeout', delay_ms: 500 });
		c.handle({ type: 'error', message: 'gave up' });
		expect(c.retry).toBeNull();
	});

	it('estimates cost from token usage when the engine reports none', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-4-8', state: 'idle' });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		// opus: $15/M in + $75/M out = $90 for 1M+1M.
		expect(c.cost).toBeCloseTo(90, 5);
	});

	it('mirrors claude ultracode from model_status; other engines leave it off', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', ultracode: true, ultracode_available: true, state: 'idle' });
		expect([c.ultracode, c.ultracodeAvailable]).toEqual([true, true]);
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		expect([c.ultracode, c.ultracodeAvailable]).toEqual([false, false]);
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
			],
			questions: null
		});
	});

	it('shows a mode that waits for the turn, and drops an approval decided elsewhere', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_mode_pending', mode: 'full-access' } as never);
		expect(c.approvalPending).toBe('all');
		c.handle({ type: 'approval_mode_pending', mode: null } as never);
		expect(c.approvalPending).toBeNull();
		c.handle({ type: 'approval_request', call_id: 'c1', name: 'bash', summary: 'ls', hunks: null, subagent_id: null } as never);
		expect(c.pendingApproval?.callId).toBe('c1');
		c.handle({ type: 'tool_output', call_id: 'c2', output: '', is_error: false } as never);
		expect(c.pendingApproval?.callId).toBe('c1');
		c.handle({ type: 'tool_output', call_id: 'c1', output: 'ok', is_error: false } as never);
		expect(c.pendingApproval).toBeNull();
	});

	it('reduces a hunk-less approval_request with null hunks/subagent', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'c2', name: 'bash', summary: 'rm -rf /tmp/x', subagent_id: null, hunks: null });
		expect(c.pendingApproval).toEqual({
			callId: 'c2',
			name: 'bash',
			summary: 'rm -rf /tmp/x',
			subagentId: null,
			hunks: null,
			questions: null
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

	it("keeps an agent session in the agent's mode and does not persist it", () => {
		const setItem = vi.fn();
		vi.stubGlobal('localStorage', { getItem: () => null, setItem });
		const c = new ChatState();
		c.agent = 'ops';
		c.approvalMode = 'ask'; // the desktop's mode
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'auto' }); // the agent's mode
		expect(c.pendingModeSync).toBeNull();
		expect(c.approvalMode).toBe('auto');
		c.handle({ type: 'approval_mode', mode: 'full-auto' });
		expect(c.approvalMode).toBe('all');
		expect(setItem).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
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

describe('send state and turn stats', () => {
	const user = (c: ChatState) => c.messages.find((m) => m.kind === 'user') as { state?: string };

	it('walks a sent message through connecting and waiting until the reply streams', () => {
		const c = new ChatState();
		c.optimisticUser('hi');
		expect(user(c).state).toBe('sending');
		c.handle({ type: 'connecting' });
		expect(user(c).state).toBe('connecting');
		c.handle({ type: 'thinking_start' });
		expect(user(c).state).toBe('waiting');
		c.handle({ type: 'assistant_delta', delta: 'hello' });
		expect(user(c).state).toBeUndefined();
	});

	it('marks a message whose turn fails before any output', () => {
		const c = new ChatState();
		c.optimisticUser('hi');
		c.handle({ type: 'connecting' });
		c.handle({ type: 'error', message: 'HTTP 400' });
		expect(user(c).state).toBe('failed');
	});

	it('flags a cache miss during a running turn only', () => {
		const c = new ChatState();
		c.handle({ type: 'usage', input_tokens: 10_000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 12_000, cached_input_tokens: 0, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'usage', input_tokens: 14_000, cached_input_tokens: 11_990, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
		c.handle({ type: 'usage', input_tokens: 16_000, cached_input_tokens: 100, output_tokens: 10 });
		expect(c.cacheMiss).toEqual({ input: 16_000, cached: 100 });
		c.cacheMiss = null;
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'usage', input_tokens: 5_000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 6_000, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
	});

	it('stamps the turn totals on the last reply, including late usage', () => {
		const c = new ChatState();
		c.optimisticUser('fix it');
		c.handle({ type: 'connecting' });
		c.handle({ type: 'assistant_delta', delta: 'looking' });
		c.handle({ type: 'tool_start', call_id: 'c1', name: 'read_file' });
		c.handle({ type: 'tool_output', call_id: 'c1', name: 'read_file', output: 'x' });
		c.handle({ type: 'usage', input_tokens: 100, output_tokens: 20 });
		c.handle({ type: 'assistant_delta', delta: 'done' });
		c.handle({ type: 'status', message: 'ready' });
		// claude: usage for the turn arrives after it ended
		c.handle({ type: 'usage', input_tokens: 50, output_tokens: 5 });
		const last = [...c.messages].reverse().find((m) => m.kind === 'assistant') as { turn?: Record<string, number> };
		expect(last.turn).toMatchObject({ inTokens: 150, outTokens: 25, tools: 1, files: 0 });
		expect(last.turn!.ttft).toBeGreaterThanOrEqual(0);
	});
});

describe('reply timing', () => {
	it('splits a reply at its tool call, times each segment and the request stages', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(0);
			const c = new ChatState();
			const at = (ms: number, ev: Record<string, unknown>) => {
				vi.setSystemTime(ms);
				c.handle(ev as never);
			};
			at(0, { type: 'user_message', content: 'q' });
			at(0, { type: 'assistant_start' });
			at(0, { type: 'connecting' });
			expect(c.call).toEqual({ phase: 'connect', since: 0 });
			at(300, { type: 'thinking_start' });
			expect(c.call).toEqual({ phase: 'ttft', since: 300 });
			at(1000, { type: 'assistant_delta', delta: 'A' });
			expect(c.call).toEqual({ phase: 'output', since: 1000 });
			at(2000, { type: 'tool_start', call_id: 't', name: 'read' });
			expect(c.call).toBeNull();
			at(2500, { type: 'tool_output', call_id: 't', name: 'read', output: 'x' });
			at(2600, { type: 'connecting' });
			at(3000, { type: 'assistant_delta', delta: 'B' });
			at(4000, { type: 'status', message: 'ready' });

			const kinds = c.messages.map((m) => [m.kind, 'text' in m ? m.text : '']);
			// Text after the tool is its own message, below the tool card.
			expect(kinds).toEqual([['user', 'q'], ['assistant', 'A'], ['tool', ''], ['assistant', 'B']]);
			const [a, b] = c.messages.filter((m) => m.kind === 'assistant') as { segMs?: number; turn?: { segments: number; elapsed: number } }[];
			expect(a.segMs).toBe(2000);
			expect(b.segMs).toBe(1400);
			expect(b.turn).toMatchObject({ segments: 2, elapsed: 4000 });
			expect(c.call).toBeNull();
			expect(c.runMs).toBe(4000);
		} finally {
			vi.useRealTimers();
		}
	});

	it('times the wait to the first token from the request on engines without a connect event', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(100);
			const c = new ChatState();
			c.backendId = 'claude';
			c.handle({ type: 'connecting' } as never);
			expect(c.call).toEqual({ phase: 'ttft', since: 100 });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('claude session extras', () => {
	it('lists background tasks with their progress and announces finished ones', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'background_tasks', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Review' }] });
		c.handle({ type: 'task_progress', task_id: 'w1', message: 'Find: bugs-0' });
		expect(c.bgTasks).toEqual([{ id: 'w1', kind: 'local_workflow', description: 'Review', message: 'Find: bugs-0' }]);
		// A new listing keeps a task's latest progress line.
		c.handle({ type: 'background_tasks', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Review' }] });
		expect(c.bgTasks[0].message).toBe('Find: bugs-0');
		c.handle({ type: 'background_tasks', tasks: [] });
		c.handle({ type: 'task_done', task_id: 'w1', kind: 'local_workflow', status: 'completed', summary: 'Review done' });
		expect(c.bgTasks).toEqual([]);
		expect(c.messages.at(-1)).toEqual({ kind: 'system', text: '多智能体编排已完成：Review done' });
		c.handle({ type: 'task_output', task_id: 'b1', output: 'ok', truncated: true });
		expect(c.taskOutputs.b1).toEqual({ output: 'ok', truncated: true, error: '' });
	});

	it('fills a pending /btw answer in place', () => {
		const c = new ChatState();
		c.sideAnswers.push({ question: 'why?', answer: '', error: '', pending: true });
		c.handle({ type: 'side_answer', question: 'why?', answer: 'Because.' });
		expect(c.sideAnswers).toEqual([{ question: 'why?', answer: 'Because.', error: '', pending: false }]);
		// The conversation is untouched.
		expect(c.messages).toEqual([]);
	});

	it('keeps a suggestion until the next turn starts', () => {
		const c = new ChatState();
		c.handle({ type: 'prompt_suggestion', text: 'run the tests' });
		expect(c.suggestion).toBe('run the tests');
		c.handle({ type: 'connecting' });
		expect(c.suggestion).toBe('');
	});

	it('names fallbacks, subagents and session switches', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'model_fallback', from: 'Opus 5.5', to: 'Sonnet 5.5', reason: 'overloaded' });
		expect(c.messages.at(-1)).toEqual({ kind: 'system', text: '模型已从 Opus 5.5 切换到 Sonnet 5.5（原模型过载）' });
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan auth', status: 'running', message: 'Reading' });
		expect(c.subagents.a1).toMatchObject({ status: 'running', message: 'Reading', label: 'Scan auth' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'read', subagent: 'Scan auth' });
		expect(c.messages.at(-1)).toMatchObject({ kind: 'tool', subagent: 'Scan auth' });
		expect(c.subagentLastTool['Scan auth']).toMatchObject({ callId: 't2', name: 'read' });
		// A finished subagent stays (the progress card shows it) until the next turn.
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan auth', status: 'completed', message: '' });
		expect(c.subagents.a1).toMatchObject({ status: 'completed', label: 'Scan auth' });
		expect(c.subagents.a1.endedAt).toBeGreaterThan(0);
		c.handle({ type: 'connecting' });
		expect(c.subagents.a1).toBeUndefined();
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', fast: true, fast_available: true, thinking_summaries: false, state: 'idle' });
		expect([c.fast, c.fastAvailable, c.thinkingSummaries]).toEqual([true, true, false]);
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		expect([c.fast, c.fastAvailable, c.thinkingSummaries]).toEqual([false, false, null]);
	});

	it('reads the agent trace and a subagent conversation', () => {
		const c = new ChatState();
		c.handle({
			type: 'agent_runs',
			workflows: [
				{
					id: 'w1',
					tool_use_id: 't0',
					name: 'review',
					status: 'running',
					started_at: 100,
					tokens: 900,
					phases: [{ index: 1, title: 'Find' }],
					agents: [{ id: 'a1', label: 'bugs-0', phase: 1, state: 'running', started_at: 120, tokens: 900, tool_calls: 2 }]
				}
			],
			agents: [{ id: 'a9', label: 'Read a.txt', status: 'completed', tool_use_id: 't1', tokens: 30420, duration_ms: 4529 }]
		});
		expect(c.agentRuns.workflows[0].agents[0]).toMatchObject({ id: 'a1', phase: 1, state: 'running', toolCalls: 2 });
		expect(c.agentRuns.agents[0]).toMatchObject({ id: 'a9', state: 'completed', toolUseId: 't1', durationMs: 4529 });
		c.handle({
			type: 'subagent_transcript',
			agent_id: 'a1',
			items: [
				{ role: 'user', content: 'Find bugs' },
				{ role: 'reasoning', content: 'Look.' },
				{ role: 'tool', call_id: 't2', name: 'read', output: '{"path":"/a"}', running: false, is_error: false },
				{ role: 'assistant', content: 'None.' }
			]
		});
		const tr = c.subagentTranscripts.a1;
		expect(tr.task).toBe('Find bugs');
		expect(tr.messages.map((m) => m.kind)).toEqual(['reasoning', 'tool', 'assistant']);
		// The session's own conversation is untouched.
		expect(c.messages).toEqual([]);
	});

	it('keeps a subagent call’s arguments once its result replaces them', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 't1', name: 'Task' });
		c.handle({ type: 'tool_update', call_id: 't1', output: '{"description":"Scan auth","prompt":"Find it"}' });
		c.handle({ type: 'tool_output', call_id: 't1', name: 'Task', output: 'Found it in auth.ts', is_error: false });
		expect(c.messages.at(-1)).toMatchObject({ output: 'Found it in auth.ts', args: '{"description":"Scan auth","prompt":"Find it"}' });
	});

	it('reads a JuCode subagent from its spawn call and its lifecycle', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'tool_start', call_id: 'call_1', name: 'spawn_agent' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'pending', message: 'reserved' });
		c.handle({ type: 'tool_output', call_id: 'call_1', name: 'spawn_agent', output: '{"task_name":"scan","path":"/root/scan","status":"running"}', is_error: false });
		expect(c.subagents['/root/scan']).toMatchObject({ status: 'pending', label: 'scan', toolUseId: 'call_1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'running', message: 'started', model: 'gpt-5.5' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'message', message: 'queued message' });
		expect(c.subagents['/root/scan']).toMatchObject({ status: 'running', model: 'gpt-5.5', toolUseId: 'call_1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'errored', message: 'timeout' });
		expect(c.subagents['/root/scan'].endedAt).toBeGreaterThan(0);
	});

	it('reads the native agent trace’s activity and effort, and tool inputs in a transcript', () => {
		const c = new ChatState();
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: '/root/x', label: 'x', state: 'running', activity: 'Ran cargo test', effort: 'low', tool_use_id: 'c9' }] });
		expect(c.agentRunsSeen).toBe(true);
		expect(c.agentRuns.agents[0]).toMatchObject({ state: 'running', activity: 'Ran cargo test', effort: 'low', toolUseId: 'c9' });
		c.handle({ type: 'subagent_transcript', agent_id: '/root/x', items: [{ role: 'user', content: 'go' }, { role: 'tool', call_id: 't', name: 'bash', input: { command: 'ls' }, running: true }] });
		expect(c.subagentTranscripts['/root/x'].messages[0]).toMatchObject({ kind: 'tool', output: '{"command":"ls"}', running: true });
	});

	it('takes an older engine’s refusal of the trace ops quietly', () => {
		setLocale('zh');
		const c = new ChatState();
		c.agentFocus = '/root/x';
		c.handle({ type: 'error', message: 'unknown op: agent_runs' });
		c.handle({ type: 'error', message: 'unknown op: subagent_transcript' });
		expect(c.messages).toEqual([]);
		expect(c.lastError).toBeNull();
		expect(c.subagentTranscripts['/root/x'].error).toBeTruthy();
	});

	it('shows a proposed plan and follows its status', () => {
		const c = new ChatState();
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Fix auth', markdown: '## Steps\n1. a', status: 'pending' });
		expect(c.messages.at(-1)).toEqual({ kind: 'plan', id: 'p1', title: 'Fix auth', text: '## Steps\n1. a', status: 'pending' });
		c.planRevising = 'p1';
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Fix auth', markdown: '## Steps\n1. a', status: 'revising' });
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0]).toMatchObject({ status: 'revising' });
		expect(c.planRevising).toBeNull();
		c.handle({ type: 'proposed_plan', id: 'p2', title: 'Fix auth v2', markdown: 'x', status: 'odd' });
		expect(c.messages.at(-1)).toMatchObject({ id: 'p2', status: 'pending' });
		c.handle({ type: 'transcript', items: [{ role: 'plan', id: 'p2', title: 'T', content: 'body', status: 'approved' }] });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p2', title: 'T', text: 'body', status: 'approved' }]);
	});

	it('remembers the mode before plan mode and when the plan changed', () => {
		const c = new ChatState();
		c.setApprovalMode('edits');
		c.setApprovalMode('plan');
		c.setApprovalMode('plan');
		expect(c.modeBeforePlan).toBe('edits');
		c.handle({ type: 'plan', plan: [{ step: 'a', status: 'pending' }] });
		const at = c.planAt;
		expect(at).toBeGreaterThan(0);
		c.handle({ type: 'connecting' });
		expect(c.turnStartedAt).toBeGreaterThan(0);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.turnEndedAt).toBeGreaterThanOrEqual(c.turnStartedAt);
	});

	it('shows the images a message was sent with, live and in a transcript', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'look', images: ['/u/a.png'] });
		expect(c.messages.at(-1)).toEqual({ kind: 'user', text: 'look', images: ['/u/a.png'] });
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'look', images: ['/u/a.png'] }, { role: 'user', content: 'plain' }] });
		expect(c.messages).toEqual([
			{ kind: 'user', text: 'look', images: ['/u/a.png'] },
			{ kind: 'user', text: 'plain' }
		]);
	});

	it('keeps an elicitation page with its approval', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'a', name: 'mcp_elicitation', summary: 'jira: sign in', url: 'https://x.test/auth', hunks: null });
		expect(c.pendingApproval?.url).toBe('https://x.test/auth');
	});
});


describe('gateway session costs', () => {
	it('uses settled per-turn charges, including group changes, without repricing history', () => {
		const c = new ChatState();
		for (const id of ['t-first', 't-second']) {
			c.handle({ type: 'user_message', content: id });
			c.handle({ type: 'connecting' });
			c.handle({ type: 'assistant_delta', delta: 'answer' });
			c.handle({ type: 'usage', input_tokens: 1000, output_tokens: 500, billing_turn: id, billing_gateway: true });
			c.handle({ type: 'context_usage', tokens: 1500, cost: 9 });
			c.handle({ type: 'status', message: 'ready' });
		}
		const charge = (gateway_cost: number) => ({ gateway_cost, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 0, unpriced_requests: 0 });
		const snapshot = { type: 'session_usage', totals: { ...charge(0.08), gateway_requests: 2 }, turns: [
			{ ...charge(0.05), turn_id: 't-first' }, { ...charge(0.03), turn_id: 't-second' }
		] };
		c.handle(snapshot);
		c.handle(snapshot); // refresh replaces, never adds or multiplies again
		expect(c.billing?.gateway_cost).toBe(0.08);
		const costs = c.messages.flatMap(m => m.kind === 'assistant' && m.turn ? [m.turn.billing?.gateway_cost] : []);
		expect(costs).toEqual([0.05, 0.03]);
		c.handle({ type: 'session_usage', billing_error: 'offline' });
		expect(c.billing?.gateway_cost).toBe(0.08);
		expect(c.billingError).toBe('offline');
	});

	it('marks gateway usage pending before settlement and accepts a zero charge', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		c.handle({ type: 'status', message: 'ready' });
		// A late usage frame still belongs to the turn which just ended.
		c.handle({ type: 'usage', input_tokens: 10, output_tokens: 2, billing_turn: 't-free', billing_gateway: true });
		expect(c.billing?.pending_requests).toBeGreaterThan(0);
		const free = { gateway_cost: 0, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 0, unpriced_requests: 0 };
		c.handle({ type: 'session_usage', totals: free, turns: [{ ...free, turn_id: 't-free' }] });
		expect(c.billing?.gateway_cost).toBe(0);
		const last = c.messages.at(-1);
		expect(last?.kind === 'assistant' && last.turn?.billing?.gateway_cost).toBe(0);
	});
});
