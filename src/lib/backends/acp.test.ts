import { describe, it, expect } from 'vitest';
import { createAcpAdapter, ACP_CAPS, ACP_PROTOCOL_VERSION, imageMime, diffText } from './acp';
import type { EngineAdapter, SessionCtx } from './types';

// Fake agent frames modeled on ACP v1 (agentclientprotocol.com) as spoken by
// `jucode acp` and gemini-cli --experimental-acp: initialize → session/new →
// session/prompt, session/update notifications, session/request_permission
// server→client requests.

const CTX: SessionCtx = { cwd: '/proj', approvalMode: 'ask', sessionId: 'desktop-1' };

const parse = (line: string) => JSON.parse(line) as Record<string, any>;

function makeAdapter(ctx: SessionCtx = CTX) {
	const lines: string[] = [];
	const adapter = createAcpAdapter();
	adapter.onStart({ sendLine: (l: string) => lines.push(l) }, ctx);
	return { adapter, lines };
}

/** Drives initialize + session/new to completion. Returns the events emitted
 *  by the session/new response. */
function handshake(
	adapter: EngineAdapter,
	opts: { image?: boolean; models?: Record<string, any> } = {}
) {
	adapter.translate({
		jsonrpc: '2.0',
		id: 1,
		result: {
			protocolVersion: 1,
			agentCapabilities: { loadSession: false, promptCapabilities: { image: opts.image ?? false } }
		}
	});
	return adapter.translate({
		jsonrpc: '2.0',
		id: 2,
		result: { sessionId: 'agent-sess-1', ...(opts.models ? { models: opts.models } : {}) }
	});
}

describe('acp adapter: caps', () => {
	it('advertises the conservative cap set', () => {
		const adapter = createAcpAdapter();
		expect(adapter.id).toBe('acp');
		expect(adapter.caps).toEqual(ACP_CAPS);
		// The only proven mappings: session/cancel and plan rendering data.
		expect(adapter.caps.interrupt).toBe(true);
		// Everything without a provable ACP mapping stays off.
		expect(adapter.caps.approvalModes).toBe(false);
		expect(adapter.caps.hunkApproval).toBe(false);
		expect(adapter.caps.steer).toBe(false);
		expect(adapter.caps.modelPicker).toBe(false);
		expect(adapter.caps.resume).toBe(false);
		expect(adapter.caps.skills).toBe(false);
		expect(adapter.caps.mcpManage).toBe(false);
		expect(adapter.caps.checkpoints).toBe(false);
		expect(adapter.caps.branchTree).toBe(false);
		expect(adapter.caps.contextUsage).toBe(false);
		expect(adapter.caps.slashCommands).toBe(false);
	});
});

