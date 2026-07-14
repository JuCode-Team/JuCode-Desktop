import { describe, it, expect } from 'vitest';
import { createCodexAdapter, CODEX_CAPS } from './codex';
import type { EngineAdapter, NormalizedEvent, SessionCtx } from './types';

// Fixtures below are condensed from a live `codex app-server` (codex-cli
// 0.144.3) session: initialize → initialized → thread/start → turn/start,
// then item/* notifications and item/fileChange/requestApproval. The server
// omits the `jsonrpc` field on its own frames.

const CTX: SessionCtx = { cwd: '/proj', approvalMode: 'ask', sessionId: 'desktop-1' };

function makeIo() {
	const lines: string[] = [];
	return { lines, io: { sendLine: (l: string) => lines.push(l) } };
}

/** onStart + full handshake; returns the events emitted by the thread/start response. */
function handshake(adapter: EngineAdapter, lines: string[], ctx: SessionCtx = CTX) {
	adapter.onStart({ sendLine: (l: string) => lines.push(l) }, ctx);
	adapter.translate({ id: 1, result: { userAgent: 'x', codexHome: '/h', platformFamily: 'unix', platformOs: 'macos' } });
	return adapter.translate({
		id: 2,
		result: {
			thread: { id: 'thread-1', sessionId: 'thread-1', status: { type: 'idle' } },
			model: 'gpt-5.6-sol',
			modelProvider: 'jucode',
			cwd: '/proj',
			approvalPolicy: 'on-request',
			reasoningEffort: 'high'
		}
	});
}

const parse = (line: string) => JSON.parse(line) as Record<string, any>;

describe('codex adapter: caps', () => {
	it('advertises exactly what the adapter implements', () => {
		const adapter = createCodexAdapter();
		expect(adapter.id).toBe('codex');
		expect(adapter.caps).toEqual(CODEX_CAPS);
		expect(adapter.caps.approvalModes).toBe(true);
		expect(adapter.caps.interrupt).toBe(true);
		expect(adapter.caps.contextUsage).toBe(true);
		expect(adapter.caps.compact).toBe(true);
		expect(adapter.caps.modelPicker).toBe(true);
		expect(adapter.caps.resume).toBe(true);
		expect(adapter.caps.goals).toBe(true);
		expect(adapter.caps.transcriptReplay).toBe(true);
		expect(adapter.caps.hunkApproval).toBe(false);
		expect(adapter.caps.slashCommands).toBe(false);
	});
});

describe('codex adapter: handshake', () => {
	it('onStart sends only the initialize request', () => {
		const { lines, io } = makeIo();
		const adapter = createCodexAdapter();
		adapter.onStart(io, CTX);
		expect(lines).toHaveLength(1);
		const init = parse(lines[0]);
		expect(init).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: { capabilities: null }
		});
		expect(init.params.clientInfo.name).toBe('jucode-desktop');
	});

	it('initialize response triggers initialized + thread/start + model/list', () => {
		const { lines, io } = makeIo();
		const adapter = createCodexAdapter();
		adapter.onStart(io, CTX); // 'ask' → read-only
		const events = adapter.translate({ id: 1, result: { userAgent: 'x' } });
		expect(events).toEqual([]); // handshake is silent
		expect(lines).toHaveLength(4);
		expect(parse(lines[1])).toEqual({ jsonrpc: '2.0', method: 'initialized' });
		expect(parse(lines[2])).toMatchObject({
			id: 2,
			method: 'thread/start',
			params: { cwd: '/proj', approvalPolicy: 'on-request', sandbox: 'read-only' }
		});
		expect(parse(lines[3])).toMatchObject({ id: 3, method: 'model/list' });
	});

	it('resumes via thread/resume when SessionCtx carries a resume id', () => {
		const { lines, io } = makeIo();
		const adapter = createCodexAdapter();
		adapter.onStart(io, { ...CTX, resume: 'thread-9' });
		adapter.translate({ id: 1, result: { userAgent: 'x' } });
		expect(parse(lines[2])).toMatchObject({
			id: 2,
			method: 'thread/resume',
			params: { threadId: 'thread-9', cwd: '/proj', approvalPolicy: 'on-request', sandbox: 'read-only' }
		});
	});

	it('maps the desktop approval modes onto codex policy + sandbox at thread/start', () => {
		for (const [approvalMode, approvalPolicy, sandbox] of [
			['edits', 'on-request', 'workspace-write'],
			['all', 'never', 'danger-full-access']
		] as const) {
			const { lines, io } = makeIo();
			const adapter = createCodexAdapter();
			adapter.onStart(io, { ...CTX, approvalMode });
			adapter.translate({ id: 1, result: {} });
			expect(parse(lines[2]).params).toMatchObject({ approvalPolicy, sandbox });
		}
	});

	it('thread/start response emits startup / model_status / command_list / approval_mode / ready', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		const events = handshake(adapter, lines);
		expect(events).toHaveLength(5);
		expect(events[0]).toEqual({
			type: 'startup',
			model: 'gpt-5.6-sol',
			cwd: '/proj',
			session_id: 'thread-1',
			context_window: 0
		});
		expect(events[1]).toEqual({
			type: 'model_status',
			provider: 'jucode',
			model: 'gpt-5.6-sol',
			reasoning_effort: 'high',
			reasoning_efforts: [],
			context_window: 0,
			context_limit: 0
		});
		// The composer's slash autocomplete learns the supported commands.
		expect(events[2].type).toBe('command_list');
		expect((events[2].commands as { command: string }[]).map((c) => c.command)).toEqual([
			'/model',
			'/resume',
			'/compact',
			'/goal'
		]);
		expect(events[3]).toEqual({ type: 'approval_mode', mode: 'read-only' });
		expect(events[4]).toEqual({ type: 'status', message: 'ready' });
	});
});

