import { describe, it, expect } from 'vitest';
import { createClaudeAdapter, CLAUDE_CAPS, toClaudeMode, fromClaudeMode } from './claude';
import type { EngineAdapter, SessionCtx } from './types';

// Fixtures below are condensed from live `claude --print --input-format
// stream-json --output-format stream-json --include-partial-messages --verbose
// --replay-user-messages --permission-prompt-tool stdio` sessions (claude
// 2.1.208): system/init per turn, stream_event partial messages, assistant
// block-completion frames, user tool_result echoes, can_use_tool control
// requests and result frames.

const CTX: SessionCtx = { cwd: '/proj', approvalMode: 'ask', sessionId: 'desktop-1' };
const SID = '67e1b508-9ad8-4177-a35f-b1bacba3f46c';

function makeIo() {
	const lines: string[] = [];
	return { lines, io: { sendLine: (l: string) => lines.push(l) } };
}

const parse = (line: string) => JSON.parse(line) as Record<string, any>;

const initFrame = (over: Record<string, unknown> = {}) => ({
	type: 'system',
	subtype: 'init',
	cwd: '/proj',
	session_id: SID,
	tools: ['Task', 'Bash', 'Edit', 'Read', 'Write'],
	model: 'claude-opus-4-8[1m]',
	permissionMode: 'default',
	slash_commands: ['compact'],
	apiKeySource: 'none',
	claude_code_version: '2.1.208',
	...over
});

const requesting = { type: 'system', subtype: 'status', status: 'requesting', session_id: SID };

// Model catalog as returned by the live list_models control request (2.1.208).
const CATALOG = [
	{
		value: 'default',
		resolvedModel: 'claude-opus-4-8[1m]',
		displayName: 'Default (recommended)',
		description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
	},
	{
		value: 'opus[1m]',
		resolvedModel: 'claude-opus-4-8[1m]',
		displayName: 'Opus',
		description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
	},
	{
		value: 'sonnet',
		resolvedModel: 'claude-sonnet-5',
		displayName: 'Sonnet',
		description: 'Sonnet 5 · Efficient for routine tasks',
		supportsEffort: true,
		supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
	},
	{ value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' }
];

/** onStart + acks of the bootstrap set_permission_mode / list_models prefetch
 *  + first init. */
function boot(adapter: EngineAdapter, lines: string[], ctx: SessionCtx = CTX) {
	adapter.onStart({ sendLine: (l: string) => lines.push(l) }, ctx);
	const bootId = parse(lines[0]).request_id;
	adapter.translate({
		type: 'control_response',
		response: { subtype: 'success', request_id: bootId, response: { mode: parse(lines[0]).request.mode } }
	});
	const listId = parse(lines[1]).request_id;
	adapter.translate({
		type: 'control_response',
		response: { subtype: 'success', request_id: listId, response: { models: CATALOG } }
	});
	return adapter.translate(initFrame());
}

const streamEvent = (event: Record<string, unknown>) => ({
	type: 'stream_event',
	event,
	session_id: SID,
	parent_tool_use_id: null
});

describe('claude adapter: caps', () => {
	it('advertises exactly what the adapter implements', () => {
		const adapter = createClaudeAdapter();
		expect(adapter.id).toBe('claude');
		expect(adapter.caps).toEqual(CLAUDE_CAPS);
		expect(adapter.caps.approvalModes).toBe(true);
		expect(adapter.caps.interrupt).toBe(true);
		expect(adapter.caps.contextUsage).toBe(true);
		expect(adapter.caps.steer).toBe(false);
		expect(adapter.caps.hunkApproval).toBe(false);
		// list_models/set_model control requests, /compact over stream-json text,
		// claude_sessions-driven resume picker + session-file transcript replay.
		expect(adapter.caps.modelPicker).toBe(true);
		expect(adapter.caps.compact).toBe(true);
		expect(adapter.caps.resume).toBe(true);
		expect(adapter.caps.transcriptReplay).toBe(true);
		expect(adapter.caps.slashCommands).toBe(false);
	});
});

describe('claude adapter: startup', () => {
	it('onStart pushes the desktop approval mode and prefetches the model catalog', () => {
		// Non-yolo modes are set live (set_permission_mode) + a model prefetch.
		for (const [approvalMode, claudeMode] of [
			['ask', 'default'],
			['edits', 'acceptEdits']
		] as const) {
			const { lines, io } = makeIo();
			const adapter = createClaudeAdapter();
			adapter.onStart(io, { ...CTX, approvalMode });
			expect(lines).toHaveLength(2);
			const frame = parse(lines[0]);
			expect(frame.type).toBe('control_request');
			expect(frame.request).toEqual({ subtype: 'set_permission_mode', mode: claudeMode });
			expect(parse(lines[1]).request).toEqual({ subtype: 'list_models' });
		}
	});

	it('onStart skips the live set for yolo (bypassPermissions is rejected unless launched with the flag)', () => {
		const { lines, io } = makeIo();
		const adapter = createClaudeAdapter();
		adapter.onStart(io, { ...CTX, approvalMode: 'all' });
		// Only the list_models prefetch — no set_permission_mode (it would error;
		// the --dangerously-skip-permissions spawn flag already set yolo mode).
		expect(lines).toHaveLength(1);
		expect(parse(lines[0]).request).toEqual({ subtype: 'list_models' });
	});

	it('the list_models prefetch ack seeds the model button before the first turn', () => {
		// Bug: a new claude session showed the "model" placeholder until the first
		// message, because the real model only arrives with the first system/init.
		// The onStart list_models prefetch now seeds it from the default alias.
		const { lines, io } = makeIo();
		const adapter = createClaudeAdapter();
		adapter.onStart(io, CTX);
		adapter.translate({
			type: 'control_response',
			response: { subtype: 'success', request_id: parse(lines[0]).request_id, response: { mode: 'default' } }
		});
		const seeded = adapter.translate({
			type: 'control_response',
			response: { subtype: 'success', request_id: parse(lines[1]).request_id, response: { models: CATALOG } }
		});
		expect(seeded).toEqual([
			{
				type: 'model_status',
				provider: 'anthropic',
				// The default/recommended alias's concrete resolvedModel + compact label.
				model: 'claude-opus-4-8[1m]',
				model_label: 'Opus 4.8 (1M)',
				reasoning_effort: 'medium',
				reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
				context_window: 0,
				context_limit: 0
			}
		]);
		// The first init reports the same resolved model → no duplicate model_status
		// (init still emits the full startup sequence regardless).
		const init = adapter.translate(initFrame());
		expect(init).toHaveLength(5);
		expect(init[0]).toMatchObject({ type: 'startup', model: 'claude-opus-4-8[1m]' });
	});

	it('the bootstrap ack doubles as the readiness signal (init only arrives with the first turn)', () => {
		const { lines, io } = makeIo();
		const adapter = createClaudeAdapter();
		adapter.onStart(io, { ...CTX, approvalMode: 'edits' });
		const ackId = parse(lines[0]).request_id;
		const events = adapter.translate({
			type: 'control_response',
			response: { subtype: 'success', request_id: ackId, response: { mode: 'acceptEdits' } }
		});
		expect(events).toHaveLength(3);
		expect(events[0]).toEqual({ type: 'approval_mode', mode: 'auto-edit' });
		expect(events[1].type).toBe('command_list');
		expect(events[2]).toEqual({ type: 'status', message: 'ready' });
	});

	it('the first system/init emits startup / model_status / command_list / approval_mode / ready', () => {
		const { lines, io } = makeIo();
		const adapter = createClaudeAdapter();
		adapter.onStart(io, CTX);
		const events = adapter.translate(initFrame());
		expect(events).toHaveLength(5);
		expect(events[0]).toEqual({
			type: 'startup',
			model: 'claude-opus-4-8[1m]',
			cwd: '/proj',
			session_id: SID,
			context_window: 0
		});
		expect(events[1]).toEqual({
			type: 'model_status',
			provider: 'anthropic',
			model: 'claude-opus-4-8[1m]',
			model_label: 'Opus 4.8 (1M)',
			reasoning_effort: 'medium',
			reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
			context_window: 0,
			context_limit: 0
		});
		// The composer's slash autocomplete learns the wired commands.
		expect(events[2].type).toBe('command_list');
		expect((events[2].commands as { command: string }[]).map((c) => c.command)).toEqual([
			'/model',
			'/resume',
			'/compact'
		]);
		expect(events[3]).toEqual({ type: 'approval_mode', mode: 'read-only' });
		expect(events[4]).toEqual({ type: 'status', message: 'ready' });
	});

	it('re-emitted per-turn inits are silent unless the model or mode changed', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(adapter.translate(initFrame())).toEqual([]);
		expect(adapter.translate(initFrame({ permissionMode: 'acceptEdits' }))).toEqual([
			{ type: 'approval_mode', mode: 'auto-edit' }
		]);
	});
});

