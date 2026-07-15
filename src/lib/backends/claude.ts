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
	hunkApproval: true, // MultiEdit splits into per-edit hunks (single Edit stays whole-call)
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

/** tool_use, server_tool_use (WebSearch/WebFetch) and mcp_tool_use all carry the
 *  id/name/input shape and render as tool cards. */
const isToolUse = (b: { type?: string } | null | undefined): b is ToolUseBlock =>
	b?.type === 'tool_use' || b?.type === 'server_tool_use' || b?.type === 'mcp_tool_use';

/** Parse accumulated tool-input JSON, tolerating incomplete chunks (returns null
 *  until the streamed partial_json forms a valid object). */
const tryParseRecord = (text: string): Record<string, unknown> | null => {
	if (!text.trim()) return null;
	try {
		return rec(JSON.parse(text));
	} catch {
		return null;
	}
};

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

/** Split a MultiEdit into one selectable hunk per edit so the approval card can
 *  approve/reject each replacement individually. Only MultiEdit (an explicit
 *  array of edits) maps cleanly to hunks — a single Edit/Write stays whole-call
 *  (returns null → the card shows the normal allow/deny). */
export function claudeEditHunks(claudeName: string, input: Record<string, unknown>): ApprovalHunkOut[] | null {
	if (claudeName !== 'MultiEdit') return null;
	const edits = Array.isArray(input.edits) ? input.edits : [];
	if (edits.length < 2) return null; // a lone edit isn't worth per-hunk UI
	const file = editPath(input);
	const hunks: ApprovalHunkOut[] = [];
	edits.forEach((e, i) => {
		const m = rec(e);
		if (!m) return;
		const lines = [prefixLines(str(m.old_string), '-'), prefixLines(str(m.new_string), '+')]
			.filter(Boolean)
			.join('\n')
			.split('\n');
		hunks.push({ id: `e${i}`, file, header: `edit ${i + 1}/${edits.length}`, lines });
	});
	return hunks.length ? hunks : null;
}

/** The hunk shape emitted on approval_request (mirrors approval.ts ApprovalHunk). */
export interface ApprovalHunkOut {
	id: string;
	file: string;
	header: string;
	lines: string[];
}

/** Normalize a claude `rate_limit_event` into a persistent `rate_limit` banner
 *  event. The CLI's exact shape varies by version, so fields are probed
 *  defensively: `status` (allowed / allowed_warning / rejected) drives the
 *  level, and a reset timestamp is read from several candidate keys. A normal
 *  "allowed" status clears any existing banner. */
export function rateLimitEvents(msg: Record<string, unknown>): NormalizedEvent[] {
	const s = rec(msg.rate_limit) ?? msg;
	const status = (str(s.status) || str(msg.status)).toLowerCase();
	// Reset time may be seconds or ms epoch, or a retry-after delta — normalize to
	// ms epoch when it looks like an absolute time; leave deltas as null (the
	// banner then just shows the message without a countdown).
	const resetRaw = num(s.resetsAt) || num(s.resets_at) || num(s.resetAt) || num(msg.resetsAt);
	const resetsAt = resetRaw > 1e12 ? resetRaw : resetRaw > 1e9 ? resetRaw * 1000 : null;
	const message = str(s.message) || str(msg.message) || status;
	// Anything explicitly rejected/exceeded → hard limit; a warning → soft; a
	// plain "allowed" (or unknown-but-benign) clears the banner.
	if (/reject|exceed|limit_reached|throttl/.test(status)) {
		return [{ type: 'rate_limit', level: 'limited', message, resets_at: resetsAt }];
	}
	if (/warning|approaching|warn/.test(status)) {
		return [{ type: 'rate_limit', level: 'warning', message, resets_at: resetsAt }];
	}
	// An explicit "allowed" clears any banner; an empty/unknown event says nothing.
	if (/allow|ok|normal/.test(status)) return [{ type: 'rate_limit', level: 'ok', message: '', resets_at: null }];
	return [];
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);

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

