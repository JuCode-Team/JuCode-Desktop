// Engine-adapter contract: one adapter instance per live session translates
// between the desktop's native (jucode-dialect) protocol and the backend
// CLI's own wire format. See src/lib/backends/README.md for the full contract
// (ordering guarantees, approval bridging, how onStart is invoked).

import type { Op, AgentEvent } from '$lib/protocol';

export type BackendId = 'jucode' | 'codex' | 'claude';

export const BACKEND_IDS: BackendId[] = ['jucode', 'codex', 'claude'];

/** Display names (brand names — not localized). */
export const BACKEND_LABELS: Record<BackendId, string> = {
	jucode: 'JuCode',
	codex: 'Codex',
	claude: 'Claude Code'
};

export function isBackendId(v: unknown): v is BackendId {
	return v === 'jucode' || v === 'codex' || v === 'claude';
}

/** Restore path: unknown / missing backend ids collapse to 'jucode'. */
export function normalizeBackendId(v: unknown): BackendId {
	return isBackendId(v) ? v : 'jucode';
}

/**
 * What a backend can do, from the desktop UI's point of view. Every flag gates
 * one or more UI surfaces (see `caps()` in ./index.ts and the README's
 * capability map); adapters declare a conservative subset and widen it as
 * their translation grows.
 */
export interface BackendCaps {
	/** Engine-enforced auto-approval policy (set_approval_mode / approval_mode). */
	approvalModes: boolean;
	/** Backend exposes claude's extra approval modes ('plan' + 'auto') in the
	 *  picker, on top of the shared ask/edits/all trio. */
	extendedApprovalModes: boolean;
	/** Per-hunk partial approval of edit tools (approve op with `hunks`). */
	hunkApproval: boolean;
	/** Queue-jumping a busy turn (steer op + queued-messages strip). */
	steer: boolean;
	/** Interrupting a running turn. */
	interrupt: boolean;
	/** Conversation branch tree (/tree, tree_view picker). */
	branchTree: boolean;
	/** Goal / plan tracking (goal + plan events, right-dock tabs). */
	goals: boolean;
	/** Skills marketplace (/skills install …). */
	skills: boolean;
	/** MCP server management ops (mcp_list / mcp_set / …). */
	mcpManage: boolean;
	/** Checkpoints / rewind (/rewind, checkpoint_view). */
	checkpoints: boolean;
	/** Context-usage reporting (context_usage events → context ring). */
	contextUsage: boolean;
	/** Manual context compaction (/compact palette entry + compaction events). */
	compact: boolean;
	/** In-chat model picker (/model, model_view) + provider switching. */
	modelPicker: boolean;
	/** Resuming persisted conversations (/resume, resume_view). */
	resume: boolean;
	/** Subagent lifecycle reporting. */
	subagents: boolean;
	/** Full transcript replay on resume (transcript events). */
	transcriptReplay: boolean;
	/** Generic slash-command support (/compact, /stats, custom commands…). */
	slashCommands: boolean;
}

/** Normalized events are the existing jucode AgentEvent dialect — adapters
 *  emit that dialect so ChatState stays untouched. */
export type NormalizedEvent = AgentEvent;

/** Raw stderr line forwarded by the Rust side for piped-stderr backends. */
export interface StderrPayload {
	__stderr: string;
}

export function isStderrPayload(raw: unknown): raw is StderrPayload {
	return (
		typeof raw === 'object' &&
		raw !== null &&
		typeof (raw as Record<string, unknown>).__stderr === 'string'
	);
}

/** Outbound channel handed to an adapter: writes one raw line (= one frame)
 *  to the session child's stdin. */
export interface AdapterIO {
	sendLine(line: string): void;
}

/** Session context available when the child starts. */
export interface SessionCtx {
	/** Project working directory the child was spawned in. */
	cwd: string;
	/** Preferred model, when the desktop knows one. */
	model?: string;
	/** The desktop's persisted approval mode ('ask' | 'edits' | 'all'). */
	approvalMode: string;
	/** The DESKTOP session id (the id used for send_line routing) — not the
	 *  engine's own conversation id. */
	sessionId: string;
	/** Engine conversation id to resume instead of starting fresh, for backends
	 *  whose resume is a protocol call rather than a spawn flag (codex
	 *  `thread/resume`). Set on crash auto-restart and saved-tab restore. */
	resume?: string;
}

/**
 * One adapter instance per session (adapters may be stateful: request-id
 * counters, pending-approval registries…). Create via `createAdapter()`.
 */
export interface EngineAdapter {
	readonly id: BackendId;
	readonly caps: BackendCaps;
	/** Called once each time the child process starts (initial spawn AND every
	 *  restart); may send handshake frames and reset per-process state. */
	onStart(io: AdapterIO, ctx: SessionCtx): void;
	/** One raw stdout line (parsed JSON, or a {__stderr} payload) → zero or
	 *  more normalized jucode-style AgentEvents, in order. */
	translate(raw: unknown): NormalizedEvent[];
	/** Outgoing desktop Op → raw stdin lines (one frame each). Return null when
	 *  the op is unsupported — the caller surfaces a notice to the user. */
	encodeOp(op: Op): string[] | null;
}
