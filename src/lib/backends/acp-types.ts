// Wire types for the Agent Client Protocol (ACP) v1, JSON-RPC 2.0 over stdio
// lines — the subset the desktop's client-side adapter actually touches.
// Hand-written (like codex-types.ts) so the webview bundle stays free of the
// official SDK; shapes follow https://agentclientprotocol.com/protocol/schema.

export type RequestId = number | string;

export interface JsonRpcErrorShape {
	code: number;
	message: string;
	data?: unknown;
}

// --- initialize ------------------------------------------------------------

export interface AcpPromptCapabilities {
	image?: boolean;
	audio?: boolean;
	embeddedContext?: boolean;
}

export interface AcpAgentCapabilities {
	loadSession?: boolean;
	promptCapabilities?: AcpPromptCapabilities;
}

export interface InitializeResponse {
	protocolVersion?: number;
	agentCapabilities?: AcpAgentCapabilities;
	authMethods?: { id?: string; name?: string; description?: string }[];
}

// --- session/new -----------------------------------------------------------

export interface AcpModelInfo {
	modelId?: string;
	name?: string;
	description?: string;
}

export interface NewSessionResponse {
	sessionId?: string;
	/** Optional session-mode state (agent-defined mode ids). */
	modes?: {
		currentModeId?: string;
		availableModes?: { id?: string; name?: string }[];
	};
	/** Optional model state (newer spec revisions). */
	models?: {
		currentModelId?: string;
		availableModels?: AcpModelInfo[];
	};
}

// --- content blocks ---------------------------------------------------------

export interface AcpContentBlock {
	type?: string; // text | image | audio | resource_link | resource
	text?: string;
	data?: string;
	mimeType?: string;
	uri?: string;
	resource?: { uri?: string; text?: string };
}

// --- session/update ---------------------------------------------------------

export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AcpToolCallContent {
	type?: string; // content | diff | terminal
	content?: AcpContentBlock;
	path?: string;
	oldText?: string | null;
	newText?: string;
	terminalId?: string;
}

export interface AcpToolCallLocation {
	path?: string;
	line?: number;
}

export interface AcpSessionUpdate {
	sessionUpdate?: string;
	// *_message_chunk / agent_thought_chunk
	content?: AcpContentBlock;
	// tool_call / tool_call_update
	toolCallId?: string;
	title?: string;
	kind?: string; // read|edit|delete|move|search|execute|think|fetch|switch_mode|other
	status?: AcpToolCallStatus;
	locations?: AcpToolCallLocation[];
	rawInput?: unknown;
	rawOutput?: unknown;
	// tool content items ride a different field name than message chunks
	// (both are called `content` in the spec; tool calls carry an array).
	// plan
	entries?: { content?: string; priority?: string; status?: string }[];
	// available_commands_update
	availableCommands?: { name?: string; description?: string }[];
	// current_mode_update
	currentModeId?: string;
}

export interface SessionUpdateParams {
	sessionId?: string;
	update?: AcpSessionUpdate & { content?: AcpContentBlock | AcpToolCallContent[] };
}

// --- session/prompt ----------------------------------------------------------

export type AcpStopReason =
	| 'end_turn'
	| 'max_tokens'
	| 'max_turn_requests'
	| 'refusal'
	| 'cancelled';

export interface PromptResponse {
	stopReason?: AcpStopReason | string;
}

// --- session/request_permission ----------------------------------------------

export interface AcpPermissionOption {
	optionId?: string;
	name?: string;
	kind?: string; // allow_once | allow_always | reject_once | reject_always
}

export interface RequestPermissionParams {
	sessionId?: string;
	toolCall?: {
		toolCallId?: string;
		title?: string;
		kind?: string;
		status?: string;
		content?: AcpToolCallContent[];
		locations?: AcpToolCallLocation[];
	};
	options?: AcpPermissionOption[];
}