/** TodoWrite input → a `plan` event. Its statuses (pending/in_progress/completed)
 *  map 1:1 to the plan panel, so the checklist shows there instead of as repeated
 *  per-call tool cards. */
function todoPlanEvents(input: Record<string, unknown>): NormalizedEvent[] {
	const todos = Array.isArray(input.todos) ? input.todos : [];
	const plan = todos
		.map((raw) => {
			const m = rec(raw);
			const step = m ? str(m.content) || str(m.activeForm) : '';
			return step ? { step, status: str(m?.status) || 'pending' } : null;
		})
		.filter((p): p is { step: string; status: string } => !!p);
	return plan.length ? [{ type: 'plan', plan }] : [];
}

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
		case 'ExitPlanMode':
			// Plan mode: show the proposed plan markdown in full (not capped) so the
			// actionable plan card can copy/download the complete text.
			return str(input.plan) || JSON.stringify(req.input);
		case 'Task': {
			// Subagent dispatch: "<subagent_type>: <description|prompt>".
			const who = str(input.subagent_type);
			const what = str(input.description) || str(input.prompt);
			return cap([who, what].filter(Boolean).join(': ') || JSON.stringify(req.input));
		}
		case 'AskUserQuestion': {
			// The model asking the user a multiple-choice question — render the
			// question(s) + options readably instead of dumping raw JSON.
			const questions = Array.isArray(input.questions) ? input.questions : [];
			const text = questions
				.map((q) => {
					const m = rec(q);
					if (!m) return '';
					const opts = (Array.isArray(m.options) ? m.options : [])
						.map((o) => {
							const om = rec(o);
							if (!om) return '';
							const d = str(om.description);
							return `  • ${str(om.label)}${d ? ` — ${d}` : ''}`;
						})
						.filter(Boolean)
						.join('\n');
					return [str(m.question), opts].filter(Boolean).join('\n');
				})
				.filter(Boolean)
				.join('\n\n');
			return cap(text || JSON.stringify(req.input));
		}
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
	// Per stream-index block state. For tool_use blocks the input arrives as
	// streamed `input_json_delta` chunks (partial_json), NOT in one shot — track the
	// tool id and accumulate the JSON so the card fills as it streams.
	let blocks = new Map<number, { streamed: number; toolId?: string; partial?: string }>();
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
		// TodoWrite drives the plan panel, not a per-call tool card (the agent
		// rewrites the whole list each step — cards would pile up).
		if (block.name === 'TodoWrite') {
			tools.set(id, { claudeName: block.name, name: 'todo', input });
			return todoPlanEvents(input);
		}
		// ExitPlanMode is surfaced as an actionable plan approval card, not a tool
		// card — register it (for parent/result tracking) but emit no card events.
		if (block.name === 'ExitPlanMode') {
			tools.set(id, { claudeName: block.name, name: 'ExitPlanMode', input });
			return [];
		}
		const known = tools.get(id);
		if (known && !authoritative) return [];
		const name = mapToolName(block.name);
		tools.set(id, { claudeName: block.name, name, input });
		const update: NormalizedEvent = { type: 'tool_update', call_id: id, output: toolCardJson(block.name, input) };
		return known ? [update] : [{ type: 'tool_start', call_id: id, name }, update];
	}

	/** content_block_start for a tool_use: open the block's input accumulator and
	 *  create the card. Shared by the main stream and subagent streams. */
	function toolBlockStart(block: ToolUseBlock, idx: number): NormalizedEvent[] {
		blocks.set(idx, { streamed: 0, toolId: str(block.id), partial: '' });
		return toolUseEvents(block, false);
	}

	/** A streamed input_json_delta chunk: accumulate and refresh the card once the
	 *  JSON parses (TodoWrite refreshes the plan instead). Shared main/subagent. */
	function toolInputDeltaEvents(idx: number, partialJson: string): NormalizedEvent[] {
		const track = blocks.get(idx);
		if (!track?.toolId) return [];
		track.partial = (track.partial ?? '') + partialJson;
		const meta = tools.get(track.toolId);
		if (!meta) return [];
		const input = tryParseRecord(track.partial);
		if (!input) return [];
		meta.input = input;
		if (meta.claudeName === 'TodoWrite') return todoPlanEvents(input);
		if (meta.claudeName === 'ExitPlanMode') return []; // rendered as a plan card, not a tool card
		return [{ type: 'tool_update', call_id: track.toolId, output: toolCardJson(meta.claudeName, input) }];
	}

	function toolResultEvents(block: ToolResultBlock, structured: unknown): NormalizedEvent[] {
		const id = str(block.tool_use_id);
		const meta = tools.get(id);
		if (!meta) return []; // stale (restart) or untracked
		tools.delete(id);
		// ExitPlanMode never opened a tool card (it's an approval plan card), so its
		// result has no card to close.
		if (meta.claudeName === 'ExitPlanMode') return [];
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
			const idx = typeof ev?.index === 'number' ? ev.index : 0;
			if (ev?.type === 'content_block_start' && isToolUse(ev.content_block))
				return toolBlockStart(ev.content_block, idx);
			// The subagent's inner tool inputs stream the same way — accumulate them so
			// its tool cards fill (previously only the authoritative frame did).
			if (ev?.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta')
				return toolInputDeltaEvents(idx, str(ev.delta.partial_json));
			return [];
		}
		if (msg.type === 'assistant') {
			const content = (msg as unknown as AssistantFrame).message?.content;
			const list = Array.isArray(content) ? (content as ContentBlock[]) : [];
			return list.filter(isToolUse).flatMap((b) => toolUseEvents(b, true));
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
				const from = model;
				model = newModel;
				contextWindow = modelWindows.get(newModel) ?? contextWindow;
				events.push(modelStatus());
				// A user /model switch already updated `model` via the set_model ack, so
				// an unexpected change here is an engine reroute/downgrade.
				events.push({
					type: 'info',
					message: `[claude] model rerouted: ${from ? `${compactClaudeModel(from, from)} → ` : ''}${compactClaudeModel(newModel, newModel)}`
				});
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
		const events: NormalizedEvent[] = [
			{
				type: 'startup',
				model,
				cwd: str(frame.cwd),
				session_id: claudeSessionId,
				context_window: contextWindow
			},
			modelStatus(),
			commandList(Array.isArray(frame.slash_commands) ? frame.slash_commands : []),
			{ type: 'approval_mode', mode: fromClaudeMode(engineMode) }
		];
		// Surface the CLI's MCP servers (init frame carries name + status) so the MCP
		// panel isn't empty for claude. It has no transport/tools detail — map status
		// to the reducer's state shape.
		if (Array.isArray(frame.mcp_servers) && frame.mcp_servers.length) {
			events.push({
				type: 'mcp_servers',
				servers: frame.mcp_servers.map((s) => ({
					name: str(s.name),
					transport: 'stdio',
					state: str(s.status) === 'connected' ? 'connected' : str(s.status) || 'connecting',
					tools: []
				}))
			});
		}
		events.push({ type: 'status', message: 'ready' });
		return events;
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
				const block = ev.content_block;
				if (block?.type === 'text') {
					blocks.set(idx, { streamed: 0 });
					return [{ type: 'assistant_start' }];
				}
				if (isToolUse(block)) {
					// input is {} here; it streams via input_json_delta below.
					return toolBlockStart(block, idx);
				}
				blocks.set(idx, { streamed: 0 });
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
				// Accumulate the tool input's streamed JSON; refresh the card once the
				// accumulated text parses (so command/diff/path fill in live).
				if (d?.type === 'input_json_delta') return toolInputDeltaEvents(idx, str(d.partial_json));
				return []; // signature_delta
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
				case 'server_tool_use':
				case 'mcp_tool_use':
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
		// Only genuine failures get an error card: is_error, or an error_* subtype.
		// Benign non-success ends (cancelled, interrupted, …) shouldn't look like
		// crashes.
		const isFailure = frame.is_error === true || /^error/i.test(str(frame.subtype));
		if (isFailure && !wasInterrupting) {
			const detail =
				str(frame.result) ||
				(Array.isArray(frame.errors) ? frame.errors.map(str).filter(Boolean).join('; ') : '') ||
				frame.subtype ||
				'error';
			// A failed --resume surfaces here (error_during_execution + "No conversation
			// found …") right before the child exits. Treat it as a resume failure so
			// the store restarts fresh instead of showing a scary error card + looping.
			if (/No conversation found with session ID/i.test(detail)) events.push({ type: 'resume_failed' });
			else events.push(errorEvent(detail));
		}
		events.push({ type: 'status', message: 'ready' });
		return events;
	}

	function onControlRequest(frame: ControlRequestFrame): NormalizedEvent[] {
		const req = frame.request;
		if (req?.subtype === 'can_use_tool') {
			const r = req as unknown as CanUseToolRequest;
			// AskUserQuestion is the model asking the user to pick — surface it as an
			// interactive question card (not an allow/deny approval). The user's
			// choice rides back on the permission response's updatedInput.answers,
			// which is what actually makes the tool run in headless mode (otherwise
			// the CLI reports "not enabled in this context").
			if (str(r.tool_name) === 'AskUserQuestion') {
				const callId = `approval-${++approvalSeq}`;
				approvals.set(callId, { requestId: str(frame.request_id), request: r });
				return [
					{
						type: 'approval_request',
						call_id: callId,
						name: 'ask_question',
						summary: approvalSummary(r),
						subagent_id: null,
						hunks: null,
						questions: (rec(r.input)?.questions as unknown) ?? []
					}
				];
			}
			const events: NormalizedEvent[] = [];
			// The approval request carries the tool's FULL input — fill the tool card
			// from it (in ask mode the streamed input may not have reached the card),
			// creating the card if the assistant stream hasn't shown it yet.
			// ExitPlanMode renders as an actionable plan card (below) — skip the
			// redundant tool card so the plan isn't shown twice during approval.
			const tid = str(r.tool_name) === 'ExitPlanMode' ? '' : str(r.tool_use_id);
			if (tid) {
				const input = rec(r.input) ?? {};
				const name = mapToolName(str(r.tool_name));
				const known = tools.get(tid);
				tools.set(tid, { claudeName: str(r.tool_name), name, input });
				if (!known) events.push({ type: 'tool_start', call_id: tid, name });
				events.push({ type: 'tool_update', call_id: tid, output: toolCardJson(str(r.tool_name), input) });
			}
			const callId = `approval-${++approvalSeq}`;
			approvals.set(callId, { requestId: str(frame.request_id), request: r });
			events.push({
				type: 'approval_request',
				call_id: callId,
				name: mapToolName(str(r.tool_name)),
				summary: approvalSummary(r),
				subagent_id: null,
				hunks: claudeEditHunks(str(r.tool_name), rec(r.input) ?? {})
			});
			return events;
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
				const events: NormalizedEvent[] = [];
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
						events.push(modelStatus());
					}
				}
				// tag 'boot' = the yolo bootstrap (no set_permission_mode ack to ride
				// on): this ack is the readiness signal.
				if (tag === 'boot') {
					lastEngineMode = 'bypassPermissions';
					events.push(
						{ type: 'approval_mode', mode: 'full-auto' },
						commandList([]),
						{ type: 'status', message: 'ready' }
					);
				}
				return events;
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
			// turn — verified live). bypassPermissions can't be set live (it's
			// rejected unless launched with --dangerously-skip-permissions, which the
			// spawn already did), so skip that control request and take readiness from
			// the list_models ack instead (tagged 'boot').
			const claudeMode = toClaudeMode(mode);
			if (claudeMode === 'bypassPermissions') {
				send(controlRequest({ subtype: 'list_models' }, 'boot'));
			} else {
				send(controlRequest({ subtype: 'set_permission_mode', mode: claudeMode }));
				send(controlRequest({ subtype: 'list_models' }));
			}
		},
		translate(raw: unknown): NormalizedEvent[] {
			if (isStderrPayload(raw)) {
				// Strip ANSI, drop tracing-formatted log lines (`2026-…Z ERROR …`) —
				// routine engine noise that would otherwise spam the transcript.
				// eslint-disable-next-line no-control-regex
				const line = raw.__stderr.replace(/\[[0-9;]*m/g, '').trim();
				if (!line) return [];
				// Drop routine tracing noise but keep ERROR/WARN — they carry the real
				// reason when a turn fails (e.g. an error_during_execution result).
				if (/^\d{4}-\d{2}-\d{2}T\S+\s+(INFO|DEBUG|TRACE)\b/.test(line)) return [];
				// A --resume target the CLI can't find (session file gone / never
				// persisted) makes it exit immediately. Signal it so the store stops
				// re-resuming the same doomed id in an endless crash-restart loop
				// (the bootstrap 'ready' otherwise keeps resetting the restart budget).
				if (/No conversation found with session ID/i.test(line)) return [{ type: 'resume_failed' }];
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
						const sub = str(msg.subtype);
						if (sub === 'init') return onInit(msg as unknown as SystemInitFrame);
						if (sub === 'status') return onStatus(msg as unknown as SystemStatusFrame);
						if (sub === 'compact_boundary') return [{ type: 'compaction_end' }];
						// A tool blocked by a permission rule — otherwise the user just
						// sees nothing happen.
						if (sub === 'permission_denied') {
							const reason = str(msg.reason);
							return [{ type: 'info', message: `[claude] ${mapToolName(str(msg.tool_name))} denied${reason ? `: ${reason}` : ''}` }];
						}
						// Persisted artifacts / files the run produced.
						if (sub === 'files_persisted') {
							const names = (Array.isArray(msg.files) ? msg.files : [])
								.map((f) => str(rec(f)?.filename) || str(rec(f)?.fileId))
								.filter(Boolean);
							return names.length ? [{ type: 'info', message: `[claude] saved: ${names.join(', ')}` }] : [];
						}
						// A failed hook (SessionStart/PreTool/…): surface stderr so a broken
						// hook isn't invisible. Successful hooks stay silent.
						if (sub === 'hook_response' && typeof msg.exit_code === 'number' && msg.exit_code !== 0) {
							const detail = str(msg.stderr) || str(msg.output) || `exit ${msg.exit_code}`;
							return [{ type: 'info', message: `[claude] hook ${str(msg.hook_name)} failed: ${detail}` }];
						}
						if (sub === 'mirror_error') return [errorEvent(str(msg.error) || 'workspace mirror error')];
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
						// Rate-limit notices are otherwise a silent black hole. Surface
						// them as a persistent banner (rate_limit event) so the quota state
						// stays visible, degrading gracefully across CLI shape variants.
						if (msg.type === 'rate_limit_event') return rateLimitEvents(msg);
						return []; // tool_progress, tool_use_summary, auth_status — silent
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
					const input = rec(entry.request.input) ?? {};
					// AskUserQuestion: inject the user's picks as updatedInput.answers
					// (keyed by full question text) — the CLI feeds this back to the model
					// as the tool result (without it the tool is "not enabled").
					let updatedInput: Record<string, unknown> = input;
					if (op.answers && str(entry.request.tool_name) === 'AskUserQuestion') {
						updatedInput = { questions: input.questions, answers: op.answers };
					} else if (op.hunks && str(entry.request.tool_name) === 'MultiEdit' && Array.isArray(input.edits)) {
						// Per-hunk approval of a MultiEdit: keep only the selected edits
						// (hunk id `e${index}`) so the CLI applies just those replacements.
						const keep = new Set(op.hunks);
						updatedInput = { ...input, edits: input.edits.filter((_, i) => keep.has(`e${i}`)) };
					}
					const result: PermissionResult =
						op.decision === 'deny'
							? { behavior: 'deny', message: 'The user denied this tool use.' }
							: {
									behavior: 'allow',
									updatedInput,
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
