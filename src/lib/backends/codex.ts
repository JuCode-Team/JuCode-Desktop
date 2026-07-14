// Adapter for the OpenAI Codex CLI (`codex app-server`, JSON-RPC 2.0 over
// stdio lines — the v2 "thread/turn" surface of codex-cli 0.144.x).
//
// Handshake (verified live against codex-cli 0.144.3):
//   → {id:1, method:"initialize", params:{clientInfo, capabilities:null}}
//   ← {id:1, result:{userAgent,…}}
//   → {method:"initialized"}
//   → {id:2, method:"thread/start", params:{cwd, approvalPolicy, sandbox}}
//   ← {id:2, result:{thread:{id},…}}          — thread id = engine session id
//   → {id:3, method:"turn/start", params:{threadId, input:[{type:"text",…}]}}
//   ← notifications: turn/started, item/started, item/agentMessage/delta …,
//     item/completed, thread/tokenUsage/updated, turn/completed
//
// Approvals arrive as JSON-RPC *server→client requests*
// (item/commandExecution/requestApproval, item/fileChange/requestApproval);
// they are bridged to jucode-style `approval_request` events via a synthetic
// call_id registry (README "Approval bridging") and answered with a JSON-RPC
// response frame `{id, result:{decision}}`.
//
// Approval-mode mapping (desktop → codex approvalPolicy + sandbox):
//   read-only ('ask')    → on-request + read-only sandbox   (edits/shell prompt)
//   auto-edit ('edits')  → on-request + workspace-write     (workspace writes free)
//   full-auto ('all')    → never      + danger-full-access  (nothing prompts)
// The thread starts with the desktop's persisted mode; later set_approval_mode
// ops are stored and applied as per-turn overrides on the next turn/start
// (the protocol scopes them to "this turn and subsequent turns").
//
// Model switching (verified live): `model/list` returns the picker catalog
// (per-model supportedReasoningEfforts + defaultReasoningEffort). There is NO
// thread-level set-model RPC in 0.144.x, so a pick is applied as `model` /
// `effort` overrides on every subsequent turn/start ("this turn and subsequent
// turns" — the override is also persisted into the rollout, so a later
// thread/resume comes back with the picked model).
//
// Resume (verified live): `thread/resume {threadId, cwd, approvalPolicy,
// sandbox}` answers with the thread/start response shape plus
// `thread.turns[].items` (full history → replayed as a `transcript` event; the
// server-side context is preserved). Crash auto-restarts and saved-tab restores
// pass the thread id via `SessionCtx.resume`; the resume picker lists
// `thread/list {cwd}`. Picking an item opens a fresh desktop session (page
// flow), while a typed `/resume <id>` switches threads in place on the same
// child — the app-server hosts many threads per process.
//
// Compaction (verified live): `thread/compact/start {threadId}` acks with {}
// and runs as its own turn wrapping a `contextCompaction` item (item/started →
// compaction_start, item/completed → compaction_end). The deprecated
// thread/compacted notification is NOT emitted by 0.144.x but stays mapped for
// other versions.
//
// Goals (verified live): thread/goal/set|get|clear RPCs + thread/goal/updated
// and thread/goal/cleared notifications → the desktop `goal` event.

import type { Op } from '$lib/protocol';
import type { EngineApprovalMode } from '$lib/approval';
import { toEngineMode } from '$lib/approval';
import { t } from '$lib/i18n';
import type { AdapterIO, BackendCaps, EngineAdapter, NormalizedEvent, SessionCtx } from './types';
import { isStderrPayload } from './types';
import type {
	AskForApproval,
	CodexApprovalDecision,
	CodexModel,
	CommandExecutionRequestApprovalParams,
	DeltaNotification,
	ErrorNotificationParams,
	FileChangeRequestApprovalParams,
	FileUpdateChange,
	ItemNotification,
	JsonRpcErrorShape,
	ModelListResponse,
	RequestId,
	SandboxPolicy,
	ThreadGoal,
	ThreadGoalUpdatedParams,
	ThreadItem,
	ThreadListParams,
	ThreadRollbackParams,
	ThreadListResponse,
	ThreadResumeParams,
	ThreadStartResponse,
	ThreadTokenUsageParams,
	Turn,
	TurnStartParams,
	UserInput
} from './codex-types';

