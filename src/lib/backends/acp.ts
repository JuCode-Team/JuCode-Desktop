// Adapter for Agent Client Protocol agents (JSON-RPC 2.0 over stdio lines,
// protocol v1 — https://agentclientprotocol.com). One child process per
// desktop session, launched from the Rust-side ACP registry (`acp_registry.rs`);
// works against any registered agent (`jucode acp`, gemini-cli with
// --experimental-acp, …).
//
// Handshake:
//   → {id:1, method:"initialize", params:{protocolVersion:1, clientCapabilities}}
//   ← {id:1, result:{protocolVersion, agentCapabilities, authMethods}}
//   → {id:2, method:"session/new", params:{cwd, mcpServers:[]}}
//   ← {id:2, result:{sessionId, modes?, models?}}
//   → {id:3, method:"session/prompt", params:{sessionId, prompt:[blocks]}}
//   ← notifications: session/update (agent_message_chunk, agent_thought_chunk,
//     tool_call, tool_call_update, plan, …)
//   ← {id:3, result:{stopReason}}          — the turn is over
//
// Permission prompts arrive as `session/request_permission` server→client
// requests; they are bridged to jucode-style `approval_request` events via a
// synthetic call_id registry (README "Approval bridging") and answered with
// the picked option id ({outcome:{outcome:"selected", optionId}}). The
// desktop's allow/deny/always trio is mapped onto the agent's advertised
// option kinds (allow_once / allow_always / reject_once / reject_always).
//
// ACP has no turn-started notification: `session/prompt` is answered only when
// the turn settles. The busy indicator therefore flips on the first frame the
// agent sends after a prompt goes out (chunk, tool call or permission request)
// — see the `translate` wrapper.
//
// Deliberately NOT mapped (conservative caps, see docs/acp.md): session modes
// (agent-defined ids — no provable mapping onto the desktop's approval trio),
// session/set_model, session/load (resume), steer, hunk-subset approvals,
// MCP management, checkpoints, context/usage telemetry, slash commands.
//
// One prompt per turn: while a prompt is in flight, further user messages are
// queued adapter-side and submitted as their own turns once the current
// response settles (same UX as claude's native stdin queue).

import type { Op } from '$lib/protocol';
import { t } from '$lib/i18n';
import type { AdapterIO, BackendCaps, EngineAdapter, NormalizedEvent, SessionCtx } from './types';
import { isStderrPayload } from './types';
import type {
	AcpContentBlock,
	AcpPermissionOption,
	AcpPromptCapabilities,
	AcpSessionUpdate,
	AcpToolCallContent,
	InitializeResponse,
	JsonRpcErrorShape,
	NewSessionResponse,
	PromptResponse,
	RequestId,
	RequestPermissionParams,
	SessionUpdateParams
} from './acp-types';

export const ACP_PROTOCOL_VERSION = 1;