describe('codex adapter: turns', () => {
	it('user_message encodes a turn/start with per-turn policy overrides', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'say hi' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toMatchObject({
			id: 4, // 1 initialize · 2 thread/start · 3 model/list
			method: 'turn/start',
			params: {
				threadId: 'thread-1',
				input: [{ type: 'text', text: 'say hi', text_elements: [] }],
				approvalPolicy: 'on-request',
				sandboxPolicy: { type: 'readOnly', networkAccess: false }
			}
		});
	});

	it('attaches images as localImage inputs', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'look', images: ['/tmp/shot.png'] });
		expect(parse(frames![0]).params.input).toEqual([
			{ type: 'text', text: 'look', text_elements: [] },
			{ type: 'localImage', path: '/tmp/shot.png' }
		]);
	});

	it('queues a user_message sent before thread/start answers, then flushes it', () => {
		const { lines, io } = makeIo();
		const adapter = createCodexAdapter();
		adapter.onStart(io, CTX);
		// First message races the handshake (SessionStore sends it right after onStart).
		expect(adapter.encodeOp({ op: 'user_message', content: 'first' })).toEqual([]);
		adapter.translate({ id: 1, result: {} });
		const events = adapter.translate({
			id: 2,
			result: { thread: { id: 'thread-1' }, model: 'm', modelProvider: 'p', cwd: '/proj' }
		});
		expect(events.at(-1)).toEqual({ type: 'connecting' });
		const turn = parse(lines.at(-1)!);
		expect(turn.method).toBe('turn/start');
		expect(turn.params.input).toEqual([{ type: 'text', text: 'first', text_elements: [] }]);
	});

	it('translates a full recorded turn into the normalized event stream', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		adapter.encodeOp({ op: 'user_message', content: 'say hi' });
		const tid = 'thread-1';
		const turn = { id: 'turn-1', status: 'inProgress', error: null };

		expect(adapter.translate({ id: 4, result: { turn } })).toEqual([]);
		expect(adapter.translate({ method: 'thread/status/changed', params: { threadId: tid, status: { type: 'active' } } })).toEqual([]);
		expect(adapter.translate({ method: 'turn/started', params: { threadId: tid, turn } })).toEqual([
			{ type: 'connecting' }
		]);
		// The user-message echo item is dropped (shown optimistically already).
		expect(
			adapter.translate({
				method: 'item/started',
				params: { threadId: tid, turnId: 'turn-1', item: { type: 'userMessage', id: 'u1', content: [] } }
			})
		).toEqual([]);
		expect(
			adapter.translate({
				method: 'item/started',
				params: { threadId: tid, turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1', text: '' } }
			})
		).toEqual([{ type: 'assistant_start' }]);
		expect(
			adapter.translate({ method: 'item/agentMessage/delta', params: { threadId: tid, turnId: 'turn-1', itemId: 'm1', delta: 'h' } })
		).toEqual([{ type: 'assistant_delta', delta: 'h' }]);
		// item/completed re-delivers the full text; only the unseen tail is emitted.
		expect(
			adapter.translate({
				method: 'item/completed',
				params: { threadId: tid, turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1', text: 'hi' } }
			})
		).toEqual([{ type: 'assistant_delta', delta: 'i' }]);
		expect(
			adapter.translate({
				method: 'thread/tokenUsage/updated',
				params: {
					threadId: tid,
					turnId: 'turn-1',
					tokenUsage: {
						total: { totalTokens: 11016, inputTokens: 11011, cachedInputTokens: 10112, outputTokens: 5, reasoningOutputTokens: 0 },
						last: { totalTokens: 11016, inputTokens: 11011, cachedInputTokens: 10112, outputTokens: 5, reasoningOutputTokens: 0 },
						modelContextWindow: 353400
					}
				}
			})
		).toEqual([
			{
				type: 'model_status',
				provider: 'jucode',
				model: 'gpt-5.6-sol',
				reasoning_effort: 'high',
				reasoning_efforts: [],
				context_window: 353400,
				context_limit: 0
			},
			{ type: 'usage', input_tokens: 11011, output_tokens: 5 },
			{ type: 'context_usage', tokens: 11016 }
		]);
		expect(
			adapter.translate({ method: 'turn/completed', params: { threadId: tid, turn: { ...turn, status: 'completed' } } })
		).toEqual([{ type: 'status', message: 'ready' }]);
	});

	it('drops dev/config noise notifications but keeps guardian warnings', () => {
		const adapter = createCodexAdapter();
		for (const method of ['warning', 'deprecationNotice', 'configWarning']) {
			expect(adapter.translate({ method, params: { message: 'noise' } })).toEqual([]);
		}
		expect(adapter.translate({ method: 'guardianWarning', params: { message: 'unsafe op' } })).toEqual([
			{ type: 'info', message: '[codex] unsafe op' }
		]);
	});

	it('reports cumulative usage as per-update deltas', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const usage = (input: number, output: number, last: number) => ({
			method: 'thread/tokenUsage/updated',
			params: {
				threadId: 'thread-1',
				turnId: 't',
				tokenUsage: {
					total: { totalTokens: input + output, inputTokens: input, cachedInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 },
					last: { totalTokens: last, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
					modelContextWindow: null
				}
			}
		});
		expect(adapter.translate(usage(100, 10, 110))).toEqual([
			{ type: 'usage', input_tokens: 100, output_tokens: 10 },
			{ type: 'context_usage', tokens: 110 }
		]);
		expect(adapter.translate(usage(250, 30, 180))).toEqual([
			{ type: 'usage', input_tokens: 150, output_tokens: 20 },
			{ type: 'context_usage', tokens: 180 }
		]);
	});

	it('maps command execution items to tool events (streaming output, exit code)', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const started = adapter.translate({
			method: 'item/started',
			params: {
				threadId: 'thread-1',
				turnId: 'turn-1',
				item: { type: 'commandExecution', id: 'exec-1', command: 'git status', cwd: '/proj', status: 'inProgress', aggregatedOutput: null, exitCode: null }
			}
		});
		expect(started).toEqual([
			{ type: 'tool_start', call_id: 'exec-1', name: 'bash' },
			{ type: 'tool_update', call_id: 'exec-1', output: JSON.stringify({ command: 'git status' }) }
		]);
		expect(
			adapter.translate({ method: 'item/commandExecution/outputDelta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'exec-1', delta: 'On branch ' } })
		).toEqual([
			{ type: 'tool_update', call_id: 'exec-1', output: JSON.stringify({ command: 'git status', stdout: 'On branch ' }) }
		]);
		const done = adapter.translate({
			method: 'item/completed',
			params: {
				threadId: 'thread-1',
				turnId: 'turn-1',
				item: { type: 'commandExecution', id: 'exec-1', command: 'git status', cwd: '/proj', status: 'failed', aggregatedOutput: 'fatal: not a git repository\n', exitCode: 128 }
			}
		});
		expect(done).toEqual([
			{
				type: 'tool_output',
				call_id: 'exec-1',
				name: 'bash',
				output: JSON.stringify({ command: 'git status', stdout: 'fatal: not a git repository\n', exit_code: 128 }),
				is_error: true
			}
		]);
	});

	it('maps fileChange items to apply_patch tool events with paths + diff', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const changes = [{ path: '/proj/hello.txt', kind: { type: 'add' }, diff: 'hello\n' }];
		adapter.translate({
			method: 'item/started',
			params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'fileChange', id: 'fc-1', changes, status: 'inProgress' } }
		});
		const done = adapter.translate({
			method: 'item/completed',
			params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'fileChange', id: 'fc-1', changes, status: 'completed' } }
		});
		expect(done).toHaveLength(1);
		expect(done[0]).toMatchObject({ type: 'tool_output', call_id: 'fc-1', name: 'apply_patch', is_error: false });
		// The JSON output feeds the Changes panel (paths) and the diff renderer.
		expect(JSON.parse(String(done[0].output))).toEqual({
			path: '/proj/hello.txt',
			paths: ['/proj/hello.txt'],
			diff: 'hello\n'
		});
	});

	it('falls back to the reasoning summary when nothing streamed', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		adapter.translate({
			method: 'item/started',
			params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'reasoning', id: 'r1', summary: [], content: [] } }
		});
		expect(
			adapter.translate({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'r1', delta: 'thinking' } })
		).toEqual([{ type: 'reasoning_delta', delta: 'thinking' }]);
		// Streamed → the completed summary is NOT re-emitted.
		expect(
			adapter.translate({
				method: 'item/completed',
				params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'reasoning', id: 'r1', summary: ['thinking'], content: [] } }
			})
		).toEqual([]);
		// Not streamed → summary emitted on completion.
		adapter.translate({
			method: 'item/started',
			params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'reasoning', id: 'r2', summary: [], content: [] } }
		});
		expect(
			adapter.translate({
				method: 'item/completed',
				params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'reasoning', id: 'r2', summary: ['a', 'b'], content: [] } }
			})
		).toEqual([{ type: 'reasoning_delta', delta: 'a\n\nb' }]);
	});

	it('surfaces a failed turn as error + ready', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const events = adapter.translate({
			method: 'turn/completed',
			params: { threadId: 'thread-1', turn: { id: 't1', status: 'failed', error: { message: 'boom', codexErrorInfo: 'other' } } }
		});
		expect(events).toEqual([
			{ type: 'error', message: 'boom' },
			{ type: 'status', message: 'ready' }
		]);
	});
});