describe('acp adapter: handshake', () => {
	it('onStart sends initialize with protocol v1 and no client fs/terminal', () => {
		const { lines } = makeAdapter();
		expect(lines).toHaveLength(1);
		expect(parse(lines[0])).toEqual({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: ACP_PROTOCOL_VERSION,
				clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
			}
		});
	});

	it('initialize response triggers session/new with the project cwd', () => {
		const { adapter, lines } = makeAdapter();
		adapter.translate({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
		expect(parse(lines[1])).toMatchObject({
			id: 2,
			method: 'session/new',
			params: { cwd: '/proj', mcpServers: [] }
		});
	});

	it('session/new marks the session ready and NOT resumable (empty session_id)', () => {
		const { adapter } = makeAdapter();
		const events = handshake(adapter);
		expect(events[0]).toMatchObject({ type: 'startup', session_id: '', cwd: '/proj' });
		expect(events.at(-1)).toEqual({ type: 'status', message: 'ready' });
	});

	it('surfaces the agent model when session/new reports one', () => {
		const { adapter } = makeAdapter();
		const events = handshake(adapter, {
			models: {
				currentModelId: 'g-3',
				availableModels: [{ modelId: 'g-3', name: 'Gemini 3 Pro' }]
			}
		});
		expect(events[0]).toMatchObject({ type: 'startup', model: 'Gemini 3 Pro' });
		expect(events[1]).toMatchObject({ type: 'model_status', model: 'Gemini 3 Pro', provider: 'acp' });
	});

	it('a failed initialize / session/new reports the error and stays ready', () => {
		const { adapter } = makeAdapter();
		const events = adapter.translate({
			jsonrpc: '2.0',
			id: 1,
			error: { code: -32000, message: 'agent not authenticated' }
		});
		expect(events[0]).toMatchObject({ type: 'error', message: '[acp] agent not authenticated' });
		expect(events[1]).toEqual({ type: 'status', message: 'ready' });
	});
});

describe('acp adapter: prompt turns', () => {
	it('user_message becomes one session/prompt with a text block', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'hello agent' });
		expect(frames).toHaveLength(1);
		expect(parse(frames![0])).toMatchObject({
			method: 'session/prompt',
			params: { sessionId: 'agent-sess-1', prompt: [{ type: 'text', text: 'hello agent' }] }
		});
	});

	it('flips busy on the first agent frame after a prompt (no turn-started in ACP)', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		adapter.encodeOp({ op: 'user_message', content: 'hi' });
		const first = adapter.translate({
			jsonrpc: '2.0',
			method: 'session/update',
			params: {
				sessionId: 'agent-sess-1',
				update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hey' } }
			}
		});
		expect(first[0]).toEqual({ type: 'connecting' });
		expect(first[1]).toEqual({ type: 'assistant_delta', delta: 'Hey' });
		// Busy is announced once per turn only.
		const second = adapter.translate({
			jsonrpc: '2.0',
			method: 'session/update',
			params: {
				sessionId: 'agent-sess-1',
				update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '!' } }
			}
		});
		expect(second).toEqual([{ type: 'assistant_delta', delta: '!' }]);
	});

	it('maps thought chunks to reasoning deltas', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const events = adapter.translate({
			jsonrpc: '2.0',
			method: 'session/update',
			params: {
				sessionId: 'agent-sess-1',
				update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }
			}
		});
		expect(events).toEqual([{ type: 'reasoning_delta', delta: 'hmm' }]);
	});

	it('the prompt response settles the turn back to ready', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'hi' });
		const promptId = parse(frames![0]).id;
		const events = adapter.translate({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
		expect(events.at(-1)).toEqual({ type: 'status', message: 'ready' });
	});

	it('surfaces refusal and turn-limit stop reasons as info', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'hi' });
		const promptId = parse(frames![0]).id;
		// The response is the FIRST frame after the prompt here, so the batch
		// opens with the busy flip and still settles back to ready.
		const events = adapter.translate({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'refusal' } });
		expect(events[0]).toEqual({ type: 'connecting' });
		expect(events[1].type).toBe('info');
		expect(events.at(-1)).toEqual({ type: 'status', message: 'ready' });
	});

	it('a failed prompt reports the error AND unsticks the busy state', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const frames = adapter.encodeOp({ op: 'user_message', content: 'hi' });
		const promptId = parse(frames![0]).id;
		const events = adapter.translate({
			jsonrpc: '2.0',
			id: promptId,
			error: { code: -32603, message: 'model overloaded' }
		});
		expect(events[0]).toEqual({ type: 'connecting' });
		expect(events[1]).toMatchObject({ type: 'error', message: '[acp] model overloaded' });
		expect(events.at(-1)).toEqual({ type: 'status', message: 'ready' });
	});
});

describe('acp adapter: prompt queueing (one turn at a time)', () => {
	it('queues messages sent before session/new resolves and flushes on open', () => {
		const { adapter, lines } = makeAdapter();
		// User types while the handshake is still in flight.
		expect(adapter.encodeOp({ op: 'user_message', content: 'early bird' })).toEqual([]);
		const events = handshake(adapter);
		// The queued prompt went out as part of the session/new handling.
		const prompt = parse(lines.at(-1)!);
		expect(prompt).toMatchObject({
			method: 'session/prompt',
			params: { prompt: [{ type: 'text', text: 'early bird' }] }
		});
		expect(events.at(-1)).toEqual({ type: 'connecting' });
	});

	it('queues a second message while a prompt is in flight, then submits it as its own turn', () => {
		const { adapter, lines } = makeAdapter();
		handshake(adapter);
		const first = adapter.encodeOp({ op: 'user_message', content: 'one' });
		const firstId = parse(first![0]).id;
		// Second message while busy: swallowed into the queue, no frame yet.
		expect(adapter.encodeOp({ op: 'user_message', content: 'two' })).toEqual([]);
		lines.length = 0;
		// The first turn settles → the queued prompt is submitted, still busy.
		const events = adapter.translate({ jsonrpc: '2.0', id: firstId, result: { stopReason: 'end_turn' } });
		expect(events.at(-1)).toEqual({ type: 'connecting' });
		expect(parse(lines[0])).toMatchObject({
			method: 'session/prompt',
			params: { prompt: [{ type: 'text', text: 'two' }] }
		});
	});
});