export const ACP_CAPS: BackendCaps = {
	approvalModes: false, // ACP session modes are agent-defined ids — no safe mapping
	extendedApprovalModes: false,
	hunkApproval: false, // permission responses are whole-call option picks
	steer: false, // no mid-turn injection; queued messages run as the next turn
	interrupt: true, // session/cancel (core protocol, all agents)
	branchTree: false,
	goals: false, // plan updates still render (RightDock shows plan when present)
	skills: false,
	mcpManage: false,
	checkpoints: false,
	contextUsage: false, // no usage/context telemetry in ACP v1
	compact: false,
	modelPicker: false, // session/set_model is optional; kept off until provable
	resume: false, // session/load is optional (jucode acp: loadSession false)
	subagents: false,
	transcriptReplay: false,
	slashCommands: false // available_commands have no invocation RPC (prompt text only)
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> | null =>
	typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

/** Best-effort mime type for an attached image path. */
export function imageMime(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return (
		{ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[
			ext
		] ?? 'image/png'
	);
}

/** Text carried by one ACP content block (non-text blocks best-effort). */
function blockText(block: AcpContentBlock | undefined): string {
	if (!block) return '';
	if (block.type === 'text') return str(block.text);
	if (block.type === 'resource_link') return str(block.uri);
	if (block.type === 'resource') return str(block.resource?.uri);
	return '';
}

/** Renders a tool-call `diff` content item as a unified-diff-ish string the
 *  ToolCard's diff view can color. */
export function diffText(item: AcpToolCallContent): string {
	const path = str(item.path);
	const out: string[] = [`--- ${path}`, `+++ ${path}`];
	const old = typeof item.oldText === 'string' ? item.oldText : '';
	if (old) for (const line of old.split('\n')) out.push(`-${line}`);
	for (const line of str(item.newText).split('\n')) out.push(`+${line}`);
	return out.join('\n');
}

/** Strip ANSI escapes from an agent stderr line. */
function cleanStderr(line: string): string {
	// eslint-disable-next-line no-control-regex
	return line.replace(/\u001b\[[0-9;]*m/g, '').trim();
}

interface ToolMeta {
	name: string;
	kind: string;
	path: string;
	text: string;
	diff: string;
}

export function createAcpAdapter(): EngineAdapter {
	// --- per-session, per-process state (fully reset in onStart) --------------
	let io: AdapterIO | null = null;
	let ctx: SessionCtx | null = null;
	let nextId = 0;
	/** Our outstanding JSON-RPC requests: id → method (response routing). */
	let pending = new Map<RequestId, { method: string }>();
	/** The AGENT's session id (session/new response) — not the desktop's. */
	let agentSessionId: string | null = null;
	let promptCaps: AcpPromptCapabilities = {};
	/** A session/prompt awaiting its response (one turn at a time). */
	let promptInFlight = false;
	/** `connecting` already emitted for the in-flight prompt. */
	let busyAnnounced = false;
	/** Prompts submitted while busy / before the session opened. */
	let queued: AcpContentBlock[][] = [];
	/** Synthetic approval call_id → the server request awaiting our response. */
	let approvals = new Map<string, { requestId: RequestId; options: AcpPermissionOption[] }>();
	let approvalSeq = 0;
	/** Live tool-call bookkeeping (tool cards accumulate across updates). */
	let tools = new Map<string, ToolMeta>();
	let model = '';

	const frame = (msg: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', ...msg });
	const request = (method: string, params?: unknown): string => {
		const id = ++nextId;
		pending.set(id, { method });
		return frame({ id, method, params });
	};
	const send = (line: string) => io?.sendLine(line);

	const promptFrame = (blocks: AcpContentBlock[]): string => {
		promptInFlight = true;
		busyAnnounced = false;
		return request('session/prompt', { sessionId: agentSessionId, prompt: blocks });
	};

	/** Turn settled: run the next queued prompt (stay busy) or go ready. */
	const settleTurn = (): NormalizedEvent[] => {
		promptInFlight = false;
		busyAnnounced = false;
		const next = queued.shift();
		if (next && agentSessionId) {
			send(promptFrame(next));
			return [{ type: 'connecting' }];
		}
		return [{ type: 'status', message: 'ready' }];
	};

	const toolOutput = (meta: ToolMeta): string =>
		JSON.stringify({
			kind: meta.kind,
			...(meta.path ? { path: meta.path } : {}),
			...(meta.text ? { content: meta.text } : {}),
			...(meta.diff ? { diff: meta.diff } : {})
		});

	/** Folds a tool_call / tool_call_update's content items into the meta. */
	function absorbToolContent(meta: ToolMeta, content: unknown): void {
		if (!Array.isArray(content)) return;
		for (const item of content as AcpToolCallContent[]) {
			if (item?.type === 'content') {
				const text = blockText(item.content);
				if (text) meta.text += (meta.text ? '\n' : '') + text;
			} else if (item?.type === 'diff') {
				if (!meta.path) meta.path = str(item.path);
				meta.diff += (meta.diff ? '\n' : '') + diffText(item);
			}
			// terminal items need the (unadvertised) terminal capability — skipped.
		}
	}

	// --- session/update → jucode events ----------------------------------------

	function onSessionUpdate(params: SessionUpdateParams): NormalizedEvent[] {
		const update = (params.update ?? {}) as AcpSessionUpdate & {
			content?: AcpContentBlock | AcpToolCallContent[];
		};
		switch (str(update.sessionUpdate)) {
			case 'agent_message_chunk': {
				const text = blockText(update.content as AcpContentBlock);
				return text ? [{ type: 'assistant_delta', delta: text }] : [];
			}
			case 'agent_thought_chunk': {
				const text = blockText(update.content as AcpContentBlock);
				return text ? [{ type: 'reasoning_delta', delta: text }] : [];
			}
			case 'user_message_chunk':
				// The desktop already rendered the message optimistically.
				return [];
			case 'tool_call': {
				const id = str(update.toolCallId);
				if (!id) return [];
				const meta: ToolMeta = {
					name: str(update.title) || str(update.kind) || 'tool',
					kind: str(update.kind) || 'other',
					path: str(update.locations?.[0]?.path),
					text: '',
					diff: ''
				};
				absorbToolContent(meta, update.content);
				tools.set(id, meta);
				const events: NormalizedEvent[] = [
					{ type: 'tool_start', call_id: id, name: meta.name },
					{ type: 'tool_update', call_id: id, output: toolOutput(meta) }
				];
				// Some agents announce tool calls already settled.
				const status = str(update.status);
				if (status === 'completed' || status === 'failed') {
					tools.delete(id);
					events.push({
						type: 'tool_output',
						call_id: id,
						name: meta.name,
						output: toolOutput(meta),
						is_error: status === 'failed'
					});
				}
				return events;
			}
			case 'tool_call_update': {
				const id = str(update.toolCallId);
				const meta = tools.get(id);
				if (!meta) return [];
				if (str(update.title)) meta.name = str(update.title);
				if (str(update.locations?.[0]?.path)) meta.path = str(update.locations?.[0]?.path);
				absorbToolContent(meta, update.content);
				const status = str(update.status);
				if (status === 'completed' || status === 'failed') {
					tools.delete(id);
					return [
						{
							type: 'tool_output',
							call_id: id,
							name: meta.name,
							output: toolOutput(meta),
							is_error: status === 'failed'
						}
					];
				}
				return [{ type: 'tool_update', call_id: id, output: toolOutput(meta) }];
			}
			case 'plan': {
				const entries = Array.isArray(update.entries) ? update.entries : [];
				return [
					{
						type: 'plan',
						plan: entries.map((e) => ({ step: str(e?.content), status: str(e?.status) || 'pending' }))
					}
				];
			}
			default:
				// available_commands_update, current_mode_update, … — no surface yet.
				return [];
		}
	}

	// --- responses / server requests -------------------------------------------

	function onResponse(
		id: RequestId,
		result: unknown,
		error: JsonRpcErrorShape | null
	): NormalizedEvent[] {
		const entry = pending.get(id);
		if (!entry) return [];
		pending.delete(id);
		const { method } = entry;
		if (error) {
			const message = str(error.message) || `JSON-RPC error ${error.code}`;
			const events: NormalizedEvent[] = [{ type: 'error', message: `[acp] ${message}` }];
			// A failed prompt must unstick the busy indicator (and run the queue).
			if (method === 'session/prompt') events.push(...settleTurn());
			if (method === 'session/new' || method === 'initialize')
				events.push({ type: 'status', message: 'ready' });
			return events;
		}
		switch (method) {
			case 'initialize': {
				const r = (result ?? {}) as InitializeResponse;
				promptCaps = r.agentCapabilities?.promptCapabilities ?? {};
				send(request('session/new', { cwd: ctx?.cwd || '', mcpServers: [] }));
				return [];
			}
			case 'session/new': {
				const r = (result ?? {}) as NewSessionResponse;
				agentSessionId = str(r.sessionId) || null;
				const current = r.models?.currentModelId;
				model =
					str(r.models?.availableModels?.find((m) => m.modelId === current)?.name) ||
					str(current);
				const events: NormalizedEvent[] = [
					// session_id stays empty on purpose: ACP has no session/load
					// guarantee, so these conversations are not resumable and the
					// desktop must not persist them as restorable tabs.
					{ type: 'startup', model, cwd: ctx?.cwd ?? '', session_id: '', context_window: 0 }
				];
				if (model) {
					events.push({
						type: 'model_status',
						provider: 'acp',
						model,
						reasoning_effort: '',
						reasoning_efforts: [],
						context_window: 0,
						context_limit: 0
					});
				}
				events.push({ type: 'status', message: 'ready' });
				const next = queued.shift();
				if (next && agentSessionId) {
					send(promptFrame(next));
					events.push({ type: 'connecting' });
				}
				return events;
			}
			case 'session/prompt': {
				const stop = str((result as PromptResponse)?.stopReason);
				const events: NormalizedEvent[] = [];
				if (stop === 'refusal') events.push({ type: 'info', message: t('shell.backend.acpRefusal') });
				else if (stop === 'max_tokens' || stop === 'max_turn_requests')
					events.push({ type: 'info', message: t('shell.backend.acpTurnLimit', { reason: stop }) });
				events.push(...settleTurn());
				return events;
			}
			default:
				return [];
		}
	}

	function onServerRequest(id: RequestId, method: string, params: unknown): NormalizedEvent[] {
		if (method === 'session/request_permission') {
			const p = (params ?? {}) as RequestPermissionParams;
			const callId = `acp-approval-${++approvalSeq}`;
			approvals.set(callId, { requestId: id, options: p.options ?? [] });
			// Title + any diff the tool call carries — the approval card renders
			// the summary as the thing being approved.
			let summary = str(p.toolCall?.title);
			for (const item of p.toolCall?.content ?? []) {
				if (item?.type === 'diff') summary += `\n${diffText(item)}`;
			}
			return [
				{
					type: 'approval_request',
					call_id: callId,
					// ACP tool kinds double as familiar names ('execute' renders
					// like a shell approval).
					name: str(p.toolCall?.kind) || 'tool',
					summary: summary || str(p.toolCall?.kind) || method,
					subagent_id: null,
					hunks: null
				}
			];
		}
		// fs/read_text_file, fs/write_text_file, terminal/* …: we advertise
		// neither capability — refuse so the agent can resolve instead of hanging.
		send(frame({ id, error: { code: -32601, message: `unsupported by client: ${method}` } }));
		return [{ type: 'info', message: `[acp] ${t('shell.backend.acpUnsupportedRequest', { method })}` }];
	}

	return {
		id: 'acp',
		caps: ACP_CAPS,
		onStart(io_: AdapterIO, ctx_: SessionCtx) {
			// Full per-process reset: pending requests / approvals / queued turns
			// died with the child.
			io = io_;
			ctx = ctx_;
			nextId = 0;
			pending = new Map();
			agentSessionId = null;
			promptCaps = {};
			promptInFlight = false;
			busyAnnounced = false;
			queued = [];
			approvals = new Map();
			approvalSeq = 0;
			tools = new Map();
			model = '';
			send(
				request('initialize', {
					protocolVersion: ACP_PROTOCOL_VERSION,
					clientCapabilities: {
						fs: { readTextFile: false, writeTextFile: false },
						terminal: false
					}
				})
			);
		},
		translate(raw: unknown): NormalizedEvent[] {
			if (isStderrPayload(raw)) {
				const clean = cleanStderr(raw.__stderr);
				return clean ? [{ type: 'info', message: `[acp] ${clean}` }] : [];
			}
			const msg = rec(raw);
			if (!msg) return [];
			// ACP has no turn-started notification — flip the busy indicator on
			// the first protocol frame the agent sends after a prompt went out.
			const announceBusy = promptInFlight && !busyAnnounced;
			if (announceBusy) busyAnnounced = true;
			let events: NormalizedEvent[] = [];
			try {
				const hasId = typeof msg.id === 'number' || typeof msg.id === 'string';
				if (typeof msg.method === 'string') {
					events = hasId
						? onServerRequest(msg.id as RequestId, msg.method, msg.params)
						: msg.method === 'session/update'
							? onSessionUpdate((msg.params ?? {}) as SessionUpdateParams)
							: [];
				} else if (hasId) {
					events = onResponse(
						msg.id as RequestId,
						msg.result,
						(msg.error as JsonRpcErrorShape) ?? null
					);
				}
			} catch (e) {
				console.warn('[acp] translate failed', e, raw);
			}
			return announceBusy ? [{ type: 'connecting' }, ...events] : events;
		},
		encodeOp(op: Op): string[] | null {
			switch (op.op) {
				case 'user_message': {
					const blocks: AcpContentBlock[] = [{ type: 'text', text: op.content }];
					if (promptCaps.image) {
						// Attachments are local temp files; point the agent at them by
						// uri (jucode acp reads file:// uris; agents that require inline
						// base64 data won't see these — documented in docs/acp.md).
						for (const path of op.images ?? []) {
							blocks.push({ type: 'image', mimeType: imageMime(path), data: '', uri: `file://${path}` });
						}
					}
					if (!agentSessionId || promptInFlight) {
						// Handshake still running or a turn is active: queue; flushed by
						// session/new (handshake) or settleTurn (turn end).
						queued.push(blocks);
						return [];
					}
					return [promptFrame(blocks)];
				}
				case 'approve': {
					const entry = approvals.get(op.call_id);
					if (!entry) return null; // stale (restart / cancelled turn)
					approvals.delete(op.call_id);
					// Preference order matters: try each kind in turn (an agent's
					// option ORDER is presentation, not priority).
					const pick = (kinds: string[]) => {
						for (const kind of kinds) {
							const o = entry.options.find((x) => str(x.kind) === kind && str(x.optionId));
							if (o) return o;
						}
						return undefined;
					};
					const option =
						op.decision === 'deny'
							? pick(['reject_once', 'reject_always'])
							: op.always
								? pick(['allow_always', 'allow_once'])
								: pick(['allow_once', 'allow_always']);
					const outcome = option
						? { outcome: 'selected', optionId: str(option.optionId) }
						: { outcome: 'cancelled' };
					return [frame({ id: entry.requestId, result: { outcome } })];
				}
				case 'interrupt': {
					if (!agentSessionId) return [];
					const frames: string[] = [];
					// Per spec: settle outstanding permission requests as cancelled,
					// then notify the agent; the in-flight prompt answers with
					// stopReason "cancelled".
					for (const [callId, entry] of approvals) {
						frames.push(frame({ id: entry.requestId, result: { outcome: { outcome: 'cancelled' } } }));
						approvals.delete(callId);
					}
					queued = [];
					frames.push(frame({ method: 'session/cancel', params: { sessionId: agentSessionId } }));
					return frames;
				}
				case 'set_approval_mode':
					// No safe mapping onto agent-defined session modes; the picker is
					// hidden (caps.approvalModes) — swallow the desktop's startup sync.
					return [];
				case 'shutdown':
					return []; // no protocol-level shutdown; the router kills the child
				default:
					return null; // command / steer / mcp_* — unsupported, UI notifies
			}
		}
	};
}