describe('codex adapter: approvals', () => {
	function pendingFileChange(adapter: EngineAdapter, lines: string[]): NormalizedEvent[] {
		handshake(adapter, lines);
		adapter.translate({
			method: 'item/started',
			params: {
				threadId: 'thread-1',
				turnId: 'turn-1',
				item: { type: 'fileChange', id: 'fc-1', changes: [{ path: '/proj/hello.txt', kind: { type: 'add' }, diff: 'hello\n' }], status: 'inProgress' }
			}
		});
		// JSON-RPC *server→client request* (note the id — server ids start at 0).
		return adapter.translate({
			method: 'item/fileChange/requestApproval',
			id: 0,
			params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'fc-1', startedAtMs: 1, reason: null, grantRoot: null }
		});
	}

	it('bridges a fileChange approval round-trip (synthetic call_id registry)', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		const events = pendingFileChange(adapter, lines);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: 'approval_request',
			call_id: 'approval-1',
			name: 'apply_patch',
			subagent_id: null,
			hunks: null
		});
		expect(String(events[0].summary)).toContain('/proj/hello.txt');
		expect(String(events[0].summary)).toContain('hello');

		const frames = adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toEqual({ jsonrpc: '2.0', id: 0, result: { decision: 'accept' } });
		// The registry entry is consumed: answering twice is refused.
		expect(adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' })).toBeNull();
	});

	it('maps deny → decline and always → acceptForSession', () => {
		for (const [op, decision] of [
			[{ op: 'approve', call_id: 'approval-1', decision: 'deny' }, 'decline'],
			[{ op: 'approve', call_id: 'approval-1', decision: 'allow', always: true }, 'acceptForSession']
		] as const) {
			const { lines } = makeIo();
			const adapter = createCodexAdapter();
			pendingFileChange(adapter, lines);
			expect(parse(adapter.encodeOp(op)![0]).result).toEqual({ decision });
		}
	});

	it('bridges command approvals with the command as summary', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const events = adapter.translate({
			method: 'item/commandExecution/requestApproval',
			id: 4,
			params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'exec-9', command: 'rm -rf build', reason: 'needs write access' }
		});
		expect(events[0]).toMatchObject({
			type: 'approval_request',
			call_id: 'approval-1',
			name: 'bash',
			summary: 'rm -rf build\nneeds write access'
		});
		expect(parse(adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' })![0]).id).toBe(4);
	});

	it('drops registry entries the server resolved itself', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		pendingFileChange(adapter, lines);
		adapter.translate({ method: 'serverRequest/resolved', params: { threadId: 'thread-1', requestId: 0 } });
		expect(adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' })).toBeNull();
	});

	it('answers unsupported server requests with method-not-found instead of hanging', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const before = lines.length;
		const events = adapter.translate({ method: 'item/tool/requestUserInput', id: 7, params: {} });
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('info');
		expect(parse(lines[before])).toMatchObject({ id: 7, error: { code: -32601 } });
	});
});