describe('claude adapter: turns', () => {
	it('user_message encodes a stream-json user frame', () => {
		const adapter = createClaudeAdapter();
		const { lines } = makeIo();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'say hi' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: 'say hi' }] }
		});
	});

	it('references image attachments as Read-able paths (no local-image block exists)', () => {
		const adapter = createClaudeAdapter();
		const { lines } = makeIo();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'look', images: ['/tmp/shot.png'] });
		const content = parse(frames![0]).message.content;
		expect(content[0]).toEqual({ type: 'text', text: 'look' });
		expect(content[1].type).toBe('text');
		expect(content[1].text).toContain('/tmp/shot.png');
	});

	it('translates a recorded text turn into the normalized event stream', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(adapter.translate(requesting)).toEqual([{ type: 'connecting' }]);
		expect(
			adapter.translate(
				streamEvent({
					type: 'message_start',
					message: {
						id: 'msg_1',
						model: 'claude-opus-4-8',
						usage: { input_tokens: 2, cache_creation_input_tokens: 5532, cache_read_input_tokens: 15002, output_tokens: 1 }
					}
				})
			)
		).toEqual([{ type: 'context_usage', tokens: 20536 }]);
		expect(
			adapter.translate(streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
		).toEqual([{ type: 'assistant_start' }]);
		expect(
			adapter.translate(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'h' } }))
		).toEqual([{ type: 'assistant_delta', delta: 'h' }]);
		// The stdin echo (isReplay) resurfaces as user_message (ChatState dedupes
		// the optimistic case; queued busy sends rely on this to appear at all).
		expect(
			adapter.translate({
				type: 'user',
				message: { role: 'user', content: [{ type: 'text', text: 'say hi' }] },
				session_id: SID,
				parent_tool_use_id: null,
				isReplay: true
			})
		).toEqual([{ type: 'user_message', content: 'say hi' }]);
		// The assistant completion frame re-delivers the full text; only the
		// unseen tail is emitted.
		expect(
			adapter.translate({
				type: 'assistant',
				message: { id: 'msg_1', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'hi' }] },
				session_id: SID,
				parent_tool_use_id: null
			})
		).toEqual([{ type: 'assistant_delta', delta: 'i' }]);
		expect(
			adapter.translate(
				streamEvent({
					type: 'message_delta',
					delta: { stop_reason: 'end_turn' },
					usage: { input_tokens: 2, cache_creation_input_tokens: 5532, cache_read_input_tokens: 15002, output_tokens: 4 }
				})
			)
		).toEqual([
			{ type: 'usage', input_tokens: 20536, output_tokens: 4 },
			{ type: 'context_usage', tokens: 20540 }
		]);
		const done = adapter.translate({
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: 'hi',
			session_id: SID,
			num_turns: 1,
			total_cost_usd: 0.063512,
			usage: { input_tokens: 2, output_tokens: 4 },
			modelUsage: { 'claude-opus-4-8[1m]': { contextWindow: 1000000 } }
		});
		expect(done).toEqual([
			{
				type: 'model_status',
				provider: 'anthropic',
				model: 'claude-opus-4-8[1m]',
				model_label: 'Opus 4.8 (1M)',
				reasoning_effort: 'medium',
				reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
				context_window: 1000000,
				context_limit: 0
			},
			{ type: 'context_usage', tokens: 20540, cost: 0.063512 },
			{ type: 'status', message: 'ready' }
		]);
	});

	it('maps thinking deltas to reasoning_delta and skips signature-only blocks', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate(streamEvent({ type: 'message_start', message: { id: 'm', model: 'x', usage: {} } }));
		expect(
			adapter.translate(
				streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } })
			)
		).toEqual([]);
		expect(
			adapter.translate(
				streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pondering' } })
			)
		).toEqual([{ type: 'reasoning_delta', delta: 'pondering' }]);
		expect(
			adapter.translate(
				streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'Eq…' } })
			)
		).toEqual([]);
		// Completion frame: already streamed → silent (signature is never text).
		expect(
			adapter.translate({
				type: 'assistant',
				message: { id: 'm', model: 'x', content: [{ type: 'thinking', thinking: 'pondering', signature: 'Eq…' }] },
				session_id: SID,
				parent_tool_use_id: null
			})
		).toEqual([]);
	});

	it('maps Bash tool_use / tool_result to bash tool cards (structured stdout)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate(streamEvent({ type: 'message_start', message: { id: 'm', model: 'x', usage: {} } }));
		// Streaming start carries an empty input; the completion frame is authoritative.
		const started = adapter.translate(
			streamEvent({
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }
			})
		);
		expect(started).toEqual([
			{ type: 'tool_start', call_id: 'toolu_1', name: 'bash' },
			{ type: 'tool_update', call_id: 'toolu_1', output: JSON.stringify({ command: '' }) }
		]);
		const completed = adapter.translate({
			type: 'assistant',
			message: {
				id: 'm',
				model: 'x',
				content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo probe-ok', description: 'Echo' } }]
			},
			session_id: SID,
			parent_tool_use_id: null
		});
		expect(completed).toEqual([
			{ type: 'tool_update', call_id: 'toolu_1', output: JSON.stringify({ command: 'echo probe-ok' }) }
		]);
		const result = adapter.translate({
			type: 'user',
			message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'probe-ok', is_error: false }] },
			session_id: SID,
			parent_tool_use_id: null,
			tool_use_result: { stdout: 'probe-ok', stderr: '', interrupted: false }
		});
		expect(result).toEqual([
			{
				type: 'tool_output',
				call_id: 'toolu_1',
				name: 'bash',
				output: JSON.stringify({ command: 'echo probe-ok', stdout: 'probe-ok' }),
				is_error: false
			}
		]);
	});

	it('fills a tool card from chunked input_json_delta (streaming, no authoritative frame)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate(streamEvent({ type: 'message_start', message: { id: 'm', model: 'x', usage: {} } }));
		adapter.translate(
			streamEvent({
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'tool_use', id: 'toolu_s', name: 'Bash', input: {} }
			})
		);
		// The input streams as JSON chunks; a partial chunk doesn't parse yet.
		expect(
			adapter.translate(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"comm' } }))
		).toEqual([]);
		// Completing the JSON refreshes the card with the real command — with NO
		// authoritative assistant frame (the real stream may never send one).
		expect(
			adapter.translate(streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'and":"ls -la"}' } }))
		).toEqual([{ type: 'tool_update', call_id: 'toolu_s', output: JSON.stringify({ command: 'ls -la' }) }]);
		// The result still resolves the command from the accumulated input.
		const result = adapter.translate({
			type: 'user',
			message: { role: 'user', content: [{ tool_use_id: 'toolu_s', type: 'tool_result', content: 'a\nb', is_error: false }] },
			session_id: SID,
			parent_tool_use_id: null,
			tool_use_result: { stdout: 'a\nb', stderr: '', interrupted: false }
		});
		expect(result).toEqual([
			{ type: 'tool_output', call_id: 'toolu_s', name: 'bash', output: JSON.stringify({ command: 'ls -la', stdout: 'a\nb' }), is_error: false }
		]);
	});

	it('turns TodoWrite into a plan event (not a per-call tool card)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const todos = [
			{ content: 'Read files', status: 'completed' },
			{ content: 'Write blog', status: 'in_progress' },
			{ content: 'Verify', status: 'pending' }
		];
		const events = adapter.translate({
			type: 'assistant',
			message: { id: 'm', model: 'x', content: [{ type: 'tool_use', id: 'toolu_td', name: 'TodoWrite', input: { todos } }] },
			session_id: SID,
			parent_tool_use_id: null
		});
		expect(events).toEqual([
			{
				type: 'plan',
				plan: [
					{ step: 'Read files', status: 'completed' },
					{ step: 'Write blog', status: 'in_progress' },
					{ step: 'Verify', status: 'pending' }
				]
			}
		]);
		// No tool_start card for TodoWrite.
		expect(events.some((e) => e.type === 'tool_start')).toBe(false);
	});

	it('creates tool cards for server_tool_use / mcp_tool_use blocks (not just tool_use)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate(streamEvent({ type: 'message_start', message: { id: 'm', model: 'x', usage: {} } }));
		// WebSearch arrives as server_tool_use — previously dropped → no card.
		const started = adapter.translate(
			streamEvent({
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'server_tool_use', id: 'srv_1', name: 'WebSearch', input: {} }
			})
		);
		expect(started).toContainEqual({ type: 'tool_start', call_id: 'srv_1', name: 'web_search' });
		// mcp_tool_use likewise.
		const mcp = adapter.translate(
			streamEvent({
				type: 'content_block_start',
				index: 1,
				content_block: { type: 'mcp_tool_use', id: 'mcp_1', name: 'mcp__ctx7__query', input: {} }
			})
		);
		expect(mcp.some((e) => e.type === 'tool_start' && e.call_id === 'mcp_1')).toBe(true);
	});

	it('surfaces the init frame mcp_servers and a permission_denied notice', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		const events = adapter.translate({
			...initFrame(),
			mcp_servers: [{ name: 'context7', status: 'connected' }]
		});
		expect(events).toContainEqual({
			type: 'mcp_servers',
			servers: [{ name: 'context7', transport: 'stdio', state: 'connected', tools: [] }]
		});
		const denied = adapter.translate({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', reason: 'blocked by rule' });
		expect(denied).toEqual([{ type: 'info', message: '[claude] bash denied: blocked by rule' }]);
	});

	it('maps Edit/Write to edit-tool cards with path + diff (Changes panel shape)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate({
			type: 'assistant',
			message: {
				id: 'm',
				model: 'x',
				content: [
					{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: '/proj/a.ts', old_string: 'foo', new_string: 'bar' } }
				]
			},
			session_id: SID,
			parent_tool_use_id: null
		});
		const done = adapter.translate({
			type: 'user',
			message: { role: 'user', content: [{ tool_use_id: 'toolu_e', type: 'tool_result', content: 'ok', is_error: false }] },
			session_id: SID,
			parent_tool_use_id: null
		});
		expect(done).toHaveLength(1);
		expect(done[0]).toMatchObject({ type: 'tool_output', call_id: 'toolu_e', name: 'str_replace', is_error: false });
		expect(JSON.parse(String(done[0].output))).toEqual({
			path: '/proj/a.ts',
			paths: ['/proj/a.ts'],
			diff: '-foo\n+bar'
		});

		adapter.translate({
			type: 'assistant',
			message: {
				id: 'm',
				model: 'x',
				content: [{ type: 'tool_use', id: 'toolu_w', name: 'Write', input: { file_path: '/proj/b.txt', content: 'hello' } }]
			},
			session_id: SID,
			parent_tool_use_id: null
		});
		const wrote = adapter.translate({
			type: 'user',
			message: { role: 'user', content: [{ tool_use_id: 'toolu_w', type: 'tool_result', content: 'created', is_error: false }] },
			session_id: SID,
			parent_tool_use_id: null
		});
		expect(wrote[0]).toMatchObject({ name: 'write', is_error: false });
		expect(JSON.parse(String(wrote[0].output))).toEqual({ path: '/proj/b.txt', paths: ['/proj/b.txt'], diff: '+hello' });
	});

	it('flags failed tool results and preserves the error text', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate({
			type: 'assistant',
			message: { id: 'm', model: 'x', content: [{ type: 'tool_use', id: 'toolu_x', name: 'Write', input: { file_path: '/etc/x', content: 'v' } }] },
			session_id: SID,
			parent_tool_use_id: null
		});
		const denied = adapter.translate({
			type: 'user',
			message: {
				role: 'user',
				content: [{ type: 'tool_result', content: 'probe denies this', is_error: true, tool_use_id: 'toolu_x' }]
			},
			session_id: SID,
			parent_tool_use_id: null,
			tool_use_result: 'Error: probe denies this'
		});
		expect(denied[0]).toMatchObject({ type: 'tool_output', name: 'write', is_error: true });
		expect(JSON.parse(String(denied[0].output))).toEqual({ path: '/etc/x', error: 'probe denies this' });
	});

	it('drops Task-subagent chatter (text/reasoning) and synthetic user notices', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		// Subagent text stream is dropped (we don't render subagent chatter).
		expect(
			adapter.translate(
				{ ...streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'inner' } }), parent_tool_use_id: 'toolu_task' }
			)
		).toEqual([]);
		expect(
			adapter.translate({
				type: 'user',
				message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
				session_id: SID,
				parent_tool_use_id: null
			})
		).toEqual([]);
	});

	it('surfaces a Task-subagent tool so its card fills and completes (bug: stuck running)', () => {
		// A subagent's inner tool frames carry a non-null parent_tool_use_id. The
		// old guard dropped EVERY such frame, so the card never filled its input and
		// never completed — empty + spinning forever. Now the tool activity is
		// surfaced (its assistant text / reasoning / user echoes stay dropped).
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		// The subagent's streamed tool_use start (non-authoritative, empty input).
		const start = adapter.translate({
			...streamEvent({
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'tool_use', id: 'toolu_sub', name: 'Read', input: {} }
			}),
			parent_tool_use_id: 'toolu_task'
		});
		expect(start).toEqual([
			{ type: 'tool_start', call_id: 'toolu_sub', name: 'read' },
			{ type: 'tool_update', call_id: 'toolu_sub', output: JSON.stringify({ path: '' }) }
		]);
		// The authoritative assistant tool_use frame fills the input.
		const filled = adapter.translate({
			type: 'assistant',
			message: {
				id: 'm',
				model: 'x',
				content: [{ type: 'tool_use', id: 'toolu_sub', name: 'Read', input: { file_path: '/proj/x.ts' } }]
			},
			session_id: SID,
			parent_tool_use_id: 'toolu_task'
		});
		expect(filled).toEqual([
			{ type: 'tool_update', call_id: 'toolu_sub', output: JSON.stringify({ path: '/proj/x.ts' }) }
		]);
		// The subagent's tool_result completes the card.
		const done = adapter.translate({
			type: 'user',
			message: {
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: 'file body', is_error: false }]
			},
			session_id: SID,
			parent_tool_use_id: 'toolu_task'
		});
		expect(done).toEqual([
			{ type: 'tool_output', call_id: 'toolu_sub', name: 'read', output: JSON.stringify({ path: '/proj/x.ts' }), is_error: false }
		]);
	});

	it('fills a subagent inner tool card from its streamed input_json_delta', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const sub = (event: Record<string, unknown>) => ({ ...streamEvent(event), parent_tool_use_id: 'toolu_task' });
		adapter.translate(
			sub({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_si', name: 'Bash', input: {} } })
		);
		// The subagent's inner tool input streams the same way the main agent's does.
		expect(adapter.translate(sub({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"comm' } }))).toEqual([]);
		expect(
			adapter.translate(sub({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'and":"ls"}' } }))
		).toEqual([{ type: 'tool_update', call_id: 'toolu_si', output: JSON.stringify({ command: 'ls' }) }]);
	});
});

describe('claude adapter: approvals', () => {
	const canUseBash = {
		type: 'control_request',
		request_id: '77380cad-d824-4dbf-96f0-354512b99488',
		request: {
			subtype: 'can_use_tool',
			tool_name: 'Bash',
			display_name: 'Bash',
			input: { command: 'mkdir probe-dir', description: 'Create probe-dir directory' },
			description: 'Create probe-dir directory',
			permission_suggestions: [
				{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'mkdir probe-dir *' }], behavior: 'allow', destination: 'localSettings' },
				{ type: 'addDirectories', directories: ['/proj'], destination: 'session' },
				{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }
			],
			blocked_path: '/proj/probe-dir',
			tool_use_id: 'toolu_01UET'
		}
	};

	it('bridges can_use_tool round-trips through the synthetic call_id registry', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const events = adapter.translate(canUseBash);
		// The approval request also fills the tool card from its input (so the card
		// shows the command even in ask mode, before it streams/completes).
		expect(events).toContainEqual({ type: 'tool_start', call_id: 'toolu_01UET', name: 'bash' });
		expect(events).toContainEqual({ type: 'tool_update', call_id: 'toolu_01UET', output: JSON.stringify({ command: 'mkdir probe-dir' }) });
		const approval = events.find((e) => e.type === 'approval_request')!;
		expect(approval).toMatchObject({
			type: 'approval_request',
			call_id: 'approval-1',
			name: 'bash',
			subagent_id: null,
			hunks: null
		});
		expect(String(approval.summary)).toContain('mkdir probe-dir');

		const frames = adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toEqual({
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: '77380cad-d824-4dbf-96f0-354512b99488',
				response: { behavior: 'allow', updatedInput: { command: 'mkdir probe-dir', description: 'Create probe-dir directory' } }
			}
		});
		// The registry entry is consumed: answering twice is refused.
		expect(adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' })).toBeNull();
	});

	it('deny sends behavior:deny with a message', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate(canUseBash);
		const frames = adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'deny' });
		const resp = parse(frames![0]).response.response;
		expect(resp.behavior).toBe('deny');
		expect(typeof resp.message).toBe('string');
	});

	it('always → native updatedPermissions, rescoped to the session', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate(canUseBash);
		const frames = adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow', always: true });
		const resp = parse(frames![0]).response.response;
		expect(resp.behavior).toBe('allow');
		// The CLI's addRules suggestion is reused, but never written to settings
		// files: destination is forced to 'session'.
		expect(resp.updatedPermissions).toEqual([
			{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'mkdir probe-dir *' }], behavior: 'allow', destination: 'session' }
		]);
	});

	it('always without suggestions synthesizes a whole-tool session rule', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate({
			type: 'control_request',
			request_id: 'req-2',
			request: { subtype: 'can_use_tool', tool_name: 'WebFetch', input: { url: 'https://x.test' }, tool_use_id: 'toolu_wf' }
		});
		const frames = adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow', always: true });
		expect(parse(frames![0]).response.response.updatedPermissions).toEqual([
			{ type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'session' }
		]);
	});

	it('edit-tool prompts carry a diff-ish summary', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const events = adapter.translate({
			type: 'control_request',
			request_id: 'req-3',
			request: {
				subtype: 'can_use_tool',
				tool_name: 'Write',
				input: { file_path: '/proj/probe-note.txt', content: 'hello' },
				description: 'probe-note.txt',
				permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
				tool_use_id: 'toolu_w2'
			}
		});
		// The card is filled from the request; the approval_request follows.
		expect(events).toContainEqual({ type: 'tool_start', call_id: 'toolu_w2', name: 'write' });
		const approval = events.find((e) => e.type === 'approval_request')!;
		expect(approval).toMatchObject({ type: 'approval_request', name: 'write' });
		expect(String(approval.summary)).toBe('/proj/probe-note.txt\n+hello');
	});

	it('surfaces AskUserQuestion as an interactive picker and feeds the answer back', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const questions = [
			{
				question: 'How to handle the existing index.html?',
				header: 'How',
				options: [
					{ label: 'New file', description: 'keep index.html, write blog.html' },
					{ label: 'Overwrite', description: 'replace index.html' }
				],
				multiSelect: false
			}
		];
		const events = adapter.translate({
			type: 'control_request',
			request_id: 'req-q',
			request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_q', input: { questions } }
		});
		// It's a question card, not an allow/deny approval, and carries the questions.
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'approval_request', name: 'ask_question', call_id: 'approval-1', questions });
		// The picked answer rides back on the permission response's updatedInput.answers
		// (keyed by the full question text) — this is what makes the tool run.
		const frames = adapter.encodeOp({
			op: 'approve',
			call_id: 'approval-1',
			decision: 'allow',
			answers: { 'How to handle the existing index.html?': 'New file' }
		});
		expect(parse(frames![0]).response.response).toEqual({
			behavior: 'allow',
			updatedInput: { questions, answers: { 'How to handle the existing index.html?': 'New file' } }
		});
	});

	it('answers unsupported control requests with an error instead of hanging', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const before = lines.length;
		const events = adapter.translate({
			type: 'control_request',
			request_id: 'req-9',
			request: { subtype: 'request_user_dialog' }
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('info');
		expect(parse(lines[before])).toEqual({
			type: 'control_response',
			response: { subtype: 'error', request_id: 'req-9', error: 'unsupported by client: request_user_dialog' }
		});
	});
});

