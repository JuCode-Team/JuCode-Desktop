// Trimmed wire types for the OpenAI Codex CLI app-server protocol (v2 surface).
//
// Provenance: hand-copied (and pruned to the fields this adapter reads/writes)
// from the TypeScript bindings exported by codex-cli 0.144.3
// (`codex_app_server_protocol` ts-rs output). The envelope is JSON-RPC 2.0 over
// stdio lines; the server omits the `jsonrpc` field on its own frames but
// accepts it on ours. Method names verified live against `codex app-server`
// 0.144.3 (initialize → initialized → thread/start → turn/start …).
//
// Only the subset the adapter needs is kept — resync with the upstream
// bindings when bumping the supported codex version.

// --- envelope ---------------------------------------------------------------

export type RequestId = number | string;

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: RequestId;
	method: string;
	params?: unknown;
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: unknown;
}

export interface JsonRpcErrorShape {
	code: number;
	message: string;
	data?: unknown;
}

// --- initialize -------------------------------------------------------------

export interface ClientInfo {
	name: string;
	title: string | null;
	version: string;
}

export interface InitializeParams {
	clientInfo: ClientInfo;
	capabilities: null;
}

export interface InitializeResponse {
	userAgent: string;
	codexHome: string;
	platformFamily: string;
	platformOs: string;
}

// --- thread / turn ----------------------------------------------------------

/** Pruned: full type also carries granular rule objects we never send. */
export type AskForApproval = 'untrusted' | 'on-request' | 'never';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type SandboxPolicy =
	| { type: 'dangerFullAccess' }
	| { type: 'readOnly'; networkAccess: boolean }
	| {
			type: 'workspaceWrite';
			writableRoots: string[];
			networkAccess: boolean;
			excludeTmpdirEnvVar: boolean;
			excludeSlashTmp: boolean;
	  };

export interface ThreadStartParams {
	cwd?: string | null;
	model?: string | null;
	approvalPolicy?: AskForApproval | null;
	sandbox?: SandboxMode | null;
}

export interface ThreadStartResponse {
	thread: {
		id: string;
		/** Populated on thread/resume responses only: full per-turn item history. */
		turns?: Turn[];
	};
	model: string;
	modelProvider: string;
	cwd: string;
	approvalPolicy: AskForApproval;
	reasoningEffort: string | null;
}

/** thread/resume: same response shape as thread/start, but `thread.turns` is
 *  populated with the persisted history (verified live, codex-cli 0.144.3). */
export interface ThreadResumeParams {
	threadId: string;
	cwd?: string | null;
	model?: string | null;
	approvalPolicy?: AskForApproval | null;
	sandbox?: SandboxMode | null;
}

export type UserInput =
	| { type: 'text'; text: string; text_elements: unknown[] }
	| { type: 'localImage'; path: string };

export interface TurnStartParams {
	threadId: string;
	input: UserInput[];
	approvalPolicy?: AskForApproval | null;
	sandboxPolicy?: SandboxPolicy | null;
	/** "Override the model for this turn and subsequent turns." */
	model?: string | null;
	/** "Override the reasoning effort for this turn and subsequent turns." */
	effort?: string | null;
}