describe('codex adapter: interrupt / modes / shutdown', () => {
	it('interrupt is a no-op frame-wise when no turn is active, turn/interrupt when one is', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		expect(adapter.encodeOp({ op: 'interrupt' })).toEqual([]);
		adapter.translate({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-7', status: 'inProgress', error: null } } });
		const frames = adapter.encodeOp({ op: 'interrupt' });
		expect(parse(frames![0])).toMatchObject({
			method: 'turn/interrupt',
			params: { threadId: 'thread-1', turnId: 'turn-7' }
		});
		// turn/completed clears the active turn again.
		adapter.translate({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-7', status: 'interrupted', error: null } } });
		expect(adapter.encodeOp({ op: 'interrupt' })).toEqual([]);
	});

	it('set_approval_mode is stored and applied to the next turn/start', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		expect(adapter.encodeOp({ op: 'set_approval_mode', mode: 'full-auto' })).toEqual([]);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'go' });
		expect(parse(frames![0]).params).toMatchObject({
			approvalPolicy: 'never',
			sandboxPolicy: { type: 'dangerFullAccess' }
		});
	});

	it('shutdown is accepted silently; unsupported ops are refused', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		expect(adapter.encodeOp({ op: 'shutdown' })).toEqual([]);
		expect(adapter.encodeOp({ op: 'command', input: '/tree' })).toBeNull();
		expect(adapter.encodeOp({ op: 'steer' })).toBeNull();
		expect(adapter.encodeOp({ op: 'mcp_list' })).toBeNull();
	});
});