describe('claude adapter: interrupt / modes / results', () => {
	it('interrupt is a no-op frame-wise when idle, a control_request while a turn runs', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(adapter.encodeOp({ op: 'interrupt' })).toEqual([]);
		adapter.translate(requesting);
		const frames = adapter.encodeOp({ op: 'interrupt' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } });
		// The interrupted turn ends with an error_during_execution result — that
		// is expected, not an error: only ready is emitted.
		const done = adapter.translate({
			type: 'result',
			subtype: 'error_during_execution',
			is_error: true,
			num_turns: 2,
			session_id: SID,
			total_cost_usd: 0
		});
		expect(done).toEqual([
			{ type: 'context_usage', tokens: 0, cost: 0 },
			{ type: 'status', message: 'ready' }
		]);
		// Turn over → interrupt is a no-op again.
		expect(adapter.encodeOp({ op: 'interrupt' })).toEqual([]);
	});

	it('set_approval_mode sends set_permission_mode; the status frame acks it', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'set_approval_mode', mode: 'full-auto' });
		expect(parse(frames![0]).request).toEqual({ subtype: 'set_permission_mode', mode: 'bypassPermissions' });
		expect(
			adapter.translate({ type: 'system', subtype: 'status', status: null, permissionMode: 'bypassPermissions', session_id: SID })
		).toEqual([{ type: 'approval_mode', mode: 'full-auto' }]);
	});

	it('maps all five approval modes to claude permission modes and back', () => {
		expect(toClaudeMode('read-only')).toBe('default');
		expect(toClaudeMode('plan')).toBe('plan');
		expect(toClaudeMode('auto')).toBe('auto');
		expect(toClaudeMode('auto-edit')).toBe('acceptEdits');
		expect(toClaudeMode('full-auto')).toBe('bypassPermissions');
		for (const m of ['read-only', 'plan', 'auto', 'auto-edit', 'full-auto'] as const)
			expect(fromClaudeMode(toClaudeMode(m))).toBe(m);
		// Aliases the CLI may report.
		expect(fromClaudeMode('manual')).toBe('read-only');
		expect(fromClaudeMode('dontAsk')).toBe('full-auto');
		// plan no longer collapses to read-only (the old bug).
		expect(fromClaudeMode('plan')).toBe('plan');
	});

	it('plan and auto switch live via set_permission_mode + status ack', () => {
		for (const [engineMode, claudeMode] of [
			['plan', 'plan'],
			['auto', 'auto']
		] as const) {
			const { lines } = makeIo();
			const adapter = createClaudeAdapter();
			boot(adapter, lines);
			const frames = adapter.encodeOp({ op: 'set_approval_mode', mode: engineMode });
			expect(parse(frames![0]).request).toEqual({ subtype: 'set_permission_mode', mode: claudeMode });
			expect(
				adapter.translate({ type: 'system', subtype: 'status', status: null, permissionMode: claudeMode, session_id: SID })
			).toEqual([{ type: 'approval_mode', mode: engineMode }]);
		}
	});

	it('extendedApprovalModes cap gates the claude-only plan/auto picker options', () => {
		expect(CLAUDE_CAPS.extendedApprovalModes).toBe(true);
	});

	it('surfaces failed results as error + ready, with login guidance on auth failures', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const failed = adapter.translate({
			type: 'result',
			subtype: 'error_during_execution',
			is_error: true,
			result: 'boom',
			num_turns: 1,
			session_id: SID
		});
		expect(failed).toEqual([
			{ type: 'error', message: 'boom' },
			{ type: 'status', message: 'ready' }
		]);
		const auth = adapter.translate({
			type: 'result',
			subtype: 'error_during_execution',
			is_error: true,
			result: 'Invalid API key · Please run /login',
			num_turns: 1,
			session_id: SID
		});
		expect(auth[0].type).toBe('error');
		expect(String(auth[0].message)).toContain('/login');
	});

	it('does not error-card a benign non-success result (cancelled)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const ev = adapter.translate({ type: 'result', subtype: 'cancelled', is_error: false, num_turns: 1, session_id: SID });
		expect(ev).toEqual([{ type: 'status', message: 'ready' }]);
	});

	it('a failed --resume result becomes resume_failed, not a scary error card', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		// yolo respawn with --resume of an unpersisted session: the CLI emits an
		// error_during_execution result carrying "No conversation found …" then exits.
		const ev = adapter.translate({
			type: 'result',
			subtype: 'error_during_execution',
			is_error: true,
			errors: ['No conversation found with session ID: 00000000-1111-2222-3333-444444444444'],
			num_turns: 0,
			session_id: SID
		});
		expect(ev).toEqual([
			{ type: 'resume_failed' },
			{ type: 'status', message: 'ready' }
		]);
	});

	it('shutdown is accepted silently; unsupported ops are refused', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(adapter.encodeOp({ op: 'shutdown' })).toEqual([]);
		expect(adapter.encodeOp({ op: 'command', input: '/resume x' })).toBeNull();
		expect(adapter.encodeOp({ op: 'steer' })).toBeNull();
		expect(adapter.encodeOp({ op: 'mcp_list' })).toBeNull();
	});
});

