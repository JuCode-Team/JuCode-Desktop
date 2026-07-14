// Adapter for the Claude Code CLI (stream-json print mode:
// `claude --print --input-format stream-json --output-format stream-json
//  --include-partial-messages --verbose --replay-user-messages
//  --permission-prompt-tool stdio`).
//
// Protocol (verified live against claude 2.1.208):
//   → {"type":"user","message":{"role":"user","content":[{"type":"text",…}]}}
//   ← {"type":"system","subtype":"init",…}       — re-emitted at EVERY turn start
//   ← {"type":"system","subtype":"status","status":"requesting",…}
//   ← {"type":"stream_event","event":{…raw Anthropic stream event…}}
//   ← {"type":"assistant","message":{…}}         — one frame per completed block
//   ← {"type":"user","message":{…tool_result…}}  — tool results (and stdin echoes
//                                                  with isReplay:true)
//   ← {"type":"result","subtype":"success"|…}    — end of turn (usage, cost)
//
// Permission prompts arrive as `control_request` frames (subtype can_use_tool;
// requires the --permission-prompt-tool stdio spawn flag — without it the CLI
// silently auto-denies gated tools). They are bridged to jucode-style
// `approval_request` events via a synthetic call_id registry (README "Approval
// bridging") and answered with a `control_response` frame. "Always allow" uses
// the native `updatedPermissions` mechanism with a session-scoped addRules
// update (verified: a second identical tool call no longer prompts).
//
// Approval-mode mapping (desktop ↔ claude permission mode):
//   read-only ('ask')    ↔ default
//   auto-edit ('edits')  ↔ acceptEdits
//   full-auto ('all')    ↔ bypassPermissions
// Modes change live via a client→CLI `control_request` with subtype
// set_permission_mode; the CLI acks it and announces the change with a
// `system`/`status` frame carrying `permissionMode`.
//
// Mid-turn stdin messages are queued by the CLI and processed as the NEXT turn
// (native message queue, no in-turn injection) — so `user_message` is always
// encodable and a separate steer op is meaningless (caps.steer = false).
//
// Model switching (verified live): control_request subtype `list_models`
// returns the picker catalog ({value, resolvedModel, displayName, …}; `value`
// is what set_model accepts) and subtype `set_model` switches the session's
// model IN PLACE — acked with success (an unknown model acks with a clear
// error), the conversation context is preserved, and the next system/init
// reports the new model. Both work before the first turn too, so onStart
// prefetches the catalog. There is no set-effort control request in
// stream-json mode → reasoning_efforts stays empty and the effort submenu
// hidden.
//
// Compaction (verified live): the CLI executes slash commands sent as plain
// stream-json user text, so `/compact` maps to a user frame. The CLI answers
// with system/status {status:"compacting"} (→ compaction_start), a
// system/compact_boundary frame (→ compaction_end), system/status
// {compact_result:"success"} and a normal result frame. Slash-command echo
// frames (string content wrapped in <local-command-stdout>/<command-name>…)
// are suppressed.
//
// Resume: session files live under ~/.claude/projects/<munged-cwd>/<id>.jsonl
// (munging: every non-ASCII-alphanumeric char → '-'; verified live). Listing
// them needs filesystem access, so a bare `/resume` is handled by the PAGE
// (claude_sessions Rust command → synthesized resume_view) before it ever
// reaches encodeOp; picking an item opens a fresh desktop session spawned with
// the allowlisted `--resume <id>` option (context preserved engine-side,
// verified live) and the transcript is replayed from the session file
// (claude_session_transcript → `transcript` event, caps.transcriptReplay).

import type { Op } from '$lib/protocol';
import type { EngineApprovalMode } from '$lib/approval';
import { toEngineMode } from '$lib/approval';
import { t } from '$lib/i18n';
import type { AdapterIO, BackendCaps, EngineAdapter, NormalizedEvent, SessionCtx } from './types';
import { isStderrPayload } from './types';
import type {
	ApiUsage,
	AssistantFrame,
	CanUseToolRequest,
	ClaudeModelInfo,
	ContentBlock,
	ControlRequestFrame,
	ControlResponseFrame,
	PermissionResult,
	PermissionUpdate,
	ResultFrame,
	StreamEventFrame,
	SystemInitFrame,
	SystemStatusFrame,
	ToolResultBlock,
	ToolUseBlock,
	UserFrame
} from './claude-types';

// Claude Code thinking-effort levels (`--effort` / the `/effort` slash command).
// Verified against claude 2.1.208: `--effort BOGUS` reports "Valid values: low,
// medium, high, xhigh, max". Ordered Faster → Smarter for the slider.
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_CLAUDE_EFFORT = 'medium';

/** The `/effort` slash command echoes the raw command plus a "Set effort level to
 *  <lvl> (this session only): …" confirmation blurb. Neither is conversation
 *  content — the new level surfaces via model_status — so we drop them wherever
 *  they land (replay user frame or a text frame). */
export function isEffortEcho(text: string): boolean {
	const s = text.trim();
	return /^\/effort\b/.test(s) || /^set effort level to /i.test(s);
}

/** Compact display name for a claude model: "claude-opus-4-8[1m]" → "Opus 4.8
 *  (1M)", "claude-haiku-4-5-20251001" → "Haiku 4.5". The `[1m]` long-context
 *  variant is tagged so it reads as a distinct model from the standard one.
 *  `rawValue` (the alias, e.g. "opus[1m]") is checked for the 1M marker too,
 *  since some resolvedModel ids drop it. */