// Condensed from a live model/list response (codex-cli 0.144.3).
const CATALOG = {
	data: [
		{
			id: 'gpt-5.6-sol',
			model: 'gpt-5.6-sol',
			displayName: 'GPT-5.6-Sol',
			description: 'Latest frontier agentic coding model.',
			hidden: false,
			supportedReasoningEfforts: [
				{ reasoningEffort: 'low', description: 'Fast' },
				{ reasoningEffort: 'medium', description: 'Balanced' },
				{ reasoningEffort: 'high', description: 'Deep' }
			],
			defaultReasoningEffort: 'low',
			isDefault: true
		},
		{
			id: 'gpt-5.6-terra',
			model: 'gpt-5.6-terra',
			displayName: 'GPT-5.6-Terra',
			description: 'Balanced model.',
			hidden: false,
			supportedReasoningEfforts: [
				{ reasoningEffort: 'medium', description: 'Balanced' },
				{ reasoningEffort: 'high', description: 'Deep' }
			],
			defaultReasoningEffort: 'medium',
			isDefault: false
		},
		{
			id: 'gpt-5.6-hidden',
			model: 'gpt-5.6-hidden',
			displayName: 'Hidden',
			description: '',
			hidden: true,
			supportedReasoningEfforts: [],
			defaultReasoningEffort: 'medium',
			isDefault: false
		}
	],
	nextCursor: null
};