describe('claude adapter: model picker', () => {
	it('/model opens the picker: list_models → model_view (jucode shape, value ids)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/model' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0]).request).toEqual({ subtype: 'list_models' });
		const events = adapter.translate({
			type: 'control_response',
			response: {
				subtype: 'success',
				request_id: parse(frames![0]).request_id,
				response: { models: CATALOG }
			}
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('model_view');
		expect(events[0].active_effort).toBe('');
		const rows = events[0].models as {
			model: string;
			label: string;
			vendor: string;
			active: boolean;
			reasoning_efforts: string[];
		}[];
		// The default/recommended alias is filtered out (it duplicates Opus);
		// submitted ids stay the concrete aliases.
		expect(rows.map((r) => r.model)).toEqual(['opus[1m]', 'sonnet', 'haiku']);
		// The picker shows compact concrete names.
		expect(rows.map((r) => r.label)).toEqual(['Opus 4.8 (1M)', 'Sonnet 5', 'Haiku 4.5']);
		// Vendor id keeps the "claude" keyword so the picker shows the claude icon.
		expect(rows.every((r) => /claude/.test(r.vendor))).toBe(true);
		// init model (claude-opus-4-8[1m]) marks the Opus row active.
		expect(rows.map((r) => r.active)).toEqual([true, false, false]);
		// No effort control exists in stream-json mode → submenu stays hidden.
		expect(rows.every((r) => r.reasoning_efforts.length === 0)).toBe(true);
	});

	it('a /model pick sends set_model; the ack resolves the alias and emits model_status', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		// Windows learned from an earlier result frame feed the switched model's ring.
		adapter.translate({
			type: 'result',
			subtype: 'success',
			is_error: false,
			num_turns: 1,
			session_id: SID,
			modelUsage: {
				'claude-opus-4-8[1m]': { contextWindow: 1000000 },
				'claude-haiku-4-5-20251001': { contextWindow: 200000 }
			}
		});
		const frames = adapter.encodeOp({ op: 'command', input: '/model haiku' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0]).request).toEqual({ subtype: 'set_model', model: 'haiku' });
		const events = adapter.translate({
			type: 'control_response',
			response: { subtype: 'success', request_id: parse(frames![0]).request_id }
		});
		expect(events).toEqual([
			{
				type: 'model_status',
				provider: 'anthropic',
				model: 'claude-haiku-4-5-20251001',
				model_label: 'Haiku 4.5',
				reasoning_effort: 'medium',
				reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
				context_window: 200000,
				context_limit: 0
			}
		]);
		// The per-turn init re-announcing the same resolved model stays silent.
		expect(adapter.translate(initFrame({ model: 'claude-haiku-4-5-20251001' }))).toEqual([]);
	});

	it('an effort change sends /effort as user text and surfaces the new level on the next init', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		// The composer sends the current model plus the chosen effort; only the
		// effort moved, so no set_model — just the /effort slash command.
		const frames = adapter.encodeOp({
			op: 'command',
			input: '/model claude-opus-4-8[1m] high'
		});
		expect(frames).toHaveLength(1);
		expect(JSON.parse(frames![0])).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: '/effort high' }] }
		});
		// The /effort turn produces an init with no ack of its own → the new level
		// is flushed as a model_status.
		const events = adapter.translate(initFrame());
		const status = events.find((e) => e.type === 'model_status');
		expect(status?.reasoning_effort).toBe('high');
	});

	it('an unknown model surfaces the CLI error message', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/model bogus-model-xyz' });
		const events = adapter.translate({
			type: 'control_response',
			response: {
				subtype: 'error',
				request_id: parse(frames![0]).request_id,
				error: 'Model "bogus-model-xyz" is not a recognized model id. Run /model to see available models.'
			}
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('error');
		expect(String(events[0].message)).toContain('bogus-model-xyz');
	});

	it('a mid-session init reporting a new model emits model_status (external /model)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const events = adapter.translate(initFrame({ model: 'claude-sonnet-5' }));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'model_status', model: 'claude-sonnet-5' });
	});
});