describe('acp adapter: tool calls → ToolCard events', () => {
	const toolCall = (update: Record<string, unknown>) => ({
		jsonrpc: '2.0',
		method: 'session/update',
		params: { sessionId: 'agent-sess-1', update }
	});

	it('tool_call starts a card; a completed tool_call_update closes it', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const started = adapter.translate(
			toolCall({
				sessionUpdate: 'tool_call',
				toolCallId: 'call-1',
				title: 'Reading config.toml',
				kind: 'read',
				status: 'in_progress',
				locations: [{ path: '/proj/config.toml' }]
			})
		);
		expect(started[0]).toEqual({ type: 'tool_start', call_id: 'call-1', name: 'Reading config.toml' });
		expect(started[1]).toMatchObject({ type: 'tool_update', call_id: 'call-1' });
		const done = adapter.translate(
			toolCall({
				sessionUpdate: 'tool_call_update',
				toolCallId: 'call-1',
				status: 'completed',
				content: [{ type: 'content', content: { type: 'text', text: 'key = "value"' } }]
			})
		);
		expect(done).toHaveLength(1);
		expect(done[0]).toMatchObject({ type: 'tool_output', call_id: 'call-1', is_error: false });
		const payload = JSON.parse((done[0] as unknown as { output: string }).output);
		expect(payload).toMatchObject({ kind: 'read', path: '/proj/config.toml', content: 'key = "value"' });
	});

	it('a failed update flags the output as an error', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		adapter.translate(
			toolCall({ sessionUpdate: 'tool_call', toolCallId: 'call-2', kind: 'execute', status: 'in_progress' })
		);
		const done = adapter.translate(
			toolCall({ sessionUpdate: 'tool_call_update', toolCallId: 'call-2', status: 'failed' })
		);
		expect(done[0]).toMatchObject({ type: 'tool_output', call_id: 'call-2', is_error: true });
	});

	it('diff content renders as a unified-diff payload the card can color', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const events = adapter.translate(
			toolCall({
				sessionUpdate: 'tool_call',
				toolCallId: 'call-3',
				title: 'Edit main.rs',
				kind: 'edit',
				status: 'completed',
				content: [{ type: 'diff', path: '/proj/main.rs', oldText: 'old line', newText: 'new line' }]
			})
		);
		const out = JSON.parse((events.at(-1) as unknown as { output: string }).output);
		expect(out.diff).toBe('--- /proj/main.rs\n+++ /proj/main.rs\n-old line\n+new line');
		expect(out.path).toBe('/proj/main.rs');
	});

	it('an update for an unknown call id is dropped, not crashed on', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		expect(
			adapter.translate(
				toolCall({ sessionUpdate: 'tool_call_update', toolCallId: 'ghost', status: 'completed' })
			)
		).toEqual([]);
	});
});

describe('acp adapter: plan updates', () => {
	it('maps plan entries onto the desktop plan event', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const events = adapter.translate({
			jsonrpc: '2.0',
			method: 'session/update',
			params: {
				sessionId: 'agent-sess-1',
				update: {
					sessionUpdate: 'plan',
					entries: [
						{ content: 'Find the bug', priority: 'high', status: 'completed' },
						{ content: 'Fix it', priority: 'high', status: 'in_progress' },
						{ content: 'Add a test', priority: 'medium' }
					]
				}
			}
		});
		expect(events).toEqual([
			{
				type: 'plan',
				plan: [
					{ step: 'Find the bug', status: 'completed' },
					{ step: 'Fix it', status: 'in_progress' },
					{ step: 'Add a test', status: 'pending' }
				]
			}
		]);
	});
});