describe('codex adapter: model picker', () => {
	/** handshake + the connect-time model/list response (request id 3). */
	function handshakeWithCatalog(adapter: EngineAdapter, lines: string[]) {
		handshake(adapter, lines);
		return adapter.translate({ id: 3, result: CATALOG });
	}

	it('connect-time model/list refreshes the effort options on model_status', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		const events = handshakeWithCatalog(adapter, lines);
		expect(events).toEqual([
			{
				type: 'model_status',
				provider: 'jucode',
				model: 'gpt-5.6-sol',
				reasoning_effort: 'high',
				reasoning_efforts: ['low', 'medium', 'high'],
				context_window: 0,
				context_limit: 0
			}
		]);
	});

	it('/model opens the picker: model/list → model_view (jucode shape, hidden filtered)', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshakeWithCatalog(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/model' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toMatchObject({ id: 4, method: 'model/list' });
		const events = adapter.translate({ id: 4, result: CATALOG });
		expect(events).toEqual([
			{
				type: 'model_view',
				models: [
					{
						model: 'gpt-5.6-sol',
						active: true,
						context_window: 0,
						max_output_tokens: 0,
						reasoning_efforts: ['low', 'medium', 'high']
					},
					{
						model: 'gpt-5.6-terra',
						active: false,
						context_window: 0,
						max_output_tokens: 0,
						reasoning_efforts: ['medium', 'high']
					}
				],
				active_effort: 'high'
			}
		]);
	});

	it('a /model pick acks with model_status and overrides model+effort on later turns', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshakeWithCatalog(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/model gpt-5.6-terra high' });
		expect(parse(frames![0])).toMatchObject({ id: 4, method: 'model/list' });
		const events = adapter.translate({ id: 4, result: CATALOG });
		expect(events).toEqual([
			{
				type: 'model_status',
				provider: 'jucode',
				model: 'gpt-5.6-terra',
				reasoning_effort: 'high',
				reasoning_efforts: ['medium', 'high'],
				context_window: 0,
				context_limit: 0
			}
		]);
		// Applied to this and subsequent turns (no thread-level set RPC exists).
		const turn = adapter.encodeOp({ op: 'user_message', content: 'go' });
		expect(parse(turn![0]).params).toMatchObject({ model: 'gpt-5.6-terra', effort: 'high' });
	});

	it('a pick without an effort falls back to the model default', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshakeWithCatalog(adapter, lines);
		adapter.encodeOp({ op: 'command', input: '/model gpt-5.6-terra' });
		const events = adapter.translate({ id: 4, result: CATALOG });
		expect(events[0]).toMatchObject({ type: 'model_status', model: 'gpt-5.6-terra', reasoning_effort: 'medium' });
		expect(parse(adapter.encodeOp({ op: 'user_message', content: 'go' })![0]).params).toMatchObject({
			model: 'gpt-5.6-terra',
			effort: 'medium'
		});
	});
});

describe('codex adapter: resume', () => {
	const RESUME_RESULT = {
		thread: {
			id: 'thread-9',
			turns: [
				{
					id: 't1',
					status: 'completed',
					error: null,
					items: [
						{ type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'hello', text_elements: [] }] },
						{ type: 'reasoning', id: 'r1', summary: ['skip me'], content: [] },
						{
							type: 'commandExecution',
							id: 'e1',
							command: 'ls',
							cwd: '/proj',
							status: 'completed',
							aggregatedOutput: 'a.txt\n',
							exitCode: 0
						},
						{ type: 'agentMessage', id: 'm1', text: 'done' },
						{ type: 'contextCompaction', id: 'c1' }
					]
				}
			]
		},
		model: 'gpt-5.6-terra',
		modelProvider: 'jucode',
		cwd: '/proj',
		approvalPolicy: 'on-request',
		reasoningEffort: 'low'
	};

	it('thread/resume replays the transcript and announces the resumed thread', () => {
		const { lines, io } = makeIo();
		const adapter = createCodexAdapter();
		adapter.onStart(io, { ...CTX, resume: 'thread-9' });
		adapter.translate({ id: 1, result: { userAgent: 'x' } });
		expect(parse(lines[2]).method).toBe('thread/resume');
		const events = adapter.translate({ id: 2, result: RESUME_RESULT });
		expect(events[0]).toEqual({
			type: 'transcript',
			items: [
				{ role: 'user', content: 'hello' },
				{ role: 'tool', name: 'bash', output: JSON.stringify({ command: 'ls', stdout: 'a.txt\n', exit_code: 0 }) },
				{ role: 'assistant', content: 'done' }
			]
		});
		expect(events[1]).toMatchObject({ type: 'startup', session_id: 'thread-9', model: 'gpt-5.6-terra' });
		expect(events[2]).toMatchObject({ type: 'model_status', model: 'gpt-5.6-terra', reasoning_effort: 'low' });
		expect(events.at(-1)).toEqual({ type: 'status', message: 'ready' });
		// Turns target the resumed thread.
		const turn = adapter.encodeOp({ op: 'user_message', content: 'next' });
		expect(parse(turn![0]).params.threadId).toBe('thread-9');
	});

	it('bare /resume lists this cwd’s threads and synthesizes resume_view', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/resume' });
		expect(parse(frames![0])).toMatchObject({
			id: 4,
			method: 'thread/list',
			params: { cwd: '/proj', limit: 50 }
		});
		const events = adapter.translate({
			id: 4,
			result: {
				data: [
					{ id: 'thread-1', preview: 'current convo', name: null, updatedAt: 1784012113, cwd: '/proj' },
					{ id: 'thread-2', preview: 'older convo', name: 'Named', updatedAt: 1784012029, cwd: '/proj' }
				],
				nextCursor: null
			}
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('resume_view');
		const items = events[0].items as { id: string; label: string; detail: string; active: boolean }[];
		expect(items[0]).toMatchObject({ id: 'thread-1', label: 'current convo', active: true });
		expect(items[1]).toMatchObject({ id: 'thread-2', label: 'Named', active: false });
		expect(items[0].detail).not.toBe('');
	});

	it('/resume <id> switches threads in place on the same child', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/resume thread-9' });
		expect(parse(frames![0])).toMatchObject({
			id: 4,
			method: 'thread/resume',
			params: { threadId: 'thread-9', cwd: '/proj', approvalPolicy: 'on-request', sandbox: 'read-only' }
		});
		const events = adapter.translate({ id: 4, result: RESUME_RESULT });
		expect(events[0].type).toBe('transcript');
		expect(parse(adapter.encodeOp({ op: 'user_message', content: 'hi' })![0]).params.threadId).toBe('thread-9');
	});
});