describe('claude adapter: compaction', () => {
	it('/compact goes out as stream-json user text (the CLI executes slash commands)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/compact' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: '/compact' }] }
		});
	});

	it('surfaces the CLI slash_commands in the autocomplete (custom + built-ins)', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		lines.length = 0;
		const events = adapter.translate({
			...initFrame(),
			slash_commands: ['compact', 'context', 'doctor', 'my-custom']
		});
		const cl = events.find((e) => e.type === 'command_list');
		expect((cl!.commands as { command: string }[]).map((c) => c.command)).toEqual([
			'/model',
			'/resume',
			'/compact',
			'/context',
			'/doctor',
			'/my-custom'
		]);
	});

	it('forwards an unrecognized slash command as stream-json user text', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/context' });
		expect(parse(frames![0])).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: '/context' }] }
		});
		// /resume stays page-driven (fs-based session listing), not forwarded.
		expect(adapter.encodeOp({ op: 'command', input: '/resume' })).toBeNull();
	});

	it('maps the recorded compaction frame sequence to compaction_start/end', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(
			adapter.translate({ type: 'system', subtype: 'status', status: 'compacting', session_id: SID })
		).toEqual([{ type: 'compaction_start' }]);
		// Compaction is a running "turn": the stop button can interrupt it.
		expect(adapter.encodeOp({ op: 'interrupt' })).toHaveLength(1);
		expect(
			adapter.translate({
				type: 'system',
				subtype: 'status',
				status: null,
				compact_result: 'success',
				session_id: SID
			})
		).toEqual([]);
		expect(
			adapter.translate({
				type: 'system',
				subtype: 'compact_boundary',
				session_id: SID,
				compact_metadata: { trigger: 'manual', pre_tokens: 22141, post_tokens: 1548 }
			})
		).toEqual([{ type: 'compaction_end' }]);
		// The <local-command-stdout>Compacted</local-command-stdout> echo is noise.
		expect(
			adapter.translate({
				type: 'user',
				message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' },
				session_id: SID,
				parent_tool_use_id: null,
				isReplay: true
			})
		).toEqual([]);
	});

	it('maps a failed compact_result to compaction_failed', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(
			adapter.translate({
				type: 'system',
				subtype: 'status',
				status: null,
				compact_result: 'error',
				session_id: SID
			})
		).toEqual([{ type: 'compaction_failed', error: 'error' }]);
	});
});