describe('acp adapter: permission requests → ApprovalCard', () => {
	const OPTIONS = [
		{ optionId: 'allow', name: 'Allow', kind: 'allow_once' },
		{ optionId: 'always', name: 'Always allow', kind: 'allow_always' },
		{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }
	];

	function requestPermission(adapter: EngineAdapter, id = 77) {
		return adapter.translate({
			jsonrpc: '2.0',
			id,
			method: 'session/request_permission',
			params: {
				sessionId: 'agent-sess-1',
				toolCall: {
					toolCallId: 'call-9',
					title: 'rm -rf ./build',
					kind: 'execute',
					content: [{ type: 'diff', path: '/proj/a.txt', oldText: 'x', newText: 'y' }]
				},
				options: OPTIONS
			}
		});
	}

	it('bridges the server request to an approval_request with a synthetic call id', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const events = requestPermission(adapter);
		expect(events).toHaveLength(1);
		const ev = events[0] as Record<string, any>;
		expect(ev).toMatchObject({ type: 'approval_request', name: 'execute', hunks: null });
		expect(ev.call_id).toMatch(/^acp-approval-/);
		// The card summary shows the title plus the pending diff.
		expect(ev.summary).toContain('rm -rf ./build');
		expect(ev.summary).toContain('+y');
	});

	it('approve/deny/always pick the matching advertised option id', () => {
		const cases: { op: { decision: 'allow' | 'deny'; always?: boolean }; optionId: string }[] = [
			{ op: { decision: 'allow' }, optionId: 'allow' },
			{ op: { decision: 'allow', always: true }, optionId: 'always' },
			{ op: { decision: 'deny' }, optionId: 'deny' }
		];
		for (const { op, optionId } of cases) {
			const { adapter } = makeAdapter();
			handshake(adapter);
			const [ev] = requestPermission(adapter) as Record<string, any>[];
			const frames = adapter.encodeOp({ op: 'approve', call_id: ev.call_id, ...op });
			expect(parse(frames![0])).toEqual({
				jsonrpc: '2.0',
				id: 77,
				result: { outcome: { outcome: 'selected', optionId } }
			});
		}
	});

	it('a stale approval (unknown call id) is unsupported → null', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		expect(adapter.encodeOp({ op: 'approve', call_id: 'nope', decision: 'allow' })).toBeNull();
	});

	it('answers cancelled when the agent offers no usable option', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		const events = adapter.translate({
			jsonrpc: '2.0',
			id: 5,
			method: 'session/request_permission',
			params: { toolCall: { title: 'x' }, options: [] }
		});
		const callId = (events[0] as Record<string, any>).call_id;
		const frames = adapter.encodeOp({ op: 'approve', call_id: callId, decision: 'allow' });
		expect(parse(frames![0])).toMatchObject({ id: 5, result: { outcome: { outcome: 'cancelled' } } });
	});
});

describe('acp adapter: interrupt', () => {
	it('cancels outstanding permission requests, drops the queue, then session/cancel', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		adapter.encodeOp({ op: 'user_message', content: 'go' });
		adapter.encodeOp({ op: 'user_message', content: 'queued' });
		const [ev] = adapter.translate({
			jsonrpc: '2.0',
			id: 9,
			method: 'session/request_permission',
			params: { toolCall: { title: 'x' }, options: [{ optionId: 'a', kind: 'allow_once' }] }
		}) as Record<string, any>[];
		const frames = adapter.encodeOp({ op: 'interrupt' });
		expect(frames).toHaveLength(2);
		expect(parse(frames![0])).toMatchObject({ id: 9, result: { outcome: { outcome: 'cancelled' } } });
		expect(parse(frames![1])).toEqual({
			jsonrpc: '2.0',
			method: 'session/cancel',
			params: { sessionId: 'agent-sess-1' }
		});
		// The approval entry is gone; the queued turn was dropped too.
		expect(adapter.encodeOp({ op: 'approve', call_id: ev.call_id, decision: 'allow' })).toBeNull();
	});
});