export const CODEX_CAPS: BackendCaps = {
	approvalModes: true, // thread/start approvalPolicy+sandbox, per-turn overrides
	extendedApprovalModes: false, // codex has no plan/auto modes
	hunkApproval: false, // codex approvals are whole-patch accept/decline
	steer: false,
	interrupt: true, // turn/interrupt
	branchTree: false,
	goals: true, // thread/goal/set|get|clear + thread/goal/updated|cleared
	skills: false,
	mcpManage: false,
	checkpoints: true, // conversation rewind via thread/rollback (files handled desktop-side)
	contextUsage: true, // thread/tokenUsage/updated
	compact: true, // thread/compact/start + contextCompaction item lifecycle
	modelPicker: true, // model/list catalog + per-turn model/effort overrides
	resume: true, // thread/list picker + thread/resume (SessionCtx.resume / in-place)
	subagents: false,
	transcriptReplay: true, // thread/resume replays thread.turns[].items
	slashCommands: false
};

const CLIENT_INFO = { name: 'jucode-desktop', title: 'JuCode Desktop', version: '0.1.1' };

/** Desktop engine-mode → codex thread/start knobs. */
function modePolicy(mode: EngineApprovalMode): { approvalPolicy: AskForApproval; sandbox: SandboxPolicy } {
	switch (mode) {
		case 'auto-edit':
			return {
				approvalPolicy: 'on-request',
				sandbox: {
					type: 'workspaceWrite',
					writableRoots: [],
					networkAccess: false,
					excludeTmpdirEnvVar: false,
					excludeSlashTmp: false
				}
			};
		case 'full-auto':
			return { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } };
		default: // 'read-only' / ask
			return { approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } };
	}
}