describe('codex adapter: compaction', () => {
	it('/compact starts thread/compact/start and the item lifecycle drives the UI', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/compact' });
		expect(parse(frames![0])).toMatchObject({
			id: 4,
			method: 'thread/compact/start',
			params: { threadId: 'thread-1' }
		});
		expect(adapter.translate({ id: 4, result: {} })).toEqual([]); // bare ack
		// Compaction runs as its own turn wrapping a contextCompaction item.
		expect(
			adapter.translate({
				method: 'item/started',
				params: { threadId: 'thread-1', turnId: 'ct', item: { type: 'contextCompaction', id: 'cc-1' } }
			})
		).toEqual([{ type: 'compaction_start' }]);
		expect(
			adapter.translate({
				method: 'item/completed',
				params: { threadId: 'thread-1', turnId: 'ct', item: { type: 'contextCompaction', id: 'cc-1' } }
			})
		).toEqual([{ type: 'compaction_end' }]);
		// The deprecated thread/compacted notification is then a duplicate.
		expect(adapter.translate({ method: 'thread/compacted', params: { threadId: 'thread-1', turnId: 'ct' } })).toEqual([]);
	});

	it('maps a thread/compact/start error to compaction_failed', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		adapter.encodeOp({ op: 'command', input: '/compact' });
		expect(adapter.translate({ id: 4, error: { code: -32000, message: 'nothing to compact' } })).toEqual([
			{ type: 'compaction_failed', error: 'nothing to compact' }
		]);
	});

	it('still maps a bare thread/compacted (older servers) to compaction_end', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		expect(adapter.translate({ method: 'thread/compacted', params: { threadId: 'thread-1', turnId: 't' } })).toEqual([
			{ type: 'compaction_end' }
		]);
	});
});

describe('codex adapter: goals', () => {
	it('/goal <objective> sets, notifications update, /goal clear clears', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const setFrames = adapter.encodeOp({ op: 'command', input: '/goal ship the feature' });
		expect(parse(setFrames![0])).toMatchObject({
			id: 4,
			method: 'thread/goal/set',
			params: { threadId: 'thread-1', objective: 'ship the feature' }
		});
		// Ack arrives as the thread/goal/updated notification (jucode goal shape).
		const goal = {
			threadId: 'thread-1',
			objective: 'ship the feature',
			status: 'active',
			tokenBudget: 50000,
			tokensUsed: 120,
			timeUsedSeconds: 3,
			createdAt: 1,
			updatedAt: 1
		};
		expect(adapter.translate({ method: 'thread/goal/updated', params: { threadId: 'thread-1', turnId: null, goal } })).toEqual([
			{
				type: 'goal',
				goal: { objective: 'ship the feature', status: 'active', token_budget: 50000, tokens_used: 120, time_used_seconds: 3 }
			}
		]);
		expect(adapter.translate({ id: 4, result: { goal } })).toEqual([]); // set response: notification already acked
		const clearFrames = adapter.encodeOp({ op: 'command', input: '/goal clear' });
		expect(parse(clearFrames![0])).toMatchObject({ id: 5, method: 'thread/goal/clear', params: { threadId: 'thread-1' } });
		expect(adapter.translate({ method: 'thread/goal/cleared', params: { threadId: 'thread-1' } })).toEqual([
			{ type: 'goal', goal: null }
		]);
	});

	it('bare /goal reads the goal back; budget-limit statuses map to blocked', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const frames = adapter.encodeOp({ op: 'command', input: '/goal' });
		expect(parse(frames![0])).toMatchObject({ id: 4, method: 'thread/goal/get' });
		const events = adapter.translate({
			id: 4,
			result: {
				goal: { threadId: 'thread-1', objective: 'x', status: 'budgetLimited', tokenBudget: 10, tokensUsed: 11, timeUsedSeconds: 2, createdAt: 1, updatedAt: 1 }
			}
		});
		expect(events).toEqual([
			{ type: 'goal', goal: { objective: 'x', status: 'blocked', token_budget: 10, tokens_used: 11, time_used_seconds: 2 } }
		]);
		// And a null get → goal cleared.
		adapter.encodeOp({ op: 'command', input: '/goal' });
		expect(adapter.translate({ id: 5, result: { goal: null } })).toEqual([{ type: 'goal', goal: null }]);
	});

	it('/goal pause and /goal resume patch the status', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		expect(parse(adapter.encodeOp({ op: 'command', input: '/goal pause' })![0]).params).toMatchObject({ status: 'paused' });
		expect(parse(adapter.encodeOp({ op: 'command', input: '/goal resume' })![0]).params).toMatchObject({ status: 'active' });
	});
});