describe('acp adapter: client-capability refusals and noise', () => {
	it('declines fs/terminal requests we never advertised (so the agent can move on)', () => {
		const { adapter, lines } = makeAdapter();
		handshake(adapter);
		lines.length = 0;
		const events = adapter.translate({
			jsonrpc: '2.0',
			id: 12,
			method: 'fs/read_text_file',
			params: { path: '/etc/passwd' }
		});
		expect(parse(lines[0])).toMatchObject({
			id: 12,
			error: { code: -32601, message: 'unsupported by client: fs/read_text_file' }
		});
		expect(events[0].type).toBe('info');
	});

	it('forwards stderr lines as info with ANSI stripped', () => {
		const { adapter } = makeAdapter();
		const events = adapter.translate({ __stderr: '\u001b[31mboom\u001b[0m' });
		expect(events).toEqual([{ type: 'info', message: '[acp] boom' }]);
		expect(adapter.translate({ __stderr: '   ' })).toEqual([]);
	});

	it('ignores unknown notifications and non-object frames', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		expect(adapter.translate({ jsonrpc: '2.0', method: 'session/whatever', params: {} })).toEqual([]);
		expect(adapter.translate('garbage')).toEqual([]);
		expect(adapter.translate(null)).toEqual([]);
	});

	it('unsupported ops (steer, mcp, commands) return null so the UI can notify', () => {
		const { adapter } = makeAdapter();
		handshake(adapter);
		expect(adapter.encodeOp({ op: 'steer', content: 'x' } as never)).toBeNull();
		expect(adapter.encodeOp({ op: 'command', input: '/compact' } as never)).toBeNull();
		// But the desktop's automatic approval-mode sync is swallowed silently.
		expect(adapter.encodeOp({ op: 'set_approval_mode', mode: 'auto-edit' } as never)).toEqual([]);
	});
});

describe('acp adapter: images', () => {
	it('attaches images only when the agent advertised the image capability', () => {
		const withImages = makeAdapter();
		handshake(withImages.adapter, { image: true });
		const frames = withImages.adapter.encodeOp({
			op: 'user_message',
			content: 'see this',
			images: ['/tmp/shot.png']
		});
		const prompt = parse(frames![0]).params.prompt;
		expect(prompt).toHaveLength(2);
		expect(prompt[1]).toMatchObject({ type: 'image', mimeType: 'image/png', uri: 'file:///tmp/shot.png' });

		const noImages = makeAdapter();
		handshake(noImages.adapter, { image: false });
		const frames2 = noImages.adapter.encodeOp({
			op: 'user_message',
			content: 'see this',
			images: ['/tmp/shot.png']
		});
		expect(parse(frames2![0]).params.prompt).toHaveLength(1);
	});

	it('imageMime guesses from the extension with a png fallback', () => {
		expect(imageMime('/a/b.jpg')).toBe('image/jpeg');
		expect(imageMime('/a/b.webp')).toBe('image/webp');
		expect(imageMime('/a/b.unknown')).toBe('image/png');
	});
});

describe('acp adapter: restart resets per-process state', () => {
	it('onStart clears the previous process session and re-initializes', () => {
		const { adapter, lines } = makeAdapter();
		handshake(adapter);
		adapter.encodeOp({ op: 'user_message', content: 'pre-crash' });
		// The child died and was restarted: fresh io, fresh handshake.
		const lines2: string[] = [];
		adapter.onStart({ sendLine: (l: string) => lines2.push(l) }, CTX);
		expect(parse(lines2[0])).toMatchObject({ id: 1, method: 'initialize' });
		// The stale agent session is gone — messages queue until session/new.
		expect(adapter.encodeOp({ op: 'user_message', content: 'post-crash' })).toEqual([]);
		expect(lines2).toHaveLength(1);
		// diffText stays pure (no adapter state involved).
		expect(diffText({ type: 'diff', path: 'f', newText: 'a' })).toBe('--- f\n+++ f\n+a');
	});
});