describe('claude adapter: slash-command echo suppression', () => {
	it('drops <command-name>/<local-command-stdout> replays but keeps real queued sends', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		for (const text of [
			'<command-name>/model</command-name>\n<command-message>model</command-message>',
			'<local-command-stdout>Set model to haiku (claude-haiku-4-5-20251001)</local-command-stdout>'
		]) {
			expect(
				adapter.translate({
					type: 'user',
					message: { role: 'user', content: text },
					session_id: SID,
					parent_tool_use_id: null,
					isReplay: true
				})
			).toEqual([]);
		}
		expect(
			adapter.translate({
				type: 'user',
				message: { role: 'user', content: [{ type: 'text', text: 'queued question' }] },
				session_id: SID,
				parent_tool_use_id: null,
				isReplay: true
			})
		).toEqual([{ type: 'user_message', content: 'queued question' }]);
	});

	it('drops the /effort echo and its "Set effort level to…" confirmation', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		for (const content of [
			'/effort max',
			'Set effort level to max (this session only): Maximum capability with deepest reasoning. May use excessive tokens.'
		]) {
			expect(
				adapter.translate({
					type: 'user',
					message: { role: 'user', content },
					session_id: SID,
					parent_tool_use_id: null,
					isReplay: true
				})
			).toEqual([]);
		}
		// The same confirmation arriving as an authoritative assistant text frame is
		// dropped too (no empty assistant bubble).
		expect(
			adapter.translate({
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Set effort level to max (this session only): Maximum capability.' }]
				},
				session_id: SID,
				parent_tool_use_id: null
			})
		).toEqual([]);
	});
});