export interface TurnError {
	message: string;
	codexErrorInfo?: unknown;
	additionalDetails?: string | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface Turn {
	id: string;
	status: TurnStatus;
	error: TurnError | null;
	/** Populated inside thread/resume responses (transcript replay). */
	items?: ThreadItem[];
}

export interface TurnInterruptParams {
	threadId: string;
	turnId: string;
}

// --- thread items (pruned to the variants we render) -------------------------

export interface FileUpdateChange {
	path: string;
	kind: { type: 'add' | 'delete' | 'update'; move_path?: string | null };
	diff: string;
}

/** Item lifecycle statuses share this shape across commandExecution/fileChange. */
export type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export type ThreadItem =
	| { type: 'agentMessage'; id: string; text: string }
	| { type: 'reasoning'; id: string; summary: string[]; content: string[] }
	| { type: 'userMessage'; id: string; content: UserInput[] }
	| {
			type: 'commandExecution';
			id: string;
			command: string;
			cwd: string;
			status: ItemStatus;
			aggregatedOutput: string | null;
			exitCode: number | null;
	  }
	| { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: ItemStatus }
	| {
			type: 'mcpToolCall';
			id: string;
			server: string;
			tool: string;
			status: string;
			result: { content: unknown[]; structuredContent: unknown } | null;
			error: { message?: string } | null;
	  }
	| {
			type: 'dynamicToolCall';
			id: string;
			tool: string;
			status: string;
			contentItems: unknown[] | null;
			success: boolean | null;
	  }
	| { type: 'webSearch'; id: string; query: string }
	// A manual thread/compact/start runs as its own turn wrapping exactly one of
	// these items (verified live; the deprecated thread/compacted notification is
	// NOT emitted by 0.144.x).
	| { type: 'contextCompaction'; id: string }
	// Variants we don't render (plan, sleep, imageView, …) deliberately collapse
	// to this shape; the adapter's switch ignores them.
	| { type: 'other'; id?: string };

// --- notifications ----------------------------------------------------------

export interface ItemNotification {
	item: ThreadItem;
	threadId: string;
	turnId: string;
}

export interface DeltaNotification {
	threadId: string;
	turnId: string;
	itemId: string;
	delta: string;
}

export interface TokenUsageBreakdown {
	totalTokens: number;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
}

export interface ThreadTokenUsageParams {
	threadId: string;
	turnId: string;
	tokenUsage: {
		total: TokenUsageBreakdown;
		last: TokenUsageBreakdown;
		modelContextWindow: number | null;
	};
}

export interface ErrorNotificationParams {
	error: TurnError;
	willRetry: boolean;
	threadId: string;
	turnId: string;
}

export interface TurnPlanStep {
	step: string;
	status: 'pending' | 'inProgress' | 'completed';
}

// --- server → client approval requests --------------------------------------

export interface CommandExecutionRequestApprovalParams {
	threadId: string;
	turnId: string;
	itemId: string;
	reason?: string | null;
	command?: string | null;
	cwd?: string | null;
}

export interface FileChangeRequestApprovalParams {
	threadId: string;
	turnId: string;
	itemId: string;
	reason?: string | null;
	grantRoot?: string | null;
}

/** Pruned: full type also has execpolicy/network-amendment object variants. */
export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

// --- model catalog (model/list) ----------------------------------------------

export interface ReasoningEffortOption {
	reasoningEffort: string; // 'low' | 'medium' | 'high' | 'xhigh' | …
	description: string;
}

/** Pruned: full type also carries upgrade/nux/service-tier metadata. */
export interface CodexModel {
	id: string;
	model: string;
	displayName: string;
	description: string;
	hidden: boolean;
	supportedReasoningEfforts: ReasoningEffortOption[];
	defaultReasoningEffort: string;
	isDefault: boolean;
}

export interface ModelListResponse {
	data: CodexModel[];
	nextCursor: string | null;
}

// --- persisted threads (thread/list) ------------------------------------------

/** Pruned: full Thread also carries source/git/status metadata. */
export interface ThreadSummary {
	id: string;
	/** Usually the first user message, if available. */
	preview: string;
	/** Optional user-facing title. */
	name: string | null;
	/** Unix seconds. */
	updatedAt: number;
	cwd: string;
}

export interface ThreadListParams {
	cursor?: string | null;
	limit?: number | null;
	/** Exact-match cwd filter(s). */
	cwd?: string | string[] | null;
}

export interface ThreadListResponse {
	data: ThreadSummary[];
	nextCursor: string | null;
}

// --- goals (thread/goal/*) ----------------------------------------------------

export type ThreadGoalStatus =
	| 'active'
	| 'paused'
	| 'blocked'
	| 'usageLimited'
	| 'budgetLimited'
	| 'complete';

export interface ThreadGoal {
	threadId: string;
	objective: string;
	status: ThreadGoalStatus;
	tokenBudget: number | null;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
}

export interface ThreadGoalUpdatedParams {
	threadId: string;
	turnId: string | null;
	goal: ThreadGoal;
}