describe('codex adapter: restarts and robustness', () => {
	it('onStart resets all per-process state (ids, thread, approvals, queue)', () => {
		const { lines, io } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		adapter.translate({
			method: 'item/fileChange/requestApproval',
			id: 0,
			params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'fc-1' }
		});
		adapter.encodeOp({ op: 'user_message', content: 'in flight' });

		lines.length = 0;
		adapter.onStart(io, CTX); // crash auto-restart
		// Request ids restart from 1 (fresh JSON-RPC stream).
		expect(parse(lines[0])).toMatchObject({ id: 1, method: 'initialize' });
		// Pending approvals died with the old child.
		expect(adapter.encodeOp({ op: 'approve', call_id: 'approval-1', decision: 'allow' })).toBeNull();
		// The thread id is gone → messages queue again instead of targeting it.
		expect(adapter.encodeOp({ op: 'user_message', content: 'again' })).toEqual([]);
	});

	it('drops malformed and unknown payloads without throwing', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		expect(adapter.translate('garbage')).toEqual([]);
		expect(adapter.translate(null)).toEqual([]);
		expect(adapter.translate(42)).toEqual([]);
		expect(adapter.translate({})).toEqual([]);
		expect(adapter.translate({ method: 'thread/realtime/sdp', params: {} })).toEqual([]);
		expect(adapter.translate({ method: 'item/started', params: {} })).toEqual([]);
		expect(adapter.translate({ id: 999, result: {} })).toEqual([]); // unknown response id
	});

	it('filters codex tracing noise from stderr but surfaces real lines', () => {
		const adapter = createCodexAdapter();
		expect(
			adapter.translate({ __stderr: '2026-07-14T05:23:55.272953Z ERROR codex_models_manager::manager: failed to refresh' })
		).toEqual([]);
		expect(adapter.translate({ __stderr: 'zsh: command not found: rg' })).toEqual([
			{ type: 'info', message: '[codex] zsh: command not found: rg' }
		]);
	});

	it('turns auth failures into an error with codex login guidance', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		const events = adapter.translate({
			method: 'error',
			params: {
				threadId: 'thread-1',
				turnId: 'turn-1',
				willRetry: false,
				error: { message: 'HTTP 401: Your authentication token has been invalidated.', codexErrorInfo: 'unauthorized' }
			}
		});
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('error');
		expect(String(events[0].message)).toContain('codex login');
		// Retryable errors stay informational.
		expect(
			adapter.translate({
				method: 'error',
				params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: true, error: { message: 'stream disconnected' } }
			})
		).toEqual([{ type: 'info', message: '[codex] stream disconnected' }]);
	});

	it('JSON-RPC error responses to turn/start unstick the busy state', () => {
		const { lines } = makeIo();
		const adapter = createCodexAdapter();
		handshake(adapter, lines);
		adapter.encodeOp({ op: 'user_message', content: 'x' }); // id 4
		expect(adapter.translate({ id: 4, error: { code: -32000, message: 'no rollout' } })).toEqual([
			{ type: 'error', message: 'no rollout' },
			{ type: 'status', message: 'ready' }
		]);
	});
});