describe('claude adapter: restarts and robustness', () => {
	it('onStart resets all per-process state (approvals, init, request ids)', () => {
		const { lines, io } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		adapter.translate({
			type: 'control_request',
			request_id: 'req-1',
			request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'x' }, tool_use_id: 'toolu_z' }
		});
		adapter.translate(requesting);

		lines.length = 0;
		adapter.onStart(io, CTX); // crash auto-restart
		// The bootstrap mode push restarts its id sequence (fresh child).
		expect(parse(lines[0]).request_id).toBe('jucode-1');
		// Pending approvals died with the old child.
		expect(adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' })).toBeNull();
		// No active turn any more → interrupt is a no-op.
		expect(adapter.encodeOp({ op: 'interrupt' })).toEqual([]);
		// The next init counts as the new child's first → full startup again.
		const events = adapter.translate(initFrame());
		expect(events[0]).toMatchObject({ type: 'startup', session_id: SID });
	});

	it('drops malformed and unknown payloads without throwing', () => {
		const { lines } = makeIo();
		const adapter = createClaudeAdapter();
		boot(adapter, lines);
		expect(adapter.translate('garbage')).toEqual([]);
		expect(adapter.translate(null)).toEqual([]);
		expect(adapter.translate(42)).toEqual([]);
		expect(adapter.translate({})).toEqual([]);
		expect(adapter.translate({ type: 'rate_limit_event', rate_limit_info: {} })).toEqual([]);
		expect(adapter.translate({ type: 'stream_event', event: null, session_id: SID, parent_tool_use_id: null })).toEqual([]);
		expect(adapter.translate({ type: 'user', message: null })).toEqual([]);
		expect(adapter.translate({ type: 'control_response', response: { subtype: 'success', request_id: 'not-ours' } })).toEqual([]);
	});

	it('surfaces stderr lines as info events', () => {
		const adapter = createClaudeAdapter();
		expect(adapter.translate({ __stderr: 'node: warning' })).toEqual([
			{ type: 'info', message: '[claude] node: warning' }
		]);
		expect(adapter.translate({ __stderr: '   ' })).toEqual([]);
		// Routine tracing (INFO/DEBUG/TRACE) is dropped; ERROR/WARN are kept (they
		// carry the real reason a turn failed).
		expect(adapter.translate({ __stderr: '2026-07-14T10:00:00.000Z DEBUG hitting cache' })).toEqual([]);
		expect(adapter.translate({ __stderr: '2026-07-14T10:00:00Z INFO warming up' })).toEqual([]);
		expect(adapter.translate({ __stderr: '2026-07-14T10:00:00Z ERROR boom' })).toEqual([
			{ type: 'info', message: '[claude] 2026-07-14T10:00:00Z ERROR boom' }
		]);
		// A failed --resume signals resume_failed (breaks the crash-restart loop).
		expect(
			adapter.translate({ __stderr: 'No conversation found with session ID: e4f0405e-3919-4c10' })
		).toEqual([{ type: 'resume_failed' }]);
	});
});