export function compactClaudeModel(resolvedModel: string, rawValue?: string): string {
	const id = resolvedModel || rawValue || '';
	const is1m = /\[1m\]/i.test(rawValue || '') || /\[1m\]/i.test(id);
	const s = id.replace(/^claude-/, '').replace(/\[1m\]$/i, '');
	if (!s) return rawValue || '';
	const parts = s.split('-');
	const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
	const ver: string[] = [];
	for (const p of parts.slice(1)) {
		if (!/^\d+$/.test(p) || /^\d{8}$/.test(p)) break; // stop at non-numeric or a date suffix
		ver.push(p);
	}
	const base = ver.length ? `${family} ${ver.join('.')}` : family;
	return is1m ? `${base} (1M)` : base;
}

export const CLAUDE_CAPS: BackendCaps = {
	approvalModes: true, // set_permission_mode control request (live, acked)
	extendedApprovalModes: true, // native plan + auto permission modes
	hunkApproval: false, // can_use_tool is whole-call allow/deny
	steer: false, // stdin is already a queue: mid-turn messages run as the next turn
	interrupt: true, // control_request subtype interrupt
	branchTree: false,
	goals: false,
	skills: false,
	mcpManage: false,
	checkpoints: true, // conversation rewind via --resume-session-at respawn (files desktop-side)
	contextUsage: true, // stream_event usage + result modelUsage.contextWindow
	compact: true, // "/compact" as stream-json user text → compacting/compact_boundary frames
	modelPicker: true, // list_models catalog + set_model control requests (live, in place)
	// The /resume picker lists the session files under ~/.claude/projects
	// (claude_sessions Rust command, driven by the page — no listing protocol
	// exists in stream-json mode); picking spawns a fresh session with the
	// allowlisted `--resume <session-id>` option. Crash-restarts and saved-tab
	// restores use the same spawn option (SessionStore passes it through).
	resume: true,
	subagents: false,
	transcriptReplay: true, // restoreSession replays the session file's user/assistant text
	slashCommands: false
};

/** Desktop engine-mode → claude --permission-mode / set_permission_mode value. */
export function toClaudeMode(mode: EngineApprovalMode): string {
	switch (mode) {
		case 'plan':
			return 'plan';
		case 'auto':
			return 'auto';
		case 'auto-edit':
			return 'acceptEdits';
		case 'full-auto':
			return 'bypassPermissions';
		default:
			return 'default';
	}
}

/** Claude permissionMode → desktop engine mode (unknowns → read-only). */
export function fromClaudeMode(mode: string): EngineApprovalMode {
	switch (mode) {
		case 'plan':
			return 'plan';
		case 'auto':
			return 'auto';
		case 'acceptEdits':
			return 'auto-edit';
		case 'bypassPermissions':
		case 'dontAsk':
			return 'full-auto';
		default: // 'default' | 'manual' | …
			return 'read-only';
	}
}

/** Claude tool name → the jucode tool-card name the reducer/UI understands
 *  (EDIT_TOOLS members light up the Changes panel + diff cards). */
function mapToolName(name: string): string {
	switch (name) {
		case 'Bash':
			return 'bash';
		case 'Write':
			return 'write';
		case 'Edit':
		case 'MultiEdit':
		case 'NotebookEdit':
			return 'str_replace';
		case 'Read':
			return 'read';
		case 'Grep':
		case 'Glob':
			return 'ripgrep';
		case 'WebSearch':
			return 'web_search';
		case 'WebFetch':
			return 'web_fetch';
		default:
			return name;
	}
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> | null =>
	typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

const prefixLines = (text: string, prefix: string) =>
	text.length ? text.split('\n').map((l) => `${prefix}${l}`).join('\n') : '';

/** Unified-diff-ish rendering of a claude edit-tool input (old/new strings). */
export function editDiff(claudeName: string, input: Record<string, unknown>): string {
	if (claudeName === 'Write') return prefixLines(str(input.content), '+');
	if (claudeName === 'NotebookEdit') return prefixLines(str(input.new_source), '+');
	const pair = (o: string, n: string) =>
		[prefixLines(o, '-'), prefixLines(n, '+')].filter(Boolean).join('\n');
	if (claudeName === 'MultiEdit') {
		const edits = Array.isArray(input.edits) ? input.edits : [];
		return edits
			.map((e) => {
				const m = rec(e);
				return m ? pair(str(m.old_string), str(m.new_string)) : '';
			})
			.filter(Boolean)
			.join('\n');
	}
	return pair(str(input.old_string), str(input.new_string)); // Edit
}

const editPath = (input: Record<string, unknown>) => str(input.file_path) || str(input.notebook_path);

/** Tool-card JSON synthesized from a claude tool input (the shapes ToolCard /
 *  ChangesPanel already understand: command/stdout, path/paths/diff, pattern…). */
function toolCardJson(claudeName: string, input: Record<string, unknown>): string {
	switch (mapToolName(claudeName)) {
		case 'bash':
			return JSON.stringify({ command: str(input.command) });
		case 'write':
		case 'str_replace': {
			const path = editPath(input);
			return JSON.stringify({ path, paths: path ? [path] : [], diff: editDiff(claudeName, input) });
		}
		case 'read':
			return JSON.stringify({ path: str(input.file_path) });
		case 'ripgrep': {
			const out: Record<string, unknown> = { pattern: str(input.pattern) };
			if (str(input.path)) out.path = str(input.path);
			return JSON.stringify(out);
		}
		case 'web_search':
			return JSON.stringify({ query: str(input.query) });
		case 'web_fetch':
			return JSON.stringify({ url: str(input.url) });
		default:
			return JSON.stringify(input);
	}
}

const SUMMARY_CAP = 4000;
const cap = (s: string) => (s.length > SUMMARY_CAP ? `${s.slice(0, SUMMARY_CAP)}…` : s);

/** Human-readable approval summary from a can_use_tool request. */
function approvalSummary(req: CanUseToolRequest): string {
	const input = rec(req.input) ?? {};
	switch (req.tool_name) {
		case 'Bash': {
			const command = str(input.command);
			const description = str(input.description);
			return cap(description && description !== command ? `${command}\n${description}` : command);
		}
		case 'Write':
		case 'Edit':
		case 'MultiEdit':
		case 'NotebookEdit': {
			const diff = editDiff(req.tool_name, input);
			return cap([editPath(input), diff].filter(Boolean).join('\n'));
		}
		case 'Read':
			return str(input.file_path);
		default: {
			const detail = str(req.description) || JSON.stringify(req.input);
			return cap(`${req.tool_name}: ${detail}`);
		}
	}
}

/** Flatten a tool_result content field (string | content-block array) to text. */
function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((b) => {
			const m = rec(b);
			return m?.type === 'text' ? str(m.text) : '';
		})
		.filter(Boolean)
		.join('\n');
}

