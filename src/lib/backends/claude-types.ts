// Trimmed wire types for the Claude Code CLI stream-json protocol
// (`claude --print --input-format stream-json --output-format stream-json
//   --include-partial-messages --verbose --replay-user-messages
//   --permission-prompt-tool stdio`).
//
// Provenance: every shape below was captured live from claude 2.1.208
// (stdout probes over stdio; see claude.test.ts for condensed recordings).
// Only the subset the adapter reads/writes is kept — re-probe when bumping
// the supported Claude Code version.

// --- message content blocks (Anthropic API dialect) ---------------------------

export interface TextBlock {
	type: 'text';
	text: string;
}

export interface ThinkingBlock {
	type: 'thinking';
	thinking: string;
	signature?: string;
}

export interface ToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultBlock {
	type: 'tool_result';
	tool_use_id: string;
	/** String, or an array of {type:'text',text}/{type:'image',…} blocks. */
	content?: unknown;
	is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface ApiUsage {
	input_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	output_tokens?: number;
}

// --- stdout frames -------------------------------------------------------------

/** First frame of every turn (re-emitted per turn, same session_id). */
export interface SystemInitFrame {
	type: 'system';
	subtype: 'init';
	cwd: string;
	session_id: string;
	tools: string[];
	model: string;
	permissionMode: string;
	slash_commands: string[];
	claude_code_version: string;
	apiKeySource: string;
}

/** Turn-lifecycle status ("requesting" while an API call is in flight,
 *  "compacting" while a /compact runs), permission-mode change announcements
 *  (`permissionMode`, status null) and compaction outcomes (`compact_result`,
 *  status null — verified live: "success"). */
export interface SystemStatusFrame {
	type: 'system';
	subtype: 'status';
	status: string | null;
	permissionMode?: string;
	compact_result?: string;
}

/** End of a compaction (manual `/compact` or auto). Verified live 2.1.208:
 *  compact_metadata.trigger is 'manual' | 'auto'. */
export interface CompactBoundaryFrame {
	type: 'system';
	subtype: 'compact_boundary';
	compact_metadata?: { trigger?: string; pre_tokens?: number; post_tokens?: number };
}

/** Raw Anthropic streaming event, wrapped (with --include-partial-messages). */
export interface StreamEventFrame {
	type: 'stream_event';
	event: {
		type: string; // message_start | content_block_start | content_block_delta | content_block_stop | message_delta | message_stop
		index?: number;
		message?: { id: string; model: string; usage?: ApiUsage };
		content_block?: ContentBlock;
		delta?: {
			type?: string; // text_delta | thinking_delta | input_json_delta | signature_delta
			text?: string;
			thinking?: string;
			partial_json?: string;
			stop_reason?: string | null;
		};
		usage?: ApiUsage; // message_delta
	};
	session_id: string;
	/** Non-null on frames that belong to a Task subagent's inner stream. */
	parent_tool_use_id: string | null;
}

/** Completed content blocks, one frame per block while streaming. */
export interface AssistantFrame {
	type: 'assistant';
	message: { id: string; model: string; content: ContentBlock[]; usage?: ApiUsage };
	session_id: string;
	parent_tool_use_id: string | null;
}

/** Echoed stdin messages (`isReplay: true`), tool results, and synthetic
 *  notices ("[Request interrupted by user]"). */
export interface UserFrame {
	type: 'user';
	message: { role: 'user'; content: ContentBlock[] | string };
	session_id?: string;
	parent_tool_use_id?: string | null;
	isReplay?: boolean;
	/** Structured tool result (e.g. {stdout,stderr,…} for Bash), or a string. */
	tool_use_result?: unknown;
}

/** End of a turn. subtype 'success' | 'error_during_execution' | 'error_max_turns' | … */
export interface ResultFrame {
	type: 'result';
	subtype: string;
	is_error: boolean;
	result?: string;
	session_id: string;
	num_turns: number;
	total_cost_usd?: number;
	usage?: ApiUsage;
	modelUsage?: Record<string, { contextWindow?: number; inputTokens?: number; outputTokens?: number }>;
	permission_denials?: unknown[];
}

// --- control protocol ----------------------------------------------------------

/** One suggestion offered with a can_use_tool request (verified live: addRules /
 *  addDirectories / setMode). Echoed back inside `updatedPermissions`. */
export interface PermissionUpdate {
	type: string; // 'addRules' | 'addDirectories' | 'setMode' | …
	rules?: { toolName: string; ruleContent?: string }[];
	behavior?: 'allow' | 'deny';
	mode?: string;
	directories?: string[];
	destination?: string; // 'session' | 'localSettings' | 'projectSettings' | 'userSettings'
}

/** CLI → client: permission prompt (only with --permission-prompt-tool stdio). */
export interface CanUseToolRequest {
	subtype: 'can_use_tool';
	tool_name: string;
	display_name?: string;
	input: Record<string, unknown>;
	description?: string;
	permission_suggestions?: PermissionUpdate[];
	blocked_path?: string;
	tool_use_id: string;
}

export interface ControlRequestFrame {
	type: 'control_request';
	request_id: string;
	request: { subtype: string } & Record<string, unknown>;
}

/** Client → CLI answer to can_use_tool. */
export type PermissionResult =
	| { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
	| { behavior: 'deny'; message: string };

export interface ControlResponseFrame {
	type: 'control_response';
	response:
		| { subtype: 'success'; request_id: string; response?: Record<string, unknown> }
		| { subtype: 'error'; request_id: string; error: string };
}

/** One row of the CLI's model catalog (control_request subtype `list_models`,
 *  verified live against 2.1.208). `value` is what `set_model` accepts (alias
 *  or full id, e.g. "sonnet", "opus[1m]", "claude-fable-5[1m]");
 *  `resolvedModel` is the concrete model id it maps to (matches the `model`
 *  field of system/init and the modelUsage keys of result frames). */
export interface ClaudeModelInfo {
	value: string;
	resolvedModel?: string;
	displayName?: string;
	description?: string;
	/** Present when the model supports reasoning-effort levels. Effort IS wired for
	 *  claude — there's no set-effort control request, so the adapter sends the
	 *  `/effort <level>` slash command as user text instead (see CLAUDE_EFFORT_LEVELS
	 *  and encodeOp's /model handler). This per-model list is not consumed yet; the
	 *  slider uses the shared CLAUDE_EFFORT_LEVELS. */
	supportedEffortLevels?: string[];
}