/** thread/start takes the string SandboxMode, not the structured policy. */
function sandboxMode(p: SandboxPolicy): 'read-only' | 'workspace-write' | 'danger-full-access' {
	return p.type === 'dangerFullAccess'
		? 'danger-full-access'
		: p.type === 'workspaceWrite'
			? 'workspace-write'
			: 'read-only';
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> | null =>
	typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

/** Strip ANSI escapes; drop tracing-formatted log lines (`2026-…Z ERROR …`) —
 *  codex logs routine noise to stderr that would spam the transcript. */
function stderrEvent(line: string): NormalizedEvent | null {
	// eslint-disable-next-line no-control-regex
	const clean = line.replace(/\[[0-9;]*m/g, '').trim();
	if (!clean) return null;
	if (/^\d{4}-\d{2}-\d{2}T\S+\s+(ERROR|WARN|INFO|DEBUG|TRACE)\b/.test(clean)) return null;
	return { type: 'info', message: `[codex] ${clean}` };
}

/** Heuristic: does this failure mean "sign in again"? */
function isAuthError(message: string, codexErrorInfo?: unknown): boolean {
	if (codexErrorInfo === 'unauthorized') return true;
	const info = rec(codexErrorInfo);
	if (info) {
		for (const v of Object.values(info)) {
			if (rec(v)?.httpStatusCode === 401) return true;
		}
	}
	return /\b401\b|unauthorized|token.{0,20}(invalid|invalidated|expired)|authentication/i.test(message);
}

function errorEvent(message: string, codexErrorInfo?: unknown): NormalizedEvent {
	const hint = isAuthError(message, codexErrorInfo) ? ` ${t('shell.backend.codexAuthHint')}` : '';
	return { type: 'error', message: `${message}${hint}` };
}

interface ItemMeta {
	name: string;
	/** Command line (commandExecution) — echoed into the tool card JSON. */
	command?: string;
	/** File changes (fileChange) — reused for the approval summary. */
	changes?: FileUpdateChange[];
	/** Accumulated stream: exec output bytes / assistant chars / reasoning flag. */
	streamed: number;
	buf: string;
}

export function createCodexAdapter(): EngineAdapter {
	// --- per-session, per-process state (fully reset in onStart) --------------
	let io: AdapterIO | null = null;
	let ctx: SessionCtx | null = null;
	let mode: EngineApprovalMode = 'read-only';
	let nextId = 0;
	/** Our outstanding JSON-RPC requests: id → method + intent tag (routing). */
	let pending = new Map<RequestId, { method: string; tag?: string }>();
	let threadId: string | null = null;
	let activeTurnId: string | null = null;
	/** Turns requested before the thread/start response arrived. */
	let queuedInput: UserInput[] = [];
	/** Synthetic approval call_id → the server request awaiting our response. */
	let approvals = new Map<string, { requestId: RequestId }>();
	let approvalSeq = 0;
	/** Live item bookkeeping (tool cards, delta accumulation). */
	let items = new Map<string, ItemMeta>();
	/** Last agentMessage item that streamed (assistant bubble separation). */
	let model = '';
	let provider = '';
	let effort = '';
	let prevTotal = { input: 0, output: 0 };
	let contextWindow = 0;
	/** model/list catalog (visible models; drives model_view + effort options). */
	let catalog: CodexModel[] = [];
	/** A /model pick awaiting its ack round-trip (see encodeOp '/model'). */
	let pendingPick: { model: string; effort: string | null } | null = null;
	/** User-picked model/effort, sent as overrides on every turn/start. Kept
	 *  across restarts (they encode user intent, and the rollout persists them
	 *  server-side anyway). */
	let overrideModel: string | null = null;
	let overrideEffort: string | null = null;
	/** Thread to thread/resume instead of thread/start (SessionCtx.resume). */
	let resumeId: string | null = null;
	/** 0.144.x signals compaction via contextCompaction items; when seen, the
	 *  (deprecated, version-dependent) thread/compacted notification is a dupe. */
	let sawCompactionItem = false;

	const frame = (msg: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', ...msg });
	const request = (method: string, params?: unknown, tag?: string): string => {
		const id = ++nextId;
		pending.set(id, { method, tag });
		return frame({ id, method, params });
	};
	const send = (line: string) => io?.sendLine(line);

	const turnStartFrame = (input: UserInput[]): string => {
		const { approvalPolicy, sandbox } = modePolicy(mode);
		const params: TurnStartParams = {
			threadId: threadId as string,
			input,
			// Keep the engine-enforced policy in lockstep with the desktop picker:
			// scoped to "this turn and subsequent turns" by the protocol.
			approvalPolicy,
			sandboxPolicy: sandbox,
			// Model picker choice: same "this turn and subsequent turns" scoping.
			...(overrideModel ? { model: overrideModel } : {}),
			...(overrideEffort ? { effort: overrideEffort } : {})
		};
		return request('turn/start', params);
	};

	const catalogEntry = (name: string): CodexModel | undefined =>
		catalog.find((m) => m.model === name || m.id === name);

	const effortsFor = (name: string): string[] =>
		catalogEntry(name)?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ?? [];

	const modelStatus = (): NormalizedEvent => ({
		type: 'model_status',
		provider,
		model,
		reasoning_effort: effort,
		reasoning_efforts: effortsFor(model),
		context_window: contextWindow,
		context_limit: 0
	});

	/** The composer's slash autocomplete (command_list event) for codex. */
	const commandList = (): NormalizedEvent => ({
		type: 'command_list',
		commands: [
			{ command: '/model', marker: null, description: t('shell.cmd.model') },
			{ command: '/resume', marker: null, description: t('shell.cmd.resume') },
			{ command: '/compact', marker: null, description: t('shell.cmd.compact') },
			{ command: '/goal', marker: null, description: t('shell.backend.codexCmdGoal') }
		]
	});

	const goalEvent = (g: ThreadGoal | null): NormalizedEvent => ({
		type: 'goal',
		goal: g
			? {
					objective: str(g.objective),
					// usageLimited / budgetLimited both mean "cannot continue" — the
					// desktop's closest status is blocked.
					status:
						g.status === 'usageLimited' || g.status === 'budgetLimited' ? 'blocked' : str(g.status),
					token_budget: typeof g.tokenBudget === 'number' ? g.tokenBudget : null,
					tokens_used: typeof g.tokensUsed === 'number' ? g.tokensUsed : 0,
					time_used_seconds: typeof g.timeUsedSeconds === 'number' ? g.timeUsedSeconds : 0
				}
			: null
	});

	// --- item lifecycle → tool events -----------------------------------------

	function itemStarted(item: ThreadItem): NormalizedEvent[] {
		const id = str(item.id);
		switch (item.type) {
			case 'agentMessage':
				items.set(id, { name: 'assistant', streamed: 0, buf: '' });
				// New bubble per agentMessage item (commentary vs final answer).
				return [{ type: 'assistant_start' }];
			case 'reasoning':
				items.set(id, { name: 'reasoning', streamed: 0, buf: '' });
				return [];
			case 'commandExecution': {
				const command = str(item.command);
				items.set(id, { name: 'bash', command, streamed: 0, buf: '' });
				return [
					{ type: 'tool_start', call_id: id, name: 'bash' },
					{ type: 'tool_update', call_id: id, output: JSON.stringify({ command }) }
				];
			}
			case 'fileChange': {
				const changes = Array.isArray(item.changes) ? item.changes : [];
				items.set(id, { name: 'apply_patch', changes, streamed: 0, buf: '' });
				return [
					{ type: 'tool_start', call_id: id, name: 'apply_patch' },
					{ type: 'tool_update', call_id: id, output: fileChangeOutput(changes) }
				];
			}
			case 'mcpToolCall': {
				const name = `${str(item.server)}.${str(item.tool)}`;
				items.set(id, { name, streamed: 0, buf: '' });
				return [{ type: 'tool_start', call_id: id, name }];
			}
			case 'dynamicToolCall': {
				const name = str(item.tool) || 'tool';
				items.set(id, { name, streamed: 0, buf: '' });
				return [{ type: 'tool_start', call_id: id, name }];
			}
			case 'webSearch': {
				items.set(id, { name: 'web_search', streamed: 0, buf: '' });
				return [
					{ type: 'tool_start', call_id: id, name: 'web_search' },
					{ type: 'tool_update', call_id: id, output: JSON.stringify({ query: str(item.query) }) }
				];
			}
			case 'contextCompaction':
				// A manual thread/compact/start runs as its own turn wrapping this item.
				sawCompactionItem = true;
				return [{ type: 'compaction_start' }];
			default:
				return []; // userMessage (optimistically shown), plan, sleep, …
		}
	}

	function fileChangeOutput(changes: FileUpdateChange[], error?: string): string {
		const paths = changes.map((c) => str(c.path)).filter(Boolean);
		const diff = changes.map((c) => str(c.diff)).join('\n');
		const out: Record<string, unknown> = { path: paths[0] ?? '', paths, diff };
		if (error) out.error = error;
		return JSON.stringify(out);
	}

	function itemCompleted(item: ThreadItem): NormalizedEvent[] {
		const id = str(item.id);
		const meta = items.get(id);
		items.delete(id);
		switch (item.type) {
			case 'agentMessage': {
				// Some paths deliver the final text without (complete) deltas — emit
				// whatever the stream missed.
				const text = str(item.text);
				const seen = meta?.streamed ?? 0;
				return text.length > seen ? [{ type: 'assistant_delta', delta: text.slice(seen) }] : [];
			}
			case 'reasoning': {
				if ((meta?.streamed ?? 0) > 0) return [];
				const summary = (Array.isArray(item.summary) ? item.summary : []).map(str).join('\n\n');
				return summary ? [{ type: 'reasoning_delta', delta: summary }] : [];
			}
			case 'commandExecution': {
				const status = str(item.status);
				const output = JSON.stringify({
					command: str(item.command) || meta?.command || '',
					stdout: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : (meta?.buf ?? ''),
					...(typeof item.exitCode === 'number' ? { exit_code: item.exitCode } : {}),
					...(status === 'declined' ? { error: 'declined' } : {})
				});
				return [
					{ type: 'tool_output', call_id: id, name: 'bash', output, is_error: status !== 'completed' }
				];
			}
			case 'fileChange': {
				const status = str(item.status);
				const changes = Array.isArray(item.changes) ? item.changes : (meta?.changes ?? []);
				return [
					{
						type: 'tool_output',
						call_id: id,
						name: 'apply_patch',
						output: fileChangeOutput(changes, status === 'completed' ? undefined : status),
						is_error: status !== 'completed'
					}
				];
			}
			case 'mcpToolCall': {
				const failed = !!item.error || str(item.status) === 'failed';
				const body = item.error?.message ?? item.result?.structuredContent ?? item.result?.content ?? null;
				return [
					{
						type: 'tool_output',
						call_id: id,
						name: meta?.name ?? `${str(item.server)}.${str(item.tool)}`,
						output: typeof body === 'string' ? body : JSON.stringify(body),
						is_error: failed
					}
				];
			}
			case 'dynamicToolCall': {
				const failed = item.success === false || str(item.status) === 'failed';
				return [
					{
						type: 'tool_output',
						call_id: id,
						name: meta?.name ?? (str(item.tool) || 'tool'),
						output: JSON.stringify(item.contentItems ?? null),
						is_error: failed
					}
				];
			}
			case 'webSearch':
				return [
					{
						type: 'tool_output',
						call_id: id,
						name: 'web_search',
						output: JSON.stringify({ query: str(item.query) }),
						is_error: false
					}
				];
			case 'contextCompaction':
				return [{ type: 'compaction_end' }];
			default:
				return [];
		}
	}

	/** thread/resume history (thread.turns[].items) → the desktop `transcript`
	 *  event rows (reasoning and compaction markers are not persisted rows). */
	function transcriptFromTurns(turns: Turn[]): Record<string, unknown>[] {
		const rows: Record<string, unknown>[] = [];
		for (const turn of turns) {
			for (const item of turn.items ?? []) {
				switch (item.type) {
					case 'userMessage': {
						const text = (Array.isArray(item.content) ? item.content : [])
							.map((c) => (c?.type === 'text' ? str(c.text) : ''))
							.filter(Boolean)
							.join('\n');
						if (text) rows.push({ role: 'user', content: text });
						break;
					}
					case 'agentMessage': {
						const text = str(item.text);
						if (text) rows.push({ role: 'assistant', content: text });
						break;
					}
					case 'commandExecution':
						rows.push({
							role: 'tool',
							name: 'bash',
							output: JSON.stringify({
								command: str(item.command),
								stdout: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '',
								...(typeof item.exitCode === 'number' ? { exit_code: item.exitCode } : {})
							})
						});
						break;
					case 'fileChange':
						rows.push({
							role: 'tool',
							name: 'apply_patch',
							output: fileChangeOutput(Array.isArray(item.changes) ? item.changes : [])
						});
						break;
					case 'mcpToolCall': {
						const body = item.error?.message ?? item.result?.structuredContent ?? item.result?.content ?? null;
						rows.push({
							role: 'tool',
							name: `${str(item.server)}.${str(item.tool)}`,
							output: typeof body === 'string' ? body : JSON.stringify(body)
						});
						break;
					}
					case 'webSearch':
						rows.push({ role: 'tool', name: 'web_search', output: JSON.stringify({ query: str(item.query) }) });
						break;
					default:
						break; // reasoning, contextCompaction, plan, …
				}
			}
		}
		return rows;
	}

	// --- responses / notifications / server requests --------------------------

	/** thread/start and thread/resume answer with the same shape; resume also
	 *  carries the persisted history for transcript replay. Also entered on an
	 *  in-place `/resume <id>` thread switch (same child, new thread). */
	function threadOpened(r: ThreadStartResponse, resumed: boolean): NormalizedEvent[] {
		threadId = str(r?.thread?.id) || null;
		model = str(r?.model);
		provider = str(r?.modelProvider);
		effort = str(r?.reasoningEffort);
		// Per-thread stream state (relevant for in-place thread switches).
		items = new Map();
		prevTotal = { input: 0, output: 0 };
		const events: NormalizedEvent[] = [];
		if (resumed) {
			const rows = transcriptFromTurns(r?.thread?.turns ?? []);
			if (rows.length) events.push({ type: 'transcript', items: rows });
		}
		events.push(
			{ type: 'startup', model, cwd: str(r?.cwd), session_id: threadId ?? '', context_window: contextWindow },
			modelStatus(),
			commandList(),
			{ type: 'approval_mode', mode },
			{ type: 'status', message: 'ready' }
		);
		if (threadId && queuedInput.length) {
			send(turnStartFrame(queuedInput));
			queuedInput = [];
			events.push({ type: 'connecting' });
		}
		return events;
	}

	/** model/list response → picker rows (jucode model_view shape). */
	function modelViewEvent(): NormalizedEvent {
		const rows = catalog.map((m) => ({
			model: m.model,
			active: m.model === model,
			// The catalog carries no per-model context window; the live thread's is
			// the only one known.
			context_window: m.model === model ? contextWindow : 0,
			max_output_tokens: 0,
			reasoning_efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort)
		}));
		// Keep the active model pickable/marked even if the catalog hides it.
		if (model && !rows.some((r) => r.active)) {
			rows.unshift({
				model,
				active: true,
				context_window: contextWindow,
				max_output_tokens: 0,
				reasoning_efforts: effortsFor(model)
			});
		}
		return { type: 'model_view', models: rows, active_effort: effort };
	}

	function onResponse(id: RequestId, result: unknown, error: JsonRpcErrorShape | null): NormalizedEvent[] {
		const entry = pending.get(id);
		if (!entry) return [];
		pending.delete(id);
		const { method, tag } = entry;
		if (error) {
			const message = str(error.message) || `JSON-RPC error ${error.code}`;
			if (method === 'thread/compact/start') return [{ type: 'compaction_failed', error: message }];
			const events: NormalizedEvent[] = [errorEvent(message)];
			// A failed thread/turn bootstrap must unstick the busy indicator.
			if (method === 'thread/start' || method === 'thread/resume' || method === 'turn/start') {
				events.push({ type: 'status', message: 'ready' });
			}
			return events;
		}
		switch (method) {
			case 'initialize': {
				// Handshake step 2: ack + open (or resume) the conversation thread and
				// fetch the model catalog for the picker / effort options.
				const { approvalPolicy, sandbox } = modePolicy(mode);
				const open = {
					cwd: ctx?.cwd || undefined,
					approvalPolicy,
					sandbox: sandboxMode(sandbox)
				};
				send(frame({ method: 'initialized' }));
				send(
					resumeId
						? request('thread/resume', { threadId: resumeId, ...open } satisfies ThreadResumeParams)
						: request('thread/start', open)
				);
				send(request('model/list', {}));
				return [];
			}
			case 'thread/start':
				return threadOpened(result as ThreadStartResponse, false);
			case 'thread/resume':
				return threadOpened(result as ThreadStartResponse, true);
			case 'model/list': {
				const data = (result as ModelListResponse)?.data;
				catalog = (Array.isArray(data) ? data : []).filter((m) => !m?.hidden);
				if (tag === 'view') return [modelViewEvent()];
				if (tag === 'apply' && pendingPick) {
					// Ack of a /model pick: record the per-turn override and reflect it
					// in the UI (see encodeOp '/model' for why this is a round-trip).
					const pick = pendingPick;
					pendingPick = null;
					const cat = catalogEntry(pick.model);
					overrideModel = cat?.model ?? pick.model;
					overrideEffort = pick.effort ?? cat?.defaultReasoningEffort ?? null;
					model = overrideModel;
					effort = overrideEffort ?? '';
					return [modelStatus()];
				}
				// Connect-time fetch: refresh the effort options on the current model.
				return model ? [modelStatus()] : [];
			}
			case 'thread/list': {
				const data = (result as ThreadListResponse)?.data;
				return [
					{
						type: 'resume_view',
						items: (Array.isArray(data) ? data : []).map((th) => ({
							id: str(th?.id),
							label: str(th?.name) || str(th?.preview) || str(th?.id).slice(0, 8),
							detail: typeof th?.updatedAt === 'number' ? new Date(th.updatedAt * 1000).toLocaleString() : '',
							active: str(th?.id) === threadId
						}))
					}
				];
			}
			case 'thread/goal/get':
				return [goalEvent((rec(result)?.goal as ThreadGoal | undefined) ?? null)];
			// thread/goal/set and thread/goal/clear are acked via the
			// thread/goal/updated | thread/goal/cleared notifications instead.
			case 'turn/start':
				activeTurnId = str((result as { turn?: Turn })?.turn?.id) || activeTurnId;
				return [];
			default:
				return [];
		}
	}

	function onServerRequest(id: RequestId, method: string, params: unknown): NormalizedEvent[] {
		if (method === 'item/commandExecution/requestApproval') {
			const p = params as CommandExecutionRequestApprovalParams;
			const callId = `approval-${++approvalSeq}`;
			approvals.set(callId, { requestId: id });
			const command = str(p?.command) || items.get(str(p?.itemId))?.command || '';
			const reason = str(p?.reason);
			return [
				{
					type: 'approval_request',
					call_id: callId,
					name: 'bash',
					summary: reason ? `${command}\n${reason}` : command,
					subagent_id: null,
					hunks: null
				}
			];
		}
		if (method === 'item/fileChange/requestApproval') {
			const p = params as FileChangeRequestApprovalParams;
			const callId = `approval-${++approvalSeq}`;
			approvals.set(callId, { requestId: id });
			// The changes live on the fileChange item that item/started announced
			// just before this request.
			const changes = items.get(str(p?.itemId))?.changes ?? [];
			const summary =
				changes.map((c) => `${str(c.kind?.type) || 'edit'} ${str(c.path)}\n${str(c.diff)}`).join('\n') ||
				str(p?.reason);
			return [
				{
					type: 'approval_request',
					call_id: callId,
					name: 'apply_patch',
					summary,
					subagent_id: null,
					hunks: null
				}
			];
		}
		// Unsupported server request (elicitation, user input, attestation…):
		// answer method-not-found so the server can resolve it instead of hanging.
		send(frame({ id, error: { code: -32601, message: `unsupported by client: ${method}` } }));
		return [{ type: 'info', message: `[codex] ${t('shell.backend.codexUnsupportedRequest', { method })}` }];
	}

	function onNotification(method: string, params: unknown): NormalizedEvent[] {
		const p = rec(params) ?? {};
		switch (method) {
			case 'turn/started':
				activeTurnId = str((p.turn as Turn | undefined)?.id) || activeTurnId;
				return [{ type: 'connecting' }];
			case 'turn/completed': {
				activeTurnId = null;
				const turn = p.turn as Turn | undefined;
				const events: NormalizedEvent[] = [];
				if (turn?.status === 'failed' && turn.error) {
					events.push(errorEvent(str(turn.error.message), turn.error.codexErrorInfo));
				}
				events.push({ type: 'status', message: 'ready' });
				return events;
			}
			case 'item/started':
				return itemStarted((p as unknown as ItemNotification).item ?? ({} as ThreadItem));
			case 'item/completed':
				return itemCompleted((p as unknown as ItemNotification).item ?? ({} as ThreadItem));
			case 'item/agentMessage/delta': {
				const d = p as unknown as DeltaNotification;
				const meta = items.get(str(d.itemId));
				if (meta) meta.streamed += str(d.delta).length;
				return [{ type: 'assistant_delta', delta: str(d.delta) }];
			}
			case 'item/reasoning/summaryTextDelta':
			case 'item/reasoning/textDelta': {
				const d = p as unknown as DeltaNotification;
				const meta = items.get(str(d.itemId));
				if (meta) meta.streamed += str(d.delta).length;
				return [{ type: 'reasoning_delta', delta: str(d.delta) }];
			}
			case 'item/reasoning/summaryPartAdded': {
				// Separate consecutive summary sections inside one reasoning block.
				const meta = items.get(str(p.itemId));
				if (!meta || meta.streamed === 0) return [];
				meta.streamed += 2;
				return [{ type: 'reasoning_delta', delta: '\n\n' }];
			}
			case 'item/commandExecution/outputDelta': {
				const d = p as unknown as DeltaNotification;
				const meta = items.get(str(d.itemId));
				if (!meta) return [];
				meta.buf += str(d.delta);
				return [
					{
						type: 'tool_update',
						call_id: str(d.itemId),
						output: JSON.stringify({ command: meta.command ?? '', stdout: meta.buf })
					}
				];
			}
			case 'thread/tokenUsage/updated': {
				const u = (p as unknown as ThreadTokenUsageParams).tokenUsage;
				if (!u) return [];
				const events: NormalizedEvent[] = [];
				const win = typeof u.modelContextWindow === 'number' ? u.modelContextWindow : 0;
				if (win && win !== contextWindow) {
					contextWindow = win;
					events.push(modelStatus());
				}
				events.push(
					{
						type: 'usage',
						input_tokens: Math.max(0, (u.total?.inputTokens ?? 0) - prevTotal.input),
						output_tokens: Math.max(0, (u.total?.outputTokens ?? 0) - prevTotal.output)
					},
					{ type: 'context_usage', tokens: u.last?.totalTokens ?? 0 }
				);
				prevTotal = { input: u.total?.inputTokens ?? 0, output: u.total?.outputTokens ?? 0 };
				return events;
			}
			case 'turn/plan/updated': {
				const plan = Array.isArray(p.plan) ? p.plan : [];
				return [{ type: 'plan', plan }];
			}
			case 'error': {
				const e = p as unknown as ErrorNotificationParams;
				const message = str(e.error?.message);
				if (!message) return [];
				if (e.willRetry) return [{ type: 'info', message: `[codex] ${message}` }];
				return [errorEvent(message, e.error?.codexErrorInfo)];
			}
			case 'warning':
			case 'deprecationNotice':
			case 'configWarning':
				// Internal / config / deprecation chatter — pure noise in the chat
				// transcript, so we drop it rather than surface a system bubble.
				return [];
			case 'guardianWarning': {
				// Safety-relevant — keep it visible.
				const message = str(p.message);
				return message ? [{ type: 'info', message: `[codex] ${message}` }] : [];
			}
			case 'thread/compacted':
				// Deprecated duplicate of the contextCompaction item lifecycle; only
				// meaningful on versions that don't emit the item.
				return sawCompactionItem ? [] : [{ type: 'compaction_end' }];
			case 'thread/goal/updated': {
				const g = (p as unknown as ThreadGoalUpdatedParams).goal;
				return g ? [goalEvent(g)] : [];
			}
			case 'thread/goal/cleared':
				return [goalEvent(null)];
			case 'serverRequest/resolved': {
				// The server withdrew a pending approval (e.g. interrupted turn):
				// drop the stale registry entry.
				for (const [callId, entry] of approvals) {
					if (entry.requestId === p.requestId) approvals.delete(callId);
				}
				return [];
			}
			default:
				return []; // thread/started, mcpServer/*, account/*, fs/changed, …
		}
	}

	return {
		id: 'codex',
		caps: CODEX_CAPS,
		onStart(io_: AdapterIO, ctx_: SessionCtx) {
			// Full per-process reset: pending requests/approvals died with the child.
			// (overrideModel/overrideEffort survive on purpose — user intent.)
			io = io_;
			ctx = ctx_;
			mode =
				ctx_.approvalMode === 'edits' || ctx_.approvalMode === 'all'
					? toEngineMode(ctx_.approvalMode)
					: 'read-only';
			nextId = 0;
			pending = new Map();
			threadId = null;
			activeTurnId = null;
			queuedInput = [];
			approvals = new Map();
			approvalSeq = 0;
			items = new Map();
			model = '';
			provider = '';
			effort = '';
			prevTotal = { input: 0, output: 0 };
			contextWindow = 0;
			pendingPick = null;
			resumeId = ctx_.resume || null;
			sawCompactionItem = false;
			send(request('initialize', { clientInfo: CLIENT_INFO, capabilities: null }));
		},
		translate(raw: unknown): NormalizedEvent[] {
			if (isStderrPayload(raw)) {
				const ev = stderrEvent(raw.__stderr);
				return ev ? [ev] : [];
			}
			const msg = rec(raw);
			if (!msg) return [];
			try {
				const hasId = typeof msg.id === 'number' || typeof msg.id === 'string';
				if (typeof msg.method === 'string') {
					return hasId
						? onServerRequest(msg.id as RequestId, msg.method, msg.params)
						: onNotification(msg.method, msg.params);
				}
				if (hasId) {
					return onResponse(msg.id as RequestId, msg.result, (msg.error as JsonRpcErrorShape) ?? null);
				}
			} catch (e) {
				console.warn('[codex] translate failed', e, raw);
			}
			return [];
		},
		encodeOp(op: Op): string[] | null {
			switch (op.op) {
				case 'user_message': {
					const input: UserInput[] = [{ type: 'text', text: op.content, text_elements: [] }];
					for (const path of op.images ?? []) input.push({ type: 'localImage', path });
					if (!threadId) {
						// thread/start hasn't answered yet — flushed from onResponse.
						queuedInput.push(...input);
						return [];
					}
					return [turnStartFrame(input)];
				}
				case 'approve': {
					const entry = approvals.get(op.call_id);
					if (!entry) return null; // stale (restart / server-resolved)
					approvals.delete(op.call_id);
					const decision: CodexApprovalDecision =
						op.decision === 'deny' ? 'decline' : op.always ? 'acceptForSession' : 'accept';
					return [frame({ id: entry.requestId, result: { decision } })];
				}
				case 'interrupt':
					// Nothing running → nothing to do (treated as handled, not refused).
					if (!threadId || !activeTurnId) return [];
					return [request('turn/interrupt', { threadId, turnId: activeTurnId })];
				case 'set_approval_mode':
					// Applied as approvalPolicy/sandboxPolicy overrides on the next
					// turn/start (protocol scopes them to subsequent turns).
					mode = op.mode;
					return [];
				case 'command': {
					const input = op.input.trim();
					const sp = input.indexOf(' ');
					const cmd = sp < 0 ? input : input.slice(0, sp);
					const arg = sp < 0 ? '' : input.slice(sp + 1).trim();
					switch (cmd) {
						case '/model': {
							// Bare /model opens the picker (model_view from the response).
							if (!arg) return [request('model/list', {}, 'view')];
							// `/model <name> [effort]` — no thread-level set-model RPC exists
							// (0.144.x), so the pick becomes a per-turn override. Adapters can
							// only emit events from translate(), so the ack (model_status)
							// rides on a cheap model/list round-trip tagged 'apply'.
							const [name, eff] = arg.split(/\s+/);
							pendingPick = { model: name, effort: eff || null };
							return [request('model/list', {}, 'apply')];
						}
						case '/resume': {
							// Bare /resume opens the history picker for this cwd.
							if (!arg) {
								const params: ThreadListParams = { cwd: ctx?.cwd || undefined, limit: 50 };
								return [request('thread/list', params)];
							}
							// `/resume <id>`: in-place thread switch on the same child (the
							// app-server hosts many threads per process); the response replays
							// the transcript. The picker's own picks open a new desktop
							// session instead (page flow → SessionCtx.resume).
							const { approvalPolicy, sandbox } = modePolicy(mode);
							const params: ThreadResumeParams = {
								threadId: arg,
								cwd: ctx?.cwd || undefined,
								approvalPolicy,
								sandbox: sandboxMode(sandbox)
							};
							return [request('thread/resume', params)];
						}
						case '/compact':
							// Runs as its own turn wrapping a contextCompaction item (→
							// compaction_start / compaction_end); errors → compaction_failed.
							return threadId ? [request('thread/compact/start', { threadId })] : [];
						case '/goal': {
							if (!threadId) return [];
							if (!arg) return [request('thread/goal/get', { threadId })];
							if (arg === 'clear') return [request('thread/goal/clear', { threadId })];
							if (arg === 'pause')
								return [request('thread/goal/set', { threadId, status: 'paused' })];
							if (arg === 'resume')
								return [request('thread/goal/set', { threadId, status: 'active' })];
							return [request('thread/goal/set', { threadId, objective: arg })];
						}
						case '/rewind': {
							// Conversation rewind: drop N turns from the thread history. The
							// page computes N from the target turn and truncates its own view;
							// files are the client's job (see checkpoints cap note).
							const n = parseInt(arg, 10);
							return threadId && n > 0
								? [request('thread/rollback', { threadId, numTurns: n } satisfies ThreadRollbackParams)]
								: [];
						}
						default:
							return null; // /tree, … — unsupported, UI notifies
					}
				}
				case 'shutdown':
					return []; // no protocol-level shutdown; the router kills the child
				default:
					return null; // steer / mcp_* — unsupported, UI notifies
			}
		}
	};
}