/** Heuristic: does this failure mean "sign in again"? */
function isAuthError(message: string): boolean {
	return /invalid api key|\/login|oauth.{0,20}(expired|revoked)|authentication[_ ]?error|\b401\b|unauthorized/i.test(
		message
	);
}

function errorEvent(message: string): NormalizedEvent {
	const hint = isAuthError(message) ? ` ${t('shell.backend.claudeAuthHint')}` : '';
	return { type: 'error', message: `${message}${hint}` };
}

const contextTokens = (u: ApiUsage | undefined) =>
	(u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);

interface ToolMeta {
	claudeName: string;
	name: string;
	input: Record<string, unknown>;
}

export function createClaudeAdapter(): EngineAdapter {
	// --- per-session, per-process state (fully reset in onStart) --------------
	let io: AdapterIO | null = null;
	let mode: EngineApprovalMode = 'read-only';
	let requestSeq = 0;
	/** Our outstanding control_requests: request_id → subtype + intent tag. */
	let pendingCtl = new Map<string, { subtype: string; tag?: string }>();
	/** First system/init of this child already translated into `startup`? */
	let started = false;
	let claudeSessionId = '';
	let model = '';
	let effort = DEFAULT_CLAUDE_EFFORT;
	/** Set when the user switches effort; flushed as a model_status on the next
	 *  frame (the `/effort` slash command produces no ack of its own). */
	let effortDirty = false;
	let lastEngineMode = '';
	let contextWindow = 0;
	/** list_models catalog (drives model_view; prefetched in onStart). */
	let catalog: ClaudeModelInfo[] = [];
	/** The set_model value awaiting its ack (see encodeOp '/model'). */
	let pendingModel = '';
	/** Context windows learned from result modelUsage, per concrete model id. */
	let modelWindows = new Map<string, number>();
	/** Synthetic approval call_id → the CLI request awaiting our control_response. */
	let approvals = new Map<string, { requestId: string; request: CanUseToolRequest }>();
	let approvalSeq = 0;
	/** Live tool_use blocks by id (tool cards + result mapping). */
	let tools = new Map<string, ToolMeta>();
	/** Current API message: per-index streamed char counts + how many blocks the
	 *  `assistant` completion frames already consumed (dedup of streamed text). */
	let blocks = new Map<number, { streamed: number }>();
	let completedBlocks = 0;
	let lastContext = 0;
	let activeTurn = false;
	let interrupting = false;

	const send = (line: string) => io?.sendLine(line);
	const userText = (text: string): string =>
		JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
	const controlRequest = (request: Record<string, unknown>, tag?: string): string => {
		const id = `jucode-${++requestSeq}`;
		pendingCtl.set(id, { subtype: str(request.subtype), tag });
		return JSON.stringify({ type: 'control_request', request_id: id, request });
	};

	const modelStatus = (): NormalizedEvent => ({
		type: 'model_status',
		provider: 'anthropic',
		model,
		// Compact display name for the composer's model button ("Opus 4.8 (1M)").
		model_label: model ? compactClaudeModel(model, model) : '',
		// Thinking effort is switched in place by sending the `/effort <level>`
		// slash command as stream-json user text (verified live).
		reasoning_effort: effort,
		reasoning_efforts: CLAUDE_EFFORT_LEVELS,
		context_window: contextWindow,
		context_limit: 0
	});

	// Descriptions for the slash commands we have i18n for; the rest (custom
	// commands, less-common built-ins) show with no description.
	const CLAUDE_CMD_DESC: Record<string, string> = {
		model: t('shell.cmd.model'),
		resume: t('shell.cmd.resume'),
		compact: t('shell.cmd.compact')
	};

	/** The composer's slash autocomplete (command_list event) for claude, built
	 *  from the CLI's own `slash_commands` (init frame) so custom + built-in
	 *  commands like /context, /doctor all show. /model and /resume are
	 *  desktop-driven, so ensure they're present even if the CLI omits them. */
	const commandList = (cmds: string[]): NormalizedEvent => {
		const names: string[] = [];
		const seen = new Set<string>();
		for (const raw of ['model', 'resume', ...cmds]) {
			const n = raw.replace(/^\//, '').trim();
			if (n && !seen.has(n)) {
				seen.add(n);
				names.push(n);
			}
		}
		return {
			type: 'command_list',
			commands: names.map((n) => ({
				command: `/${n}`,
				marker: null,
				description: CLAUDE_CMD_DESC[n] ?? ''
			}))
		};
	};

	/** list_models response → picker rows (jucode model_view shape). Row ids are
	 *  the `value` strings set_model accepts; the active row is matched against
	 *  the current model (init reports the resolved id — e.g. value "haiku" ↔
	 *  resolved "claude-haiku-4-5-20251001"; first match wins because several
	 *  aliases can resolve to the same model). */
	function modelViewEvent(): NormalizedEvent {
		// Hide the `default`/recommended alias — it duplicates the concrete Opus
		// row it resolves to. Show only concrete models.
		const visible = catalog.filter((m) => !/default|recommended/i.test(m.displayName || m.value));
		const rows = visible.map((m) => ({
			model: m.value,
			// Show a compact concrete name ("Opus 4.8") rather than the alias.
			label: compactClaudeModel(m.resolvedModel || m.value, m.value),
			// Vendor icon matches on this concrete id (contains "claude").
			vendor: m.resolvedModel || m.value,
			active: false,
			context_window: modelWindows.get(m.resolvedModel || m.value) ?? 0,
			max_output_tokens: 0,
			reasoning_efforts: [] as string[]
		}));
		const activeIdx = visible.findIndex((m) => m.value === model || m.resolvedModel === model);
		if (activeIdx >= 0) {
			rows[activeIdx].active = true;
			if (!rows[activeIdx].context_window) rows[activeIdx].context_window = contextWindow;
		} else if (model) {
			// Keep the active model marked even if the catalog doesn't list it.
			rows.unshift({
				model,
				label: compactClaudeModel(model, model),
				vendor: model,
				active: true,
				context_window: contextWindow,
				max_output_tokens: 0,
				reasoning_efforts: []
			});
		}
		return { type: 'model_view', models: rows, active_effort: '' };
	}

	// --- tool lifecycle --------------------------------------------------------

	function toolUseEvents(block: ToolUseBlock, authoritative: boolean): NormalizedEvent[] {
		const id = str(block.id);
		if (!id) return [];
		const input = rec(block.input) ?? {};
		const known = tools.get(id);
		if (known && !authoritative) return [];
		const name = mapToolName(block.name);
		tools.set(id, { claudeName: block.name, name, input });
		const update: NormalizedEvent = { type: 'tool_update', call_id: id, output: toolCardJson(block.name, input) };
		return known ? [update] : [{ type: 'tool_start', call_id: id, name }, update];
	}

	function toolResultEvents(block: ToolResultBlock, structured: unknown): NormalizedEvent[] {
		const id = str(block.tool_use_id);
		const meta = tools.get(id);
		if (!meta) return []; // stale (restart) or untracked
		tools.delete(id);
		const isError = block.is_error === true;
		const text = resultText(block.content);
		let output: string;
		switch (meta.name) {
			case 'bash': {
				const s = rec(structured);
				const body: Record<string, unknown> = { command: str(meta.input.command) };
				if (isError) body.error = text || str(s?.stderr) || 'failed';
				else {
					body.stdout = typeof s?.stdout === 'string' ? s.stdout : text;
					if (str(s?.stderr)) body.stderr = str(s?.stderr);
				}
				output = JSON.stringify(body);
				break;
			}
			case 'write':
			case 'str_replace': {
				const path = editPath(meta.input);
				output = isError
					? JSON.stringify({ path, error: text || 'failed' })
					: JSON.stringify({ path, paths: path ? [path] : [], diff: editDiff(meta.claudeName, meta.input) });
				break;
			}
			case 'read':
				output = JSON.stringify(
					isError ? { path: str(meta.input.file_path), error: text || 'failed' } : { path: str(meta.input.file_path) }
				);
				break;
			case 'ripgrep': {
				const body: Record<string, unknown> = { pattern: str(meta.input.pattern) };
				if (isError) body.error = text || 'failed';
				else body.stdout = text;
				output = JSON.stringify(body);
				break;
			}
			default:
				output = text;
		}
		return [{ type: 'tool_output', call_id: id, name: meta.name, output, is_error: isError }];
	}

	/** A frame from a Task subagent's inner stream (non-null parent_tool_use_id).
	 *  Surface only its TOOL activity so its cards fill (authoritative assistant
	 *  tool_use frame) and complete (user tool_result frame) — otherwise the outer
	 *  card that spawned the subagent shows empty and spins forever. The subagent's
	 *  own assistant text / reasoning / user echoes are dropped: we don't render
	 *  subagent chatter (caps.subagents = false). */
	function subagentFrame(msg: Record<string, unknown>): NormalizedEvent[] {
		if (msg.type === 'stream_event') {
			const ev = (msg as unknown as StreamEventFrame).event;
			if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use')
				return toolUseEvents(ev.content_block, false);
			return [];
		}
		if (msg.type === 'assistant') {
			const content = (msg as unknown as AssistantFrame).message?.content;
			const list = Array.isArray(content) ? (content as ContentBlock[]) : [];
			return list
				.filter((b): b is ToolUseBlock => b.type === 'tool_use')
				.flatMap((b) => toolUseEvents(b, true));
		}
		if (msg.type === 'user') {
			const frame = msg as unknown as UserFrame;
			const content = frame.message?.content;
			if (!Array.isArray(content)) return [];
			return (content as ContentBlock[])
				.filter((b): b is ToolResultBlock => b.type === 'tool_result')
				.flatMap((b) => toolResultEvents(b, frame.tool_use_result));
		}
		return [];
	}

	// --- frame handlers ----------------------------------------------------------

	function onInit(frame: SystemInitFrame): NormalizedEvent[] {
		claudeSessionId = str(frame.session_id);
		const newModel = str(frame.model);
		const engineMode = str(frame.permissionMode);
		if (started) {
			// init is re-emitted at every turn start: only surface actual changes.
			const events: NormalizedEvent[] = [];
			if (newModel && newModel !== model) {
				model = newModel;
				contextWindow = modelWindows.get(newModel) ?? contextWindow;
				events.push(modelStatus());
			} else if (effortDirty) {
				// A `/effort` switch has no ack of its own — surface the new level
				// via the model_status of the turn it produced.
				effortDirty = false;
				events.push(modelStatus());
			}
			if (engineMode && engineMode !== lastEngineMode) {
				lastEngineMode = engineMode;
				events.push({ type: 'approval_mode', mode: fromClaudeMode(engineMode) });
			}
			return events;
		}
		started = true;
		model = newModel;
		lastEngineMode = engineMode;
		return [
			{
				type: 'startup',
				model,
				cwd: str(frame.cwd),
				session_id: claudeSessionId,
				context_window: contextWindow
			},
			modelStatus(),
			commandList(Array.isArray(frame.slash_commands) ? frame.slash_commands : []),
			{ type: 'approval_mode', mode: fromClaudeMode(engineMode) },
			{ type: 'status', message: 'ready' }
		];
	}

	function onStatus(frame: SystemStatusFrame): NormalizedEvent[] {
		const events: NormalizedEvent[] = [];
		const engineMode = str(frame.permissionMode);
		if (engineMode && engineMode !== lastEngineMode) {
			lastEngineMode = engineMode;
			events.push({ type: 'approval_mode', mode: fromClaudeMode(engineMode) });
		}
		if (frame.status === 'requesting') {
			activeTurn = true;
			events.push({ type: 'connecting' });
		}
		if (frame.status === 'compacting') {
			// A /compact runs like a turn (ends with its own result frame) and is
			// interruptible, so it counts as active.
			activeTurn = true;
			events.push({ type: 'compaction_start' });
		}
		// Compaction outcome (status null): success is announced by the
		// compact_boundary frame → compaction_end; anything else is a failure.
		const compactResult = str(frame.compact_result);
		if (compactResult && compactResult !== 'success') {
			events.push({ type: 'compaction_failed', error: compactResult });
		}
		return events;
	}

	function onStreamEvent(frame: StreamEventFrame): NormalizedEvent[] {
		const ev = frame.event;
		switch (ev?.type) {
			case 'message_start': {
				activeTurn = true;
				blocks = new Map();
				completedBlocks = 0;
				lastContext = contextTokens(ev.message?.usage);
				return [{ type: 'context_usage', tokens: lastContext }];
			}
			case 'content_block_start': {
				const idx = typeof ev.index === 'number' ? ev.index : 0;
				blocks.set(idx, { streamed: 0 });
				const block = ev.content_block;
				if (block?.type === 'text') return [{ type: 'assistant_start' }];
				if (block?.type === 'tool_use') return toolUseEvents(block, false);
				return []; // thinking (reasoning_delta creates the block lazily)
			}
			case 'content_block_delta': {
				const idx = typeof ev.index === 'number' ? ev.index : 0;
				const track = blocks.get(idx);
				const d = ev.delta;
				if (d?.type === 'text_delta') {
					const text = str(d.text);
					if (track) track.streamed += text.length;
					return text ? [{ type: 'assistant_delta', delta: text }] : [];
				}
				if (d?.type === 'thinking_delta') {
					const thinking = str(d.thinking);
					if (track) track.streamed += thinking.length;
					return thinking ? [{ type: 'reasoning_delta', delta: thinking }] : [];
				}
				return []; // input_json_delta / signature_delta (full input arrives on the assistant frame)
			}
			case 'message_delta': {
				const u = ev.usage;
				if (!u) return [];
				lastContext = contextTokens(u) + (u.output_tokens ?? 0);
				return [
					{ type: 'usage', input_tokens: contextTokens(u), output_tokens: u.output_tokens ?? 0 },
					{ type: 'context_usage', tokens: lastContext }
				];
			}
			default:
				return []; // content_block_stop / message_stop
		}
	}

	function onAssistant(frame: AssistantFrame): NormalizedEvent[] {
		const content = Array.isArray(frame.message?.content) ? frame.message.content : [];
		const events: NormalizedEvent[] = [];
		for (const block of content as ContentBlock[]) {
			// The k-th completed block corresponds to stream index k (blocks stream
			// in order; each `assistant` frame delivers the just-completed block).
			const streamed = blocks.get(completedBlocks)?.streamed ?? 0;
			completedBlocks++;
			switch (block.type) {
				case 'text': {
					const tail = block.text.slice(streamed);
					if (!tail) break;
					// Drop a /effort confirmation that arrives as a text frame.
					if (isEffortEcho(block.text)) break;
					if (streamed === 0) events.push({ type: 'assistant_start' });
					events.push({ type: 'assistant_delta', delta: tail });
					break;
				}
				case 'thinking': {
					const tail = str(block.thinking).slice(streamed);
					if (tail) events.push({ type: 'reasoning_delta', delta: tail });
					break;
				}
				case 'tool_use':
					events.push(...toolUseEvents(block, true));
					break;
				default:
					break;
			}
		}
		// Stamp the transcript uuid onto the assistant turn so a rewind can resume
		// the session at this point (`--resume-session-at <uuid>`).
		const uuid = str(frame.uuid);
		if (uuid) events.push({ type: 'assistant_uuid', uuid });
		return events;
	}

	function onUser(frame: UserFrame): NormalizedEvent[] {
		const content = frame.message?.content;
		if (frame.isReplay) {
			// Echo of a message we wrote to stdin (--replay-user-messages). The page
			// shows sends optimistically only when idle; queued (busy) sends surface
			// here when their turn starts. ChatState de-duplicates the idle case.
			const list = Array.isArray(content) ? content : [];
			const first = list.find((b) => rec(b)?.type === 'text');
			const text = typeof content === 'string' ? content : str(rec(first)?.text);
			// Slash-command echoes ("<command-name>/compact…", "<local-command-stdout>
			// Set model to…"), the raw /effort echo and its "Set effort level to…"
			// confirmation are internal bookkeeping, not conversation content — their
			// outcomes already surface as model_status / compaction events.
			if (/^<(local-)?command-/.test(text.trim()) || isEffortEcho(text)) return [];
			return text ? [{ type: 'user_message', content: text }] : [];
		}
		if (!Array.isArray(content)) return []; // synthetic notices ("[Request interrupted by user]")
		const events: NormalizedEvent[] = [];
		for (const block of content as ContentBlock[]) {
			if (block.type === 'tool_result') {
				events.push(...toolResultEvents(block, frame.tool_use_result));
			}
		}
		return events;
	}

	function onResult(frame: ResultFrame): NormalizedEvent[] {
		activeTurn = false;
		const wasInterrupting = interrupting;
		interrupting = false;
		const events: NormalizedEvent[] = [];
		// Remember every model's context window (modelUsage is cumulative across
		// the session) — set_model acks and model_view rows reuse them.
		for (const [name, usage] of Object.entries(frame.modelUsage ?? {})) {
			if (typeof usage?.contextWindow === 'number' && usage.contextWindow > 0) {
				modelWindows.set(name, usage.contextWindow);
			}
		}
		const window = modelWindows.get(model);
		if (typeof window === 'number' && window > 0 && window !== contextWindow) {
			contextWindow = window;
			events.push(modelStatus());
		}
		if (typeof frame.total_cost_usd === 'number') {
			// total_cost_usd is cumulative for the child process (session), so it
			// overwrites rather than accumulates desktop-side.
			events.push({ type: 'context_usage', tokens: lastContext, cost: frame.total_cost_usd });
		}
		if ((frame.is_error || frame.subtype !== 'success') && !wasInterrupting) {
			events.push(errorEvent(str(frame.result) || frame.subtype || 'error'));
		}
		events.push({ type: 'status', message: 'ready' });
		return events;
	}

	function onControlRequest(frame: ControlRequestFrame): NormalizedEvent[] {
		const req = frame.request;
		if (req?.subtype === 'can_use_tool') {
			const r = req as unknown as CanUseToolRequest;
			const callId = `approval-${++approvalSeq}`;
			approvals.set(callId, { requestId: str(frame.request_id), request: r });
			return [
				{
					type: 'approval_request',
					call_id: callId,
					name: mapToolName(str(r.tool_name)),
					summary: approvalSummary(r),
					subagent_id: null,
					hunks: null
				}
			];
		}
		// Unsupported CLI→client request (request_user_dialog, elicitation, …):
		// answer with an error so the CLI can resolve it instead of hanging.
		send(
			JSON.stringify({
				type: 'control_response',
				response: {
					subtype: 'error',
					request_id: str(frame.request_id),
					error: `unsupported by client: ${str(req?.subtype)}`
				}
			} satisfies ControlResponseFrame)
		);
		return [
			{ type: 'info', message: `[claude] ${t('shell.backend.claudeUnsupportedRequest', { subtype: str(req?.subtype) })}` }
		];
	}

	function onControlResponse(frame: ControlResponseFrame): NormalizedEvent[] {
		const resp = frame.response;
		if (!resp) return [];
		const entry = pendingCtl.get(str(resp.request_id));
		if (!entry) return []; // CLI echoes of our own responses / unrelated acks
		pendingCtl.delete(str(resp.request_id));
		const { subtype, tag } = entry;
		if (resp.subtype === 'error') {
			if (subtype === 'set_model') pendingModel = '';
			// Verified live: an unknown model acks with a clear error message
			// ('Model "…" is not a recognized model id. Run /model to see …').
			return [errorEvent(str((resp as { error?: string }).error) || `${subtype} failed`)];
		}
		switch (subtype) {
			case 'set_permission_mode': {
				if (started) return [];
				// Bootstrap ack (sent from onStart): the child is up and responsive
				// before its first `system`/`init` (which only arrives with the first
				// turn) — unstick the "starting" state.
				const ackMode = str(rec((resp as { response?: unknown }).response)?.mode);
				const engineMode = ackMode || toClaudeMode(mode);
				lastEngineMode = engineMode;
				return [
					{ type: 'approval_mode', mode: fromClaudeMode(engineMode) },
					// The real slash_commands arrive with the first system/init, which
					// re-emits command_list; here we only know the desktop-native ones.
					commandList([]),
					{ type: 'status', message: 'ready' }
				];
			}
			case 'list_models': {
				const models = rec((resp as { response?: unknown }).response)?.models;
				catalog = (Array.isArray(models) ? models : [])
					.map((m) => m as ClaudeModelInfo)
					.filter((m) => typeof m?.value === 'string' && m.value);
				// tag 'view' = a /model pick request → open the picker.
				if (tag === 'view') return [modelViewEvent()];
				// onStart prefetch: seed the model button before the first turn (the
				// real model only arrives with the first system/init). Use the
				// default/recommended alias's concrete resolvedModel (falls back to the
				// first concrete row). Only when we don't already have a model — onInit
				// later sets the real one and stays silent if it matches.
				if (!model) {
					const def = catalog.find((m) => /default|recommended/i.test(m.displayName || m.value)) ?? catalog[0];
					const resolved = def?.resolvedModel || def?.value;
					if (resolved) {
						model = resolved;
						return [modelStatus()];
					}
				}
				return [];
			}
			case 'set_model': {
				// Ack of a /model pick: the switch happened in place (verified live —
				// context preserved, next init reports the new model). Resolve the
				// picked alias to its concrete id so later init frames stay silent.
				const pick = pendingModel;
				pendingModel = '';
				if (!pick) return [];
				const cat = catalog.find((m) => m.value === pick || m.resolvedModel === pick);
				model = cat?.resolvedModel || cat?.value || pick;
				contextWindow = modelWindows.get(model) ?? 0;
				return [modelStatus()];
			}
			default:
				return []; // interrupt ack, …
		}
	}

	// --- approvals ---------------------------------------------------------------

	/** Session-scoped always-allow permission updates for an approved request:
	 *  prefer the CLI's own addRules suggestions (rescoped to the session so
	 *  nothing is written to settings files), else allow the whole tool. */
	function alwaysPermissions(request: CanUseToolRequest): PermissionUpdate[] {
		const suggested = (request.permission_suggestions ?? [])
			.filter((s) => s.type === 'addRules' && s.behavior === 'allow' && Array.isArray(s.rules))
			.map((s) => ({ ...s, destination: 'session' }));
		if (suggested.length) return suggested;
		return [
			{
				type: 'addRules',
				rules: [{ toolName: str(request.tool_name) }],
				behavior: 'allow',
				destination: 'session'
			}
		];
	}

	return {
		id: 'claude',
		caps: CLAUDE_CAPS,
		onStart(io_: AdapterIO, ctx_: SessionCtx) {
			// Full per-process reset: pending approvals/requests died with the child.
			io = io_;
			mode = (['ask', 'plan', 'auto', 'edits', 'all'] as const).includes(
				ctx_.approvalMode as 'ask' | 'plan' | 'auto' | 'edits' | 'all'
			)
				? toEngineMode(ctx_.approvalMode as 'ask' | 'plan' | 'auto' | 'edits' | 'all')
				: 'read-only';
			requestSeq = 0;
			pendingCtl = new Map();
			started = false;
			claudeSessionId = '';
			model = '';
			lastEngineMode = '';
			contextWindow = 0;
			catalog = [];
			pendingModel = '';
			modelWindows = new Map();
			approvals = new Map();
			approvalSeq = 0;
			tools = new Map();
			blocks = new Map();
			completedBlocks = 0;
			lastContext = 0;
			activeTurn = false;
			interrupting = false;
			// No handshake required (stdin input is accepted immediately). Push the
			// desktop's persisted mode; the ack doubles as the readiness signal.
			// Prefetch the model catalog for the picker (works before the first
			// turn — verified live).
			send(controlRequest({ subtype: 'set_permission_mode', mode: toClaudeMode(mode) }));
			send(controlRequest({ subtype: 'list_models' }));
		},
		translate(raw: unknown): NormalizedEvent[] {
			if (isStderrPayload(raw)) {
				// Strip ANSI, drop tracing-formatted log lines (`2026-…Z ERROR …`) —
				// routine engine noise that would otherwise spam the transcript.
				// eslint-disable-next-line no-control-regex
				const line = raw.__stderr.replace(/\[[0-9;]*m/g, '').trim();
				if (!line) return [];
				if (/^\d{4}-\d{2}-\d{2}T\S+\s+(ERROR|WARN|INFO|DEBUG|TRACE)\b/.test(line)) return [];
				return [{ type: 'info', message: `[claude] ${line}` }];
			}
			const msg = rec(raw);
			if (!msg) return [];
			try {
				// Frames tagged with a parent tool id belong to a Task subagent's
				// inner stream: surface their tool activity (so the spawning card
				// fills + completes) but drop their chatter (caps.subagents = false).
				if (str(msg.parent_tool_use_id)) return subagentFrame(msg);
				switch (msg.type) {
					case 'system': {
						if (msg.subtype === 'init') return onInit(msg as unknown as SystemInitFrame);
						if (msg.subtype === 'status') return onStatus(msg as unknown as SystemStatusFrame);
						if (msg.subtype === 'compact_boundary') return [{ type: 'compaction_end' }];
						return [];
					}
					case 'stream_event':
						return onStreamEvent(msg as unknown as StreamEventFrame);
					case 'assistant':
						return onAssistant(msg as unknown as AssistantFrame);
					case 'user':
						return onUser(msg as unknown as UserFrame);
					case 'result':
						return onResult(msg as unknown as ResultFrame);
					case 'control_request':
						return onControlRequest(msg as unknown as ControlRequestFrame);
					case 'control_response':
						return onControlResponse(msg as unknown as ControlResponseFrame);
					default:
						return []; // rate_limit_event, tool_progress, …
				}
			} catch (e) {
				console.warn('[claude] translate failed', e, raw);
			}
			return [];
		},
		encodeOp(op: Op): string[] | null {
			switch (op.op) {
				case 'user_message': {
					const content: { type: 'text'; text: string }[] = [{ type: 'text', text: op.content }];
					// Image attachments arrive as temp-file paths; stream-json input has
					// no local-image block, so point Claude at the file (its Read tool
					// renders images natively).
					for (const path of op.images ?? []) {
						content.push({ type: 'text', text: `[Attached image: ${path} — open it with the Read tool]` });
					}
					return [JSON.stringify({ type: 'user', message: { role: 'user', content } })];
				}
				case 'approve': {
					const entry = approvals.get(op.call_id);
					if (!entry) return null; // stale (restart) or already answered
					approvals.delete(op.call_id);
					const result: PermissionResult =
						op.decision === 'deny'
							? { behavior: 'deny', message: 'The user denied this tool use.' }
							: {
									behavior: 'allow',
									updatedInput: rec(entry.request.input) ?? {},
									...(op.always ? { updatedPermissions: alwaysPermissions(entry.request) } : {})
								};
					return [
						JSON.stringify({
							type: 'control_response',
							response: { subtype: 'success', request_id: entry.requestId, response: result }
						})
					];
				}
				case 'interrupt':
					// Nothing running → nothing to do (treated as handled, not refused).
					if (!activeTurn) return [];
					interrupting = true;
					return [controlRequest({ subtype: 'interrupt' })];
				case 'set_approval_mode':
					mode = op.mode;
					// Applied live; the CLI acks and follows up with a system/status
					// frame carrying the new permissionMode (→ approval_mode event).
					return [controlRequest({ subtype: 'set_permission_mode', mode: toClaudeMode(op.mode) })];
				case 'command': {
					const input = op.input.trim();
					const sp = input.indexOf(' ');
					const cmd = sp < 0 ? input : input.slice(0, sp);
					const arg = sp < 0 ? '' : input.slice(sp + 1).trim();
					switch (cmd) {
						case '/model': {
							// Bare /model opens the picker (model_view from the response).
							if (!arg) return [controlRequest({ subtype: 'list_models' }, 'view')];
							// `/model <value> [effort]` — the composer sends the current
							// model plus the chosen effort when only the slider moved, so
							// handle both independently: model via set_model (acked →
							// model_status), effort via the `/effort` slash command (no ack
							// → flushed as model_status on the next frame, see onInit).
							const parts = arg.split(/\s+/);
							const frames: string[] = [];
							const ef = parts.find((p) => CLAUDE_EFFORT_LEVELS.includes(p));
							if (ef && ef !== effort) {
								effort = ef;
								effortDirty = true;
								frames.push(userText(`/effort ${ef}`));
							}
							const name = parts.find((p) => !CLAUDE_EFFORT_LEVELS.includes(p));
							if (name && name !== model) {
								pendingModel = name;
								frames.push(controlRequest({ subtype: 'set_model', model: name }));
							}
							return frames.length ? frames : [];
						}
						case '/compact':
							// The CLI executes slash commands sent as stream-json user text
							// (verified live): status "compacting" → compaction_start,
							// compact_boundary → compaction_end, then a result frame.
							return [
								JSON.stringify({
									type: 'user',
									message: { role: 'user', content: [{ type: 'text', text: '/compact' }] }
								})
							];
						default:
							// /resume is page-driven for claude (session listing needs fs
							// access via the claude_sessions command); desktop/jucode-only
							// commands aren't claude CLI commands, so never forward them.
							if (['/resume', '/rewind', '/tree', '/checkout', '/fork', '/undo'].includes(cmd))
								return null;
							// Any other slash command comes from the CLI's own slash_commands
							// list (built-ins like /context, /doctor or a user's custom
							// command) — forward it verbatim as stream-json user text for the
							// CLI to execute, same mechanism as /compact.
							return [userText(input)];
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
