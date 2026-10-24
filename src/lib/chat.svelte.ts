import type { AgentEvent, SessionOption, SessionToolProvider } from './protocol';
import { loadProfile, profileKey, rememberProfile, type BackendProfile } from '$lib/backendProfile';
import { isBackendId, type BackendCaps, type BackendId } from './backends/types';
import {
	EDIT_TOOLS,
	fromEngineMode,
	parseHunks,
	parseQuestions,
	reconcileMode,
	toEngineMode,
	type AlwaysScope,
	type ApprovalHunk,
	type ApprovalMode,
	type EngineApprovalMode,
	type Question
} from './approval';
import { t } from './i18n';
import { runState } from './agentTrace';
import { costUsd } from './pricing';
import { pendingCost, sumCosts, type BillingCost } from './sessionCost';
import { CacheWatch } from './cacheMiss';
import { editedPaths, isEdit, parseToolOutput } from './toolSummary';
import { parseMcpServersEvent, type McpServerView } from './mcp';

/** Where a sent message is before its reply starts: accepted locally, the
 *  engine is connecting to the model gateway, connected and waiting for the
 *  first token, or the turn failed first. Unset once the reply streams. */
export type SendState = 'sending' | 'connecting' | 'waiting' | 'failed';

/** One user turn's totals, stamped on its last assistant message. */
export interface TurnStats {
	elapsed: number;
	/** Time to the first streamed output, ms. */
	ttft?: number;
	/** Time output was streaming, summed over the turn's requests (no waits, no tools), ms. */
	genMs?: number;
	inTokens: number;
	outTokens: number;
	tools: number;
	cost: number;
	billingTurns?: string[];
	billing?: BillingCost;
	model: string;
	/** Reply segments (assistant messages split by tool calls) in the turn. */
	segments: number;
	/** The user stopped the turn. */
	stopped?: boolean;
}

/** A message sent while a reply runs that does not wait for the turn: it
 *  joins the reply (`steer`), or stops it and goes now (`interrupt`). */
export type SendNow = 'steer' | 'interrupt';

/** A plan usage limit the engine reported. `window`: which one (`five_hour`,
 *  `seven_day`, `seven_day_opus`, `overage`…; empty if not said); `used`: its
 *  percent used; `overage`: paid usage past the plan is in use. */
export interface UsageLimit {
	level: 'warning' | 'limited';
	message: string;
	resetsAt: number | null;
	window: string;
	used: number | null;
	overage: boolean;
}

/** The model request in flight, for the live timer: which stage it is in and
 *  when that stage began. `connect`: request sent, no response yet; `ttft`:
 *  connected, waiting for the first token; `output`: tokens streaming. */
export interface CallTiming {
	phase: 'connect' | 'ttft' | 'output';
	since: number;
}

export type Msg =
	/** `at`: when it was sent, ms (absent: not known, e.g. an old transcript). */
	| { kind: 'user'; text: string; state?: SendState; images?: string[]; files?: string[]; at?: number }
	| {
			kind: 'assistant';
			text: string;
			tokens?: number;
			elapsed?: number;
			/** This segment's own time: from the request that produced it until
			 *  its tool call or the end of the turn, ms. */
			segMs?: number;
			uuid?: string;
			turn?: TurnStats;
			/** When it was written, ms. */
			at?: number;
	  }
	| { kind: 'reasoning'; text: string; collapsed: boolean }
	| {
			kind: 'tool';
			callId: string;
			name: string;
			output: string;
			running: boolean;
			isError: boolean;
			/** The Task subagent that made this call (claude). */
			subagent?: string;
			/** A subagent call's arguments as the engine showed them before its
			 *  output replaced them (the agent's name and task). */
			args?: string;
			/** When the call started and returned, ms; absent on calls replayed
			 *  from a transcript. */
			startedAt?: number;
			endedAt?: number;
	  }
	| { kind: 'system'; text: string }
	| { kind: 'error'; text: string }
	/** A plan the engine proposes in plan mode (`proposed_plan`): `text` is
	 *  its Markdown; status pending / approved / revising. */
	| { kind: 'plan'; id: string; title: string; text: string; status: string };

export interface TreeNode {
	id: string;
	parent_id: string | null;
	label: string;
	active: boolean;
}
export interface ModelOption {
	/** The id submitted to switch models (an alias like "opus[1m]" for claude). */
	model: string;
	/** Human-facing concrete model to display when it differs from `model`
	 *  (e.g. claude's resolvedModel "claude-opus-4-8" behind the alias "opus"). */
	label?: string;
	/** Original model id for vendor-icon matching, when `label` is a compact
	 *  name that no longer contains the vendor keyword (e.g. "Opus 4.8"). */
	vendor?: string;
	active: boolean;
	context_window: number;
	max_output_tokens: number;
	reasoning_efforts: string[];
	/** false: not in the engine's catalog, only marking what runs. */
	listed?: boolean;
}
export interface ResumeItem {
	id: string;
	label: string;
	detail: string;
	active: boolean;
}
export type Picker =
	| { kind: 'tree'; nodes: TreeNode[] }
	| { kind: 'model'; models: ModelOption[]; activeEffort: string }
	// `backend`: whose conversations the items are, when not this chat's own
	// (the project history lists JuCode conversations in any chat).
	| {
			kind: 'resume';
			items: ResumeItem[];
			backend?: BackendId;
			/** The project's history picker (source tabs), not an engine's /resume. */
			history?: boolean;
			/** Whose saved conversations are listed; claude / codex ones import. */
			source?: 'jucode' | 'claude' | 'codex';
	  }
	| { kind: 'checkpoint'; items: ResumeItem[] }
	| null;

export interface Goal {
	objective: string;
	status: string;
	token_budget: number | null;
	tokens_used: number;
	time_used_seconds: number;
}
export interface CommandItem {
	command: string;
	marker: string | null;
	args?: string;
	description?: string;
}
export interface PlanStep {
	step: string;
	status: string;
}

/** Mode names as a client sends them to the daemon (see backends/jucode.ts). */
const PENDING_MODES: Record<string, ApprovalMode> = { manual: 'ask', 'auto-edit': 'edits', auto: 'auto', 'full-access': 'all', plan: 'plan' };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** A claude task type (`local_workflow`, `local_bash`, …) as the user says it. */
export function taskKindLabel(kind: string): string {
	const known = ['local_workflow', 'local_bash', 'local_agent', 'monitor'];
	const key = known.find((k) => kind === k || kind.startsWith(k)) ?? 'other';
	return t(`chat.taskKind.${key}`);
}

function fallbackReason(reason: string): string {
	const known = ['overloaded', 'server_error', 'model_not_found', 'permission_denied', 'refusal'];
	return t(`chat.fallbackReason.${known.includes(reason) ? reason : 'other'}`);
}

/** A subagent as its lifecycle events (and, on an older JuCode engine, its
 *  spawn_agent call) report it: by path / task id. */
export interface SubagentInfo {
	status: string;
	message: string;
	label?: string;
	model?: string;
	/** The call that started it (spawn_agent / Agent). */
	toolUseId?: string;
	/** When this client first saw it, and saw it end (ms). */
	startedAt?: number;
	endedAt?: number;
}

/** The lifecycle words of an agent that has stopped for good. */
const FINAL_AGENT = ['completed', 'done', 'failed', 'errored', 'stopped', 'interrupted', 'closed', 'killed', 'cancelled'];

/** Calls that start a subagent: their arguments name it. */
const SUBAGENT_CALLS = new Set(['spawn_agent', 'Task', 'Agent']);
/** Engines whose daemon reports that the model answered (`thinking_start`):
 *  their requests show "connecting" until then. Claude joins once a daemon
 *  that reports it is seen (an older one still running never does). */
const ANSWER_REPORTED = new Set<BackendId>(['jucode']);
/** Engines that announce only a turn's first request; the next one starts
 *  when its tools are back. */
const FIRST_REQUEST_ONLY = new Set<BackendId>(['codex', 'acp']);

/** A proposed plan's status as the engine words it. */
const PLAN_STATUS = ['pending', 'approved', 'revising'];
const planStatus = (v: unknown) => (typeof v === 'string' && PLAN_STATUS.includes(v) ? v : 'pending');

/** One agent of a Workflow, or a Task subagent (claude's agent trace). */
export interface AgentRun {
	id: string;
	label: string;
	/** Workflow agents: their phase index. */
	phase: number;
	model: string;
	/** running / done / completed / failed / stopped / queued … as the engine says. */
	state: string;
	startedAt: number;
	durationMs: number;
	tokens: number;
	toolCalls: number;
	prompt: string;
	result: string;
	error: string;
	/** Task subagents: the subagent type and the Agent call that started it. */
	type: string;
	toolUseId: string;
	/** Its latest action in one line (jucode), and its reasoning effort. */
	activity: string;
	effort: string;
}
export interface WorkflowRun {
	id: string;
	toolUseId: string;
	name: string;
	description: string;
	status: string;
	startedAt: number;
	durationMs: number;
	tokens: number;
	toolCalls: number;
	phases: { index: number; title: string }[];
	agents: AgentRun[];
}

function agentRun(raw: Record<string, unknown>): AgentRun {
	const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
	const state = str(raw.state) || str(raw.status);
	const startedAt = n(raw.started_at);
	return {
		id: str(raw.id),
		label: str(raw.label),
		phase: n(raw.phase),
		model: str(raw.model),
		// A Workflow agent is `start` from when it is queued; it has begun once it has a start time.
		state: state === 'start' && !startedAt ? 'queued' : state,
		startedAt,
		durationMs: n(raw.duration_ms),
		tokens: n(raw.tokens),
		toolCalls: n(raw.tool_calls),
		prompt: str(raw.prompt),
		result: str(raw.result) || str(raw.summary),
		error: str(raw.error),
		type: str(raw.type),
		toolUseId: str(raw.tool_use_id),
		activity: str(raw.activity),
		effort: str(raw.effort)
	};
}

/** Reactive chat state projected from the engine's AgentEvent stream. */
/** A failed model request being re-sent: attempt `attempt` of `max`, after
 *  `delayMs` from `at` (ms), because of `reason` (the provider's error). */
/** What an automatic retry sends when the failed turn is kept (autoRetry.ts).
 *  Recognised again in a reloaded transcript, where it shows as a note. */
/** What a tool card keeps of an output in memory: a long one (a build log,
 *  a big file read) keeps its head and tail. Structured (JSON) outputs are
 *  kept whole when they fit, else their string fields are cut the same way,
 *  so a card still parses them. The engine's session keeps the full output. */
const TOOL_OUTPUT_MAX = 64 * 1024;
export function boundedOutput(output: string): string {
	if (output.length <= TOOL_OUTPUT_MAX) return output;
	const cut = (text: string, max: number) =>
		text.length <= max ? text : `${text.slice(0, max / 2)}\n… (${text.length - max} characters not shown) …\n${text.slice(-max / 2)}`;
	try {
		const value = JSON.parse(output) as unknown;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const out: Record<string, unknown> = {};
			// An image's pixels are kept whole (cut, they would not decode).
			for (const [k, v] of Object.entries(value as Record<string, unknown>))
				out[k] = typeof v === 'string' && k !== 'base64' ? cut(v, TOOL_OUTPUT_MAX / 2) : v;
			const text = JSON.stringify(out);
			if (text.length <= TOOL_OUTPUT_MAX * 2 || typeof out.base64 === 'string') return text;
		}
	} catch {
		/* plain text */
	}
	return cut(output, TOOL_OUTPUT_MAX);
}

/** Puts back on replayed messages what a replay does not carry (timings,
 *  token counts, turn totals, uuids), from the messages they replace: the
 *  i-th reply when its text is the same, the i-th tool call when its name is. */
function carryStats(from: Msg[], to: Msg[]) {
	const replies = from.filter((m) => m.kind === 'assistant');
	const tools = from.filter((m) => m.kind === 'tool');
	let r = 0;
	let k = 0;
	for (const m of to) {
		if (m.kind === 'assistant') {
			const old = replies[r++];
			if (old?.text !== m.text) continue;
			const { tokens, elapsed, segMs, uuid, turn } = old;
			Object.assign(m, { tokens, elapsed, segMs, uuid, turn });
		} else if (m.kind === 'tool') {
			const old = tools[k++];
			if (old?.name !== m.name) continue;
			const { subagent, args, startedAt, endedAt } = old;
			Object.assign(m, { subagent, args, startedAt, endedAt });
		}
	}
}

export const AUTO_CONTINUE = '继续（连接中断后自动重试）';

export interface RetryState {
	attempt: number;
	max: number;
	reason: string;
	delayMs: number;
	at: number;
}

/** A session's title before the daemon names it. */
export const UNTITLED = 'New session';

/** The context by category (`context_breakdown`): `kind` is `used`,
 *  `deferred` (tools loaded only when called), `buffer` (kept free for
 *  auto-compaction) or `free`. */
export type ContextBreakdown =
	| {
			total: number;
			max: number;
			categories: { name: string; tokens: number; kind: string }[];
			memoryFiles: { path: string; tokens: number }[];
			error?: undefined;
	  }
	| { error: string };

export class ChatState {

	/** Set by the page: invoked with the file paths a successful edit tool
	 *  touched, so the built-in editor can auto-reload open tabs (⌘K flow). */
	static onFilesEdited: ((paths: string[]) => void) | null = null;
	/** A session this one started (`start_session`): the folder it runs in
	 *  and the tool's output (session, engine, title). */
	static onSessionStarted: ((cwd: string, started: Record<string, unknown>) => void) | null = null;
	/** A turn failed (see autoRetry.ts). `started`: the engine had begun it. */
	static onTurnFailed: ((chat: ChatState, message: string, started: boolean) => void) | null = null;

	/** The automatic retry waiting to pick a failed turn back up (autoRetry.ts). */
	autoRetry = $state<RetryState | null>(null);
	/** Automatic retries since the user last sent a message. */
	autoRetries = 0;
	/** The engine's last turn is an automatic "continue" (no bubble of its own). */
	lastTurnAuto = false;
	/** Where the messages of that turn start. */
	#autoFrom = -1;

	/** Which engine backend drives this session ('jucode' default). Set once at
	 *  session creation; the `caps()` helper gates UI surfaces off it. */
	backendId: BackendId = 'jucode';

	/** For 'acp' sessions: which registry agent backs it, and its display name
	 *  (shown instead of the generic ACP label). Set once at session creation. */
	acpAgentId = '';
	acpAgentName = '';
	/** ACP: what the agent supports (`engine_caps`; `caps(chat)` reads it). */
	engineCaps = $state<Partial<BackendCaps> | null>(null);
	/** ACP: whether the agent asks before running tools; null when unknown
	 *  (a custom agent). */
	agentApprovals = $state<boolean | null>(null);
	/** ACP: the agent can run on the JuCode gateway. */
	agentGateway = $state(false);
	/** ACP: the agent as it names itself (`id`: the preset, null for a custom one). */
	agentInfo = $state<{ id: string | null; name: string; version: string } | null>(null);
	/** ACP: the agent's session options besides model and effort. */
	sessionOptions = $state<SessionOption[]>([]);
	/** Claude Code / Codex: the custom provider the engine process runs on
	 *  (`tool_provider`); null on the tool's own configuration or the gateway. */
	toolProvider = $state<SessionToolProvider | null>(null);

	messages = $state<Msg[]>([]);
	provider = $state('');
	model = $state('');
	/** Compact display name for `model` when a backend provides one (claude's
	 *  "Opus 4.8 (1M)"); falls back to `model` in the UI when empty. */
	modelLabel = $state('');
	cwd = $state('');
	/** The engine runs this session as a chat (its directory is ~/.jucode/chats). */
	get isChatMode() {
		return /[\\/]\.jucode[\\/]chats([\\/]|$)/.test(this.cwd);
	}
	sessionId = $state('');
	effort = $state('');
	efforts = $state<string[]>([]);
	/** An ACP agent's effort value that leaves the level to it ("default",
	 *  "auto"; not in `efforts`): the unset state. '' when it has none. */
	effortDefault = $state('');
	/** Claude Code: ultracode (standing Workflow orchestration) is on, and
	 *  this model offers it. */
	ultracode = $state(false);
	ultracodeAvailable = $state(false);
	engineState = $state('starting');
	// True from session creation until the engine emits its first event — i.e.
	// while the claude/codex/jucode child is still booting. Drives the spawn
	// loading animation in the empty chat area.
	booting = $state(true);
	// Set while the store (re)starts this chat's engine; what the user sends
	// meanwhile is held and delivered once it is up (router holdOps).
	restarting = $state(false);
	// Last model catalog seen (from a `model_view`), so the picker popover can open
	// instantly from cache while a fresh `/model` round-trip refreshes it.
	modelCatalog = $state<ModelOption[]>([]);
	modelCatalogEffort = $state('');
	// File-checkpoint sha captured just before each user turn (index = turn), so a
	// rewind can restore the working tree to that turn's state (codex/claude, where
	// the engine only rewinds the conversation, not files).
	fileCheckpoints = $state<Record<number, string>>({});
	contextTokens = $state(0);
	/** What the context holds, by category, as last asked (`context_usage`). */
	contextBreakdown = $state<ContextBreakdown | null>(null);
	contextWindow = $state(0);
	contextLimit = $state(0);
	cost = $state(0);
	billing = $state<BillingCost | null>(null);
	billingError = $state('');
	#billingTurns: Record<string, BillingCost> = {};
	#turnBillingIds: string[] = [];
	pendingMessages = $state<string[]>([]);
	/** How many of pendingMessages the engine has already (first): no
	 *  sending ahead or taking back for those. */
	pendingFixed = $state(0);
	/** A queued message taken back (`unqueued`): the composer takes it in to
	 *  edit again. */
	unqueued = $state<{ content: string; images: string[]; files: string[] } | null>(null);
	picker = $state<Picker>(null);
	/** The daemon names the conversation (and keeps a rename); until then
	 *  this placeholder. */
	title = $state(UNTITLED);
	pendingFill = $state<string | null>(null);
	/** The files of the message `pendingFill` puts back (`fill_input`). */
	pendingFillFiles: string[] = [];
	trustPrompt = $state<{ cwd: string; repoRoot: string | null } | null>(null);
	goal = $state<Goal | null>(null);
	plan = $state<PlanStep[]>([]);
	pendingApproval = $state<{
		callId: string;
		name: string;
		summary: string;
		subagentId: string | null;
		hunks: ApprovalHunk[] | null;
		/** Present for a claude AskUserQuestion — render an interactive picker. */
		questions?: Question[] | null;
		/** An MCP elicitation asking the user to open a page (claude). */
		url?: string;
		/** Where an always-allow can be kept, when the engine says (codex). */
		scopes?: AlwaysScope[];
	} | null>(null);
	/** The conversation is open in its engine's TUI (on this or another
	 *  client): its GUI ops wait until the TUI exits. */
	inTerminal = $state(false);
	/** The daemon terminal running that TUI (`surface` names it), for any
	 *  client to view; '' while the conversation is in the GUI. */
	terminal = $state('');
	/** An MCP server's sign-in page, to open once (codex mcp_login). */
	mcpLoginUrl = $state('');
	/** Subagents by id; `label` names them when the id doesn't (claude's task ids).
	 *  Finished ones stay until the next turn starts. */
	subagents = $state<Record<string, SubagentInfo>>({});
	/** The latest tool call each Task subagent made, by its label (claude
	 *  attributes the calls of a subagent to it, `tool_start.subagent`). */
	subagentLastTool = $state<Record<string, Extract<Msg, { kind: 'tool' }>>>({});
	/** The engine has sent an agent trace (`agent_runs`): it answers the trace ops
	 *  (an older JuCode engine refuses them). */
	agentRunsSeen = $state(false);
	/** When the current (or last) turn started and ended, ms (0: not this run). */
	turnStartedAt = $state(0);
	turnEndedAt = $state(0);
	/** When the plan last changed, ms. */
	planAt = $state(0);
	/** The proposed plan the next message revises (its id); null otherwise. */
	planRevising = $state<string | null>(null);
	/** The mode before plan mode, which approving a plan offers first. */
	modeBeforePlan = $state<ApprovalMode | null>(null);
	/** Background work of a claude session (Workflow, background shell or
	 *  agent, Monitor), as the engine last listed it; `message` is the latest
	 *  progress line. Per engine process: a restart clears it. */
	bgTasks = $state<{ id: string; kind: string; description: string; message: string }[]>([]);
	/** A background shell's output tail, by task id, once asked for. */
	taskOutputs = $state<Record<string, { output: string; truncated: boolean; error: string }>>({});
	/** /btw answers: asked beside the conversation, never part of it. */
	sideAnswers = $state<{ question: string; answer: string; error: string; pending: boolean }[]>([]);
	/** The engine's guess at the next prompt (claude), until the user types or sends. */
	suggestion = $state('');
	/** Claude fast mode: on, can be asked for, and whether thinking summaries
	 *  show (null: the engine has no such switch). */
	fast = $state(false);
	fastAvailable = $state(false);
	thinkingSummaries = $state<boolean | null>(null);
	/** Claude's Workflows and Task subagents (agent_runs), oldest first. */
	agentRuns = $state<{ workflows: WorkflowRun[]; agents: AgentRun[] }>({ workflows: [], agents: [] });
	/** A subagent's own conversation by agent id: its task, then its messages. */
	subagentTranscripts = $state<Record<string, { task: string; messages: Msg[]; error: string }>>({});
	/** The background tasks region beside the conversation is open. */
	tasksOpen = $state(false);
	/** The subagent the background tasks region shows (null: the task list). */
	agentFocus = $state<string | null>(null);
	/** The subagent shown as a page in place of the conversation (Desktop's
	 *  SubagentPage; null: the conversation). */
	agentPage = $state<string | null>(null);
	/** Claude's permission rules (list_permission_rules), once asked for. */
	permissionRules = $state<{
		rules: { behavior: string; source: string; rule: string; editability: string }[];
		directories: { path: string; source: string }[];
	} | null>(null);
	// Latest engine rate-limit / quota notice, shown as a persistent banner until
	// the engine reports the limit cleared (status back to normal). null = no limit.
	/** The engine's plan usage limit, near or hit (see UsageLimit.svelte). */
	rateLimit = $state<UsageLimit | null>(null);
	/** Once the limit resets, the stopped turn carries on (limitResume.svelte.ts). */
	resumeAtReset = $state(false);
	/** The official plan's usage (Claude subscription, ChatGPT plan) as the
	 *  engine last reported it; null for API-key and gateway sessions. */
	planUsage = $state<{
		plan: string | null;
		windows: { key: string; used: number; resetsAt: number | null; minutes: number | null }[];
	} | null>(null);
	commands = $state<CommandItem[]>([]);
	totalIn = $state(0);
	totalOut = $state(0);
	unseen = $state(false);
	/** The last turn ended in an error (its message); cleared by the next one. */
	lastError = $state<string | null>(null);
	compactionTokens = $state(0);
	/** The model request failed and is being re-sent (jucode engine); null
	 *  once output flows again or the turn ends. */
	retry = $state<RetryState | null>(null);
	// Approval policy, enforced engine-side ('ask' ↔ read-only, 'edits' ↔
	// auto-edit, 'all' ↔ full-auto). The engine is the source of truth: this
	// mirrors its `approval_mode` events, except right after engine startup where
	// the desktop pushes its persisted mode (see `pendingModeSync`).
	approvalMode = $state<ApprovalMode>('ask');
	// Set when the engine announces its startup approval mode and it differs
	// from the desktop's persisted mode: the page must send `set_approval_mode`
	// with this value and clear it. Re-armed on every engine `startup` event, so
	// crash auto-restarts / provider switches re-push the mode too.
	pendingModeSync = $state<EngineApprovalMode | null>(null);
	/** The engine reported its model and its backend has no model list cached
	 *  for drafts: the page asks for one (`/model`, answered quietly). */
	wantsCatalog = false;
	/** The next `model_view` answers that ask: cached, no picker. */
	catalogQuiet = false;
	#catalogAsked = false;
	// A mode the user picked that the engine applies only once the running
	// turn ends (Codex, or Claude in or out of full access); null otherwise.
	approvalPending = $state<ApprovalMode | null>(null);
	// Show the engine's approval mode as it is and never push this client's
	// last choice onto it at startup (the remote page: the session belongs to
	// the computer, and only an explicit pick there changes its mode).
	followEngineMode = false;
	// Whether this engine incarnation's startup approval_mode was processed;
	// later approval_mode events are engine-driven changes (e.g. /approvals).
	#modeSynced = false;
	// Latest MCP servers view from this session's engine (emitted at startup and
	// after every state change/mutation). null until the first event arrives.
	// Settings reads this off the *active* session's ChatState — the engine's MCP
	// config is global, so any live session's engine is an authoritative source.
	mcpServers = $state<McpServerView[] | null>(null);
	// A rewind targeted at a specific rendered user message: the page sets this
	// before sending `/rewind`, and the checkpoint_view handler resolves it to a
	// concrete turn id (positional: the i-th user turn matches the i-th user message).
	rewindIntent = $state<{ userIndex: number; text: string } | null>(null);
	pendingRewind = $state<{ id: string; text: string } | null>(null);

	// Engine crash auto-restart bookkeeping (driven by the page on agent-exit).
	// $state so the diagnostics panel reflects restarts live.
	restarts = $state(0);
	restartWindowStart: number | null = null;
	/** Hosted: consecutive failed attempts to reach the daemon (see
	 *  SessionStore#engineFailed); reset with the crash budget. */
	daemonRetries = 0;
	// Set when a claude --resume target isn't found: the next restart must NOT
	// resume the same doomed id (it would crash-loop). One-shot — consumed by the
	// store's restartSession, which then comes up fresh.
	resumeBroken = false;
	/** Skip the next `transcript` replay (see its handler). */
	keepNextTranscript = false;
	/** This chat is coming back to a session it stopped watching (switching
	 *  workspaces): the next replay keeps what it knew of the messages. */
	rejoining = false;
	/** Back watching a turn this chat was timing: the `connecting` right after
	 *  the snapshot's replay is that turn's request, not a new one (next event
	 *  only). */
	#rejoinedTurn = false;
	/** A request of the running turn that missed the prompt cache. One-shot —
	 *  consumed by the page, which offers to stop the turn. */
	cacheMiss: { input: number; cached: number } | null = null;
	#cacheWatch = new CacheWatch();
	// Set while an intentional provider-switch restart is in flight, so the exit it
	// causes isn't treated as a crash to auto-restart.
	switching = false;

	#assistantIdx = -1;
	#reasoningIdx = -1;
	/** The live per-request timer (see CallTiming); null between requests. */
	call = $state<CallTiming | null>(null);
	/** This session's total running time: the sum of its turns, ms. Kept per
	 *  session in localStorage under `#runKey` (see bindRunKey). */
	runMs = $state(0);
	#runKey = '';
	// When the request behind the current reply segment started.
	#segStart: number | null = null;
	#turnSegments = 0;
	// Set once the engine reports a USD estimate via context_usage.
	// While false we estimate cost client-side from token usage × model pricing
	// (claude/codex don't report cost).
	#engineCost = false;
	#turnStart: number | null = null;
	#pendingUserEcho: string | null = null;
	// This turn's running totals (see TurnStats), and the user message whose
	// send state is still shown.
	#sending: Extract<Msg, { kind: 'user' }> | null = null;
	#firstOutput: number | null = null;
	// When the current request's output began streaming, and the turn's streaming time so far.
	#genStart: number | null = null;
	#genMs = 0;
	#turnIn = 0;
	#turnOut = 0;
	#turnTools = 0;
	/** The user asked this turn to stop (`stopping`, or the engine said so). */
	#stopped = false;
	#turnCostStart = 0;
	#lastTurn: TurnStats | null = null;
	// Fast lookup for the tool message backing a call_id, so tool_update/tool_output
	// don't scan the whole transcript. Populated on tool_start; invalidated when the
	// message array is replaced wholesale (transcript). #tool() falls back to a scan
	// on a miss (e.g. transcript-restored tools, which carry no call_id).
	#toolsByCallId = new Map<string, Extract<Msg, { kind: 'tool' }>>();

	constructor() {
		try {
			const saved = localStorage.getItem('jucode-approval-mode');
			if (saved === 'edits' || saved === 'all') this.approvalMode = saved;
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** Set the approval mode locally and persist it (the caller is responsible
	 *  for pushing it to the engine via `set_approval_mode`). Also invoked by the
	 *  approval_mode event handler so engine-driven changes persist too. */
	setApprovalMode(mode: ApprovalMode) {
		if (mode === 'plan' && this.approvalMode !== 'plan') this.modeBeforePlan = this.approvalMode;
		this.approvalMode = mode;
		try {
			localStorage.setItem('jucode-approval-mode', mode);
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** Show a just-sent user message immediately, before the engine echoes it.
	 *  The echo is de-duplicated in the `user_message` handler. */
	optimisticUser(content: string, images?: string[], auto = false, files?: string[]) {
		if (!auto) {
			this.autoRetries = 0;
			this.autoRetry = null;
		}
		this.lastTurnAuto = false;
		this.lastError = null;
		this.#trackSend({ kind: 'user', text: content, state: 'sending', at: Date.now(), ...(images?.length ? { images } : {}), ...(files?.length ? { files } : {}) });
		this.#pendingUserEcho = content;
		this.#resetCurrent();
	}

	/** The user stops the running turn: it ends stopped (its work stays
	 *  unfolded, as in t3code). */
	stopping() {
		if (this.busy) this.#stopped = true;
	}

	/** Sends an automatic "continue" without a bubble: its echo (and its turn
	 *  in a reloaded transcript) shows as a note. */
	autoContinue(content: string) {
		this.lastTurnAuto = true;
		this.#autoFrom = this.messages.length;
		this.lastError = null;
		this.#pendingUserEcho = content;
		this.#resetCurrent();
	}

	/** The last user bubble: its index among user turns, and what it said. */
	lastUserTurn(): { index: number; text: string; images?: string[]; files?: string[] } | null {
		let index = -1;
		let last: Extract<Msg, { kind: 'user' }> | null = null;
		for (const m of this.messages)
			if (m.kind === 'user') {
				index++;
				last = m;
			}
		return last
			? { index, text: last.text, ...(last.images?.length ? { images: last.images } : {}), ...(last.files?.length ? { files: last.files } : {}) }
			: null;
	}

	/** The engine's last turn produced something worth keeping: text or a tool
	 *  call (reasoning alone is not kept by the engines across a retry). */
	turnHadOutput(): boolean {
		let from = this.messages.findLastIndex((m) => m.kind === 'user');
		if (this.lastTurnAuto) from = Math.max(from, this.#autoFrom - 1);
		return this.messages
			.slice(from + 1)
			.some((m) => m.kind === 'tool' || (m.kind === 'assistant' && m.text.trim() !== ''));
	}

	/** A failed turn is being retried: its error goes (the retry's note says
	 *  why), and so does the reply it was streaming, which the engines did not
	 *  keep (Claude Code keeps a finished one, which has its uuid). The message
	 *  it failed on is no longer marked failed. */
	clearFailure() {
		while (this.messages.at(-1)?.kind === 'error') this.messages.pop();
		for (let last = this.messages.at(-1); last?.kind === 'reasoning' || (last?.kind === 'assistant' && !last.uuid); last = this.messages.at(-1))
			this.messages.pop();
		const user = this.messages.findLast((m) => m.kind === 'user');
		if (user?.kind === 'user' && user.state === 'failed') delete user.state;
		this.lastError = null;
		this.#resetCurrent();
	}

	/** Stamp the turn's total elapsed onto its last assistant message. */
	#endTurn() {
		const stopped = this.#stopped;
		this.#stopped = false;
		if (this.#turnStart !== null) this.turnEndedAt = Date.now();
		this.#collapseReasoning();
		if (this.#sending?.state !== 'failed') this.#setSend(null);
		this.call = null;
		if (this.#turnStart === null) return;
		const now = Date.now();
		this.#closeSegment(now);
		const elapsed = now - this.#turnStart;
		this.#addRun(elapsed);
		const turn: TurnStats = {
			elapsed,
			...(this.#firstOutput !== null ? { ttft: this.#firstOutput - this.#turnStart } : {}),
			...(this.#genMs > 0 ? { genMs: this.#genMs } : {}),
			inTokens: this.#turnIn,
			outTokens: this.#turnOut,
			tools: this.#turnTools,
			cost: this.cost - this.#turnCostStart,
			billingTurns: [...this.#turnBillingIds],
			billing: this.#turnBilling(this.#turnBillingIds),
			model: this.model,
			segments: this.#turnSegments,
			...(stopped ? { stopped: true } : {})
		};
		this.#turnStart = null;
		this.#firstOutput = null;
		this.#genMs = 0;
		this.#turnIn = this.#turnOut = this.#turnTools = this.#turnSegments = 0;
		this.#segStart = null;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'assistant') {
				m.elapsed = elapsed;
				m.turn = turn;
				this.#lastTurn = m.turn;
				break;
			}
		}
	}

	/** Start showing the send state of a user message being pushed. */
	#trackSend(m: Extract<Msg, { kind: 'user' }>) {
		this.messages.push(m);
		// The proxied copy, so later state changes render.
		const pushed = this.messages[this.messages.length - 1];
		if (pushed?.kind === 'user') this.#sending = pushed;
	}

	#setSend(state: SendState | null) {
		if (!this.#sending) return;
		if (state) this.#sending.state = state;
		else {
			delete this.#sending.state;
			this.#sending = null;
		}
	}

	/** The reply started streaming: the sent message has arrived. */
	#outputStarted() {
		this.retry = null;
		const now = Date.now();
		if (this.#firstOutput === null && this.#turnStart !== null) this.#firstOutput = now;
		if (this.call?.phase !== 'output') this.call = { phase: 'output', since: now };
		if (this.#genStart === null && this.#turnStart !== null) this.#genStart = now;
		this.#setSend(null);
	}

	/** A model request was sent. jucode and claude then report the model's
	 *  answer (`thinking_start`); the other engines only the first token, so
	 *  their wait counts as the time to it. */
	#requestStarted() {
		const now = Date.now();
		this.#closeSegment(now);
		this.#segStart = now;
		this.call = { phase: ANSWER_REPORTED.has(this.backendId) ? 'connect' : 'ttft', since: now };
	}

	/** The open reply segment ends (its tool call, a new request, the turn's
	 *  end): stamp its own time. Text after it starts a new segment. */
	#closeSegment(now: number) {
		if (this.#genStart !== null) {
			this.#genMs += now - this.#genStart;
			this.#genStart = null;
		}
		const m = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : null;
		if (m?.kind === 'assistant' && m.segMs === undefined && this.#segStart !== null) {
			m.segMs = now - this.#segStart;
			this.#turnSegments++;
		}
		this.#assistantIdx = -1;
	}

	/** A removed session's saved run time goes with it. */
	static forgetRunTime(key: string) {
		try {
			localStorage.removeItem(`jucode-run-ms:${key}`);
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** Keys this chat's running total to its session and loads what it ran
	 *  before (the transcript replay carries no timing). */
	bindRunKey(key: string) {
		this.#runKey = key;
		try {
			this.runMs = Number(localStorage.getItem(`jucode-run-ms:${key}`)) || 0;
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	#addRun(ms: number) {
		this.runMs += ms;
		if (!this.#runKey) return;
		try {
			localStorage.setItem(`jucode-run-ms:${this.#runKey}`, String(this.runMs));
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** A turn's timer and totals start (idempotent within the turn). */
	#startTurn() {
		if (this.#turnStart !== null) return;
		this.#turnStart = Date.now();
		this.turnStartedAt = this.#turnStart;
		this.turnEndedAt = 0;
		// The agents a finished turn ran leave with it.
		for (const [id, a] of Object.entries(this.subagents)) if (a.endedAt) delete this.subagents[id];
		this.#segStart = this.#turnStart;
		this.#firstOutput = null;
		this.#genStart = null;
		this.#genMs = 0;
		this.#turnIn = this.#turnOut = this.#turnTools = this.#turnSegments = 0;
		this.#turnCostStart = this.cost;
		this.#turnBillingIds = [];
		this.#lastTurn = null;
	}

	#turnBilling(ids: string[]): BillingCost | undefined {
		const rows = ids.map(id => this.#billingTurns[id]).filter(Boolean);
		return rows.length ? sumCosts(rows) : undefined;
	}

	get busy() {
		return ['streaming', 'connecting', 'compacting', 'steering'].includes(this.engineState);
	}

	/** Meta/status notices (retrying, compaction, stderr, engine warnings, restart
	 *  notices) — kept out of the conversation bubble stream and shown in the
	 *  collapsible status strip instead. Real conversation (user/assistant/
	 *  reasoning/tool) and errors stay inline. */
	/** How many of statusLog the user has seen (opened the notices since). */
	statusSeen = $state(0);

	get statusLog(): string[] {
		const out: string[] = [];
		for (const m of this.messages) if (m.kind === 'system') out.push(m.text);
		return out;
	}

	/** Number of user turns in the transcript (one per sent message). */
	get userTurns() {
		return this.messages.filter((m) => m.kind === 'user').length;
	}

	/** Aggregate turn-timing stats (from assistant `elapsed` stamps) for the
	 *  diagnostics panel: completed turns, total and mean wall-clock. */
	get turnTiming(): { turns: number; totalMs: number; meanMs: number } {
		let turns = 0;
		let totalMs = 0;
		for (const m of this.messages) {
			if (m.kind === 'assistant' && typeof m.elapsed === 'number') {
				turns++;
				totalMs += m.elapsed;
			}
		}
		return { turns, totalMs, meanMs: turns ? Math.round(totalMs / turns) : 0 };
	}

	/** Message-kind histogram for the diagnostics panel. */
	get messageStats(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const m of this.messages) out[m.kind] = (out[m.kind] ?? 0) + 1;
		return out;
	}

	/** For a claude rewind to the `userIndex`-th user turn: the transcript uuid of
	 *  the assistant message ending the previous turn — the `--resume-session-at`
	 *  target. Null when rewinding to the first turn (restart fresh). */
	claudeRewindTarget(userIndex: number): string | null {
		let count = 0;
		let lastUuid: string | null = null;
		for (const m of this.messages) {
			if (m.kind === 'user') {
				if (count === userIndex) return lastUuid;
				count++;
			} else if (m.kind === 'assistant' && m.uuid) {
				lastUuid = m.uuid;
			}
		}
		return lastUuid;
	}

	/** Drop the `userIndex`-th user turn and everything after it — used by codex's
	 *  local view truncation on a thread/rollback rewind (the engine rewinds its
	 *  own history; we mirror it in the projected transcript). */
	truncateToUserTurn(userIndex: number) {
		let count = 0;
		for (let i = 0; i < this.messages.length; i++) {
			if (this.messages[i].kind === 'user') {
				if (count === userIndex) {
					this.messages = this.messages.slice(0, i);
					return;
				}
				count++;
			}
		}
	}

	/** Whether this session has something the engine actually persisted to resume.
	 *  A fresh session (id assigned at startup but no user turn yet) was never saved,
	 *  so a native TUI could not resume it. */
	get resumable() {
		return this.sessionId !== '' && this.messages.some((m) => m.kind === 'user');
	}

	/** The activity phase shown by the bottom indicator. O(1) — checks the last message. */
	get phase(): 'connecting' | 'waiting' | 'generating' | 'tool' | 'compacting' | null {
		if (this.engineState === 'compacting') return 'compacting';
		if (!this.busy) return null;
		const last = this.messages[this.messages.length - 1];
		if (last?.kind === 'tool') {
			// Claude announces a call as the model starts writing it: the
			// request still streams its arguments.
			if (this.call?.phase === 'output') return 'generating';
			// Calls run side by side; any of the trailing ones still running.
			for (let i = this.messages.length - 1; i >= 0; i--) {
				const m = this.messages[i];
				if (m.kind !== 'tool') break;
				if (m.running) return 'tool';
			}
			return 'waiting';
		}
		// Content is the source of truth: if the tail message has streamed text we're
		// generating, regardless of a stale 'connecting' engine state.
		if ((last?.kind === 'assistant' || last?.kind === 'reasoning') && last.text.length > 0)
			return 'generating';
		if (this.engineState === 'connecting') return 'connecting';
		return 'waiting';
	}

	closePicker() {
		this.picker = null;
	}

	#resetCurrent() {
		this.#assistantIdx = -1;
		this.#reasoningIdx = -1;
	}

	/** Collapse the active reasoning block once its tool call or the answer starts. */
	#collapseReasoning() {
		if (this.#reasoningIdx >= 0) {
			const m = this.messages[this.#reasoningIdx];
			if (m?.kind === 'reasoning') m.collapsed = true;
			this.#reasoningIdx = -1;
		}
	}

	/** Clear the running flag on any tool card still marked running once a turn
	 *  ends — guards against a permanent spinner when a tool_output is never
	 *  delivered (see the `status` handler). */
	#finishStuckTools() {
		for (const m of this.messages) {
			// A background subagent's calls go on after the turn: its own
			// result, or its end, finishes them.
			if (m.kind === 'tool' && m.running && !(m.subagent && this.#agentRunning(m.subagent))) {
				m.running = false;
				m.endedAt ??= Date.now();
			}
		}
	}

	/** Whether the subagent named `label` (its calls' `subagent`) still runs. */
	#agentRunning(label: string): boolean {
		const live = (state: string) => !FINAL_AGENT.includes(state);
		return (
			Object.values(this.subagents).some((a) => a.label === label && !a.endedAt) ||
			this.agentRuns.agents.some((a) => a.label === label && live(a.state)) ||
			this.agentRuns.workflows.some((w) => w.agents.some((a) => a.label === label && live(a.state)))
		);
	}

	/** A subagent ended: its calls still spinning are done too. */
	#finishAgentTools(label: string) {
		for (const m of this.messages) {
			if (m.kind === 'tool' && m.running && m.subagent === label) {
				m.running = false;
				m.endedAt ??= Date.now();
			}
		}
	}

	#tool(callId: string): Extract<Msg, { kind: 'tool' }> | undefined {
		const hit = this.#toolsByCallId.get(callId);
		if (hit) return hit;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'tool' && m.callId === callId) return m;
		}
		return undefined;
	}

	#remember(patch: BackendProfile) {
		rememberProfile(profileKey(this.backendId, this.acpAgentId), patch);
	}

	/** A draft (no engine yet) shows what its backend reported last time. */
	seedFromProfile() {
		const p = loadProfile(profileKey(this.backendId, this.acpAgentId));
		this.provider = p.provider ?? '';
		this.model = p.model ?? '';
		this.modelLabel = p.modelLabel ?? '';
		this.effort = p.effort ?? '';
		this.efforts = p.efforts ?? [];
		this.effortDefault = p.effortDefault ?? '';
		this.contextWindow = p.contextWindow ?? 0;
		this.modelCatalog = p.catalog ?? [];
		this.modelCatalogEffort = p.catalogEffort ?? '';
		this.commands = p.commands ?? [];
		if (this.backendId === 'acp') this.engineCaps = p.caps ?? null;
	}

	/** A spawn_agent call finished: an engine that reports its subagents
	 *  only there (JuCode before the agent trace) names the agent in the
	 *  output (`path`, `task_name`, `status`). */
	#spawned(callId: string, output: string) {
		let out: Record<string, unknown>;
		try {
			out = JSON.parse(output) as Record<string, unknown>;
		} catch {
			return;
		}
		const path = str(out.path);
		if (!path) return;
		const prev = this.subagents[path];
		this.subagents[path] = {
			status: prev?.status ?? (str(out.status) || 'running'),
			message: prev?.message ?? '',
			label: prev?.label ?? (str(out.task_name) || undefined),
			...(prev?.model ? { model: prev.model } : {}),
			toolUseId: prev?.toolUseId ?? callId,
			startedAt: prev?.startedAt ?? Date.now(),
			...(prev?.endedAt ? { endedAt: prev.endedAt } : {})
		};
	}

	handle(ev: AgentEvent) {
		// The engine has spoken — the child is up, so the boot animation ends.
		this.booting = false;
		const rejoinedTurn = this.#rejoinedTurn;
		this.#rejoinedTurn = false;
		switch (ev.type) {
			case 'startup':
				// An engine that recovered from a failed resume in-process (codex
				// opens a fresh thread) is fine: its new id is resumable.
				this.resumeBroken = false;
				// A new engine reports its own plan, if any (a switch to the gateway
				// has none).
				this.planUsage = null;
				this.model = str(ev.model);
				this.cwd = str(ev.cwd);
				if (str(ev.session_id)) this.sessionId = str(ev.session_id);
				this.contextWindow = num(ev.context_window);
				this.#cacheWatch.reset();
				// An ACP agent's engine_caps and session_options, and a tool's
				// tool_provider, stay: the daemon sends them per process or on
				// change, and they may come before this startup.
				// A fresh engine incarnation (first start, crash auto-restart or
				// provider switch) announces its approval mode next — re-arm the
				// startup sync so the desktop's persisted mode is pushed again.
				this.#modeSynced = false;
				break;
			case 'approval_mode_pending': {
				const mode = str(ev.mode);
				this.approvalPending = mode ? (PENDING_MODES[mode] ?? fromEngineMode(mode)) : null;
				break;
			}
			case 'approval_mode': {
				const engineMode = str(ev.mode);
				if (this.followEngineMode) {
					this.approvalMode = reconcileMode(this.approvalMode, engineMode);
					break;
				}
				if (!this.#modeSynced) {
					// Startup announcement: the desktop's persisted mode wins — ask the
					// page to push it if the engine (default read-only) differs.
					this.#modeSynced = true;
					if (engineMode !== toEngineMode(this.approvalMode)) {
						this.pendingModeSync = toEngineMode(this.approvalMode);
						break;
					}
				}
				// Post-sync the engine is the source of truth (e.g. a manually typed
				// /approvals, or the ack of our own set_approval_mode).
				this.setApprovalMode(reconcileMode(this.approvalMode, engineMode));
				break;
			}
			case 'model_status':
				if (str(ev.model) !== this.model) this.#cacheWatch.reset();
				this.provider = str(ev.provider);
				this.model = str(ev.model);
				this.modelLabel = str(ev.model_label);
				this.effort = str(ev.reasoning_effort);
				this.efforts = arr<string>(ev.reasoning_efforts);
				this.effortDefault = str(ev.default_effort);
				// A draft of this backend lists the models a running session
				// does; the cache otherwise fills only from a menu opened here.
				if (this.model && !this.#catalogAsked) {
					this.#catalogAsked = true;
					this.wantsCatalog = !loadProfile(profileKey(this.backendId, this.acpAgentId)).catalog?.length;
				}
				this.ultracode = ev.ultracode === true;
				this.ultracodeAvailable = ev.ultracode_available === true;
				this.fast = ev.fast === true;
				this.fastAvailable = ev.fast_available === true;
				this.thinkingSummaries = typeof ev.thinking_summaries === 'boolean' ? ev.thinking_summaries : null;
				this.engineState = str(ev.state) || this.engineState;
				this.contextWindow = num(ev.context_window);
				this.contextLimit = num(ev.context_limit);
				this.#remember({
					provider: this.provider,
					model: this.model,
					modelLabel: this.modelLabel,
					effort: this.effort,
					efforts: this.efforts,
					effortDefault: this.effortDefault,
					contextWindow: this.contextWindow
				});
				break;
			case 'user_message': {
				const text = str(ev.content);
				// Skip the echo of a message we already showed optimistically. The
				// echo need not be the last message: claude's --replay-user-messages
				// re-emits the user turn AFTER the assistant reply, so the optimistic
				// bubble is no longer at the tail — match on the pending echo alone.
				if (this.#pendingUserEcho === text) {
					this.#pendingUserEcho = null;
					this.#resetCurrent();
					break;
				}
				// A real, non-optimistic user message (e.g. a queued send that was
				// never shown optimistically) — clear any stale echo so it can't
				// later swallow an identical message.
				this.#pendingUserEcho = null;
				this.lastError = null;
				// Sent from elsewhere (another device, a queue): the user's own turn,
				// so no retry of the turn before it is still due.
				this.lastTurnAuto = false;
				this.autoRetries = 0;
				this.autoRetry = null;
				// No send state: claude echoes after the reply, when it would stick.
				const images = arr<string>(ev.images).filter((p) => typeof p === 'string');
				const files = arr<string>(ev.files).filter((p) => typeof p === 'string');
				this.messages.push({ kind: 'user', text, at: Date.now(), ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) });
				this.#resetCurrent();
				break;
			}
			case 'assistant_start':
				// The engine fires this eagerly at turn start, before reasoning. Don't
				// create the message here — let the first delta create it, so reasoning
				// (which streams first) is rendered above the answer.
				this.#assistantIdx = -1;
				break;
			case 'assistant_delta': {
				this.#outputStarted();
				if (this.#assistantIdx < 0) {
					this.#collapseReasoning();
					this.messages.push({ kind: 'assistant', text: '', at: Date.now() });
					this.#assistantIdx = this.messages.length - 1;
				}
				const m = this.messages[this.#assistantIdx];
				if (m?.kind === 'assistant') m.text += str(ev.delta);
				break;
			}
			case 'thinking_start':
				// The model answered; the first token is on its way.
				ANSWER_REPORTED.add(this.backendId);
				if (this.#sending?.state === 'connecting' || this.#sending?.state === 'sending') this.#setSend('waiting');
				if (this.call) this.call = { phase: 'ttft', since: Date.now() };
				break;
			case 'reasoning_delta': {
				this.#outputStarted();
				if (this.#reasoningIdx < 0) {
					this.messages.push({ kind: 'reasoning', text: '', collapsed: false });
					this.#reasoningIdx = this.messages.length - 1;
				}
				const m = this.messages[this.#reasoningIdx];
				if (m?.kind === 'reasoning') m.text += str(ev.delta);
				break;
			}
			case 'tool_start':
				// A subagent's call (claude's `subagent`) is its work, not this
				// reply's: it neither ends the reply's segment nor counts as its call.
				if (!str(ev.subagent)) {
					this.#outputStarted();
					this.#turnTools++;
					// The request is done and its tools run untimed, except on claude,
					// which announces a call as the model starts writing it: that
					// request ends with its `usage`. Text after them is a new segment,
					// below the tool cards.
					if (this.backendId !== 'claude') this.call = null;
					this.#closeSegment(Date.now());
					// One reasoning block per round: collapse this round's reasoning once
					// its tool call appears, so the next round starts a fresh block.
					this.#collapseReasoning();
				}
				{
					const callId = str(ev.call_id);
					const toolMsg: Extract<Msg, { kind: 'tool' }> = {
						kind: 'tool',
						callId,
						name: str(ev.name),
						output: '',
						running: true,
						isError: false,
						startedAt: Date.now(),
						...(str(ev.subagent) ? { subagent: str(ev.subagent) } : {})
					};
					this.messages.push(toolMsg);
					// Index the proxied copy: writes to the raw object would not render
					// once the card has read it (tool_update / tool_output never showed).
					const pushed = this.messages[this.messages.length - 1];
					if (callId && pushed?.kind === 'tool') this.#toolsByCallId.set(callId, pushed);
					if (pushed?.kind === 'tool' && pushed.subagent) this.subagentLastTool[pushed.subagent] = pushed;
				}
				break;
			case 'tool_update': {
				const t = this.#tool(str(ev.call_id));
				if (t) {
					t.output = boundedOutput(str(ev.output));
					if (SUBAGENT_CALLS.has(t.name)) t.args = t.output;
				}
				break;
			}
			case 'tool_output': {
				// The call ran: it was decided here, on another device, or by
				// a mode switch, so its card goes.
				if (this.pendingApproval && this.pendingApproval.callId === str(ev.call_id)) this.pendingApproval = null;
				// Engines that do not announce each request (codex) start the next
				// one once the tools are back.
				this.#segStart = Date.now();
				if (FIRST_REQUEST_ONLY.has(this.backendId) && this.busy && !this.call) {
					const id = str(ev.call_id);
					if (!this.messages.some((m) => m.kind === 'tool' && m.running && m.callId !== id)) this.call = { phase: 'ttft', since: this.#segStart };
				}
				const t = this.#tool(str(ev.call_id));
				if (t) {
					t.output = boundedOutput(str(ev.output));
					t.running = false;
					t.isError = ev.is_error === true;
					t.endedAt = Date.now();
				}
				if (str(ev.name) === 'spawn_agent' && ev.is_error !== true) this.#spawned(str(ev.call_id), str(ev.output));
				if (str(ev.name) === 'start_session' && ev.is_error !== true) {
					const started = parseToolOutput(str(ev.output));
					if (started && typeof started.session === 'string') ChatState.onSessionStarted?.(this.cwd, started);
				}
				// Reload editor tabs of files a successful edit tool touched (an
				// ACP agent's edit is known by its kind, not its name).
				if (ev.is_error !== true) {
					const out = parseToolOutput(str(ev.output));
					if (EDIT_TOOLS.includes(str(ev.name)) || isEdit(str(ev.name), out)) {
						const edited = editedPaths(out);
						if (edited.length) ChatState.onFilesEdited?.(edited);
					}
				}
				break;
			}
			case 'assistant_uuid': {
				// Stamp the transcript uuid on the active/last assistant turn (claude
				// rewind resume-at target).
				const uuid = str(ev.uuid);
				if (uuid) {
					let m = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : null;
					if (m?.kind !== 'assistant') {
						for (let i = this.messages.length - 1; i >= 0; i--) {
							if (this.messages[i].kind === 'assistant') {
								m = this.messages[i];
								break;
							}
						}
					}
					if (m?.kind === 'assistant') m.uuid = uuid;
				}
				break;
			}
			case 'session_usage': {
				this.billingError = str(ev.billing_error);
				if (ev.totals) {
					const totals = ev.totals as unknown as BillingCost & { turns?: number; input_tokens?: number; output_tokens?: number };
					// Keep the last settled figures visible if the ledger is offline.
					if (!this.billingError || !this.billing) {
						// The daemon's ledger keeps every turn this session ran, across
						// restarts: its figures stand over what this client counted.
						this.billing = (totals.turns ?? 0) > 0 ? totals : null;
						if (this.billing) {
							this.totalIn = num(totals.input_tokens);
							this.totalOut = num(totals.output_tokens);
						}
						for (const row of arr<BillingCost & { turn_id: string }>(ev.turns)) this.#billingTurns[row.turn_id] = row;
						for (const m of this.messages) {
							if (m.kind === 'assistant' && m.turn) m.turn.billing = this.#turnBilling(m.turn.billingTurns ?? []);
						}
					}
				}
				break;
			}
			case 'context_breakdown':
				this.contextBreakdown = ev.error
					? { error: str(ev.error) }
					: {
							total: num(ev.total),
							max: num(ev.max),
							categories: arr<Record<string, unknown>>(ev.categories).map((c) => ({
								name: str(c.name),
								tokens: num(c.tokens),
								kind: str(c.kind) || 'used'
							})),
							memoryFiles: arr<Record<string, unknown>>(ev.memory_files).map((f) => ({ path: str(f.path), tokens: num(f.tokens) }))
						};
				break;
			case 'context_usage':
				this.contextTokens = num(ev.tokens);
				if (typeof ev.cost === 'number') {
					this.cost = ev.cost;
					this.#engineCost = true;
				}
				break;
			case 'pending_messages':
				this.pendingMessages = arr<string>(ev.messages);
				this.pendingFixed = typeof ev.fixed === 'number' ? ev.fixed : 0;
				break;
			case 'unqueued':
				this.unqueued = {
					content: str(ev.content),
					images: arr<string>(ev.images).filter((p) => typeof p === 'string'),
					files: arr<string>(ev.files).filter((p) => typeof p === 'string')
				};
				break;
			case 'tree_view':
				this.picker = { kind: 'tree', nodes: arr<TreeNode>(ev.nodes) };
				break;
			case 'model_view':
				this.modelCatalog = arr<ModelOption>(ev.models);
				this.modelCatalogEffort = str(ev.active_effort);
				this.#remember({ catalog: this.modelCatalog, catalogEffort: this.modelCatalogEffort });
				if (this.catalogQuiet) {
					this.catalogQuiet = false;
					break;
				}
				this.picker = {
					kind: 'model',
					models: arr<ModelOption>(ev.models),
					activeEffort: str(ev.active_effort)
				};
				break;
			case 'resume_view':
				this.picker = {
					kind: 'resume',
					items: arr<ResumeItem>(ev.items),
					...(isBackendId(str(ev.backend)) ? { backend: str(ev.backend) as BackendId } : {}),
					...(ev.history === true ? { history: true, source: 'jucode' as const } : {})
				};
				break;
			case 'checkpoint_view': {
				const items = arr<ResumeItem>(ev.items);
				// A pencil-driven rewind targets a specific user message by position;
				// resolve it to a turn id and confirm instead of opening the picker.
				if (this.rewindIntent) {
					const target = items[this.rewindIntent.userIndex];
					const text = this.rewindIntent.text;
					this.rewindIntent = null;
					if (target) {
						this.pendingRewind = { id: target.id, text };
						break;
					}
				}
				this.picker = { kind: 'checkpoint', items };
				break;
			}
			case 'transcript': {
				// A claude conversation reopened under this chat (restart, yolo,
				// gateway switch, rewind): the replay is plain text without tool
				// cards or message uuids, so the messages held here stay.
				if (this.keepNextTranscript) {
					this.keepNextTranscript = false;
					this.#resetCurrent();
					break;
				}
				const items = arr<Record<string, unknown>>(ev.items);
				// The message array is reassigned wholesale below and restored tool
				// entries carry no call_id, so the fast-lookup map is now stale — clear
				// it and let #tool() fall back to scanning.
				this.#toolsByCallId.clear();
				// A message sent just before the snapshot arrived (a session that
				// opens with its first message) is not in it yet: keep its bubble.
				// If the snapshot already has it, its echo came with it.
				const pending = this.#pendingUserEcho;
				const sent = pending === null ? undefined : this.messages.findLast((m) => m.kind === 'user' && m.text === pending);
				const before = this.messages;
				this.messages = items
					.map((it): Msg | null => {
						const role = str(it.role);
						if (role === 'user' && str(it.content) === AUTO_CONTINUE)
							return { kind: 'system', text: t('chat.autoRetry.resumed') };
						// When it was said, if the engine knows (`at`, ms).
						const at = typeof it.at === 'number' ? { at: it.at } : {};
						if (role === 'user') {
							const images = arr<string>(it.images).filter((p) => typeof p === 'string');
							const files = arr<string>(it.files).filter((p) => typeof p === 'string');
							return { kind: 'user', text: str(it.content), ...at, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) };
						}
						// Its uuid: where a Claude rewind or fork resumes the conversation.
						if (role === 'assistant') return { kind: 'assistant', text: str(it.content), ...at, ...(str(it.uuid) ? { uuid: str(it.uuid) } : {}) };
						if (role === 'reasoning') return { kind: 'reasoning', text: str(it.content), collapsed: true };
						if (role === 'tool')
							return {
								kind: 'tool',
								callId: str(it.call_id),
								name: str(it.name),
								output: boundedOutput(str(it.output)),
								running: false,
								isError: it.is_error === true,
								...(str(it.subagent) ? { subagent: str(it.subagent) } : {})
							};
						if (role === 'branch') return { kind: 'system', text: `branch: ${str(it.label)}` };
						if (role === 'plan')
							return { kind: 'plan', id: str(it.id), title: str(it.title), text: str(it.content), status: planStatus(it.status) };
						return null;
					})
					.filter((m): m is Msg => m !== null);
				if (pending !== null) {
					// The same text is not enough when it is empty: an earlier
					// message of images alone is not this one.
					const last = this.messages.findLast((m) => m.kind === 'user');
					const same = (a?: string[], b?: string[]) => (a ?? []).join('\n') === (b ?? []).join('\n');
					const mine = sent?.kind === 'user' ? sent : undefined;
					if (last?.kind === 'user' && last.text === pending && (pending !== '' || (same(last.images, mine?.images) && same(last.files, mine?.files))))
						this.#pendingUserEcho = null;
					else if (sent) this.messages.push(sent);
				}
				if (this.rejoining) {
					this.rejoining = false;
					carryStats(before, this.messages);
					// Still running: the timers go on from when they began.
					this.#rejoinedTurn = this.#turnStart !== null && this.busy;
					// The turn ended while this chat was not watching: when is unknown.
					if (!this.busy && this.#turnStart !== null) {
						this.#turnStart = null;
						this.#firstOutput = null;
						this.call = null;
						this.#setSend(null);
					}
				}
				this.#resetCurrent();
				break;
			}
			case 'fill_input':
				this.pendingFillFiles = arr<string>(ev.files).filter((p) => typeof p === 'string');
				this.pendingFill = str(ev.content);
				break;
			case 'trust_prompt':
				this.trustPrompt = {
					cwd: str(ev.cwd),
					repoRoot: typeof ev.repo_root === 'string' ? ev.repo_root : null
				};
				break;
			case 'retrying':
				// The request is sent again from the start: what it streamed so far
				// is replaced. A request's tool calls arrive only once it completed,
				// so the text, reasoning and plan still being drafted at the end are
				// this request's.
				for (let last = this.messages.at(-1); last; last = this.messages.at(-1)) {
					if (last.kind !== 'assistant' && last.kind !== 'reasoning' && !(last.kind === 'plan' && last.status === 'drafting')) break;
					this.messages.pop();
				}
				this.#resetCurrent();
				// Shown live at the end of the transcript (RetryNotice), not as a log line.
				this.retry = {
					attempt: num(ev.attempt),
					max: num(ev.max_attempts),
					reason: str(ev.reason),
					delayMs: num(ev.delay_ms),
					at: Date.now()
				};
				break;
			case 'resume_failed':
				// The engine couldn't resume the session id — restart fresh instead of
				// looping on the same doomed --resume.
				this.resumeBroken = true;
				break;
			case 'compaction_progress':
				this.compactionTokens = num(ev.output_tokens);
				break;
			case 'compaction_end':
				this.compactionTokens = 0;
				this.#cacheWatch.reset();
				this.messages.push({ kind: 'system', text: 'context compacted' });
				// An automatic compaction ends mid-turn and the turn carries on;
				// only the turn's closing status would otherwise clear "compacting".
				if (this.engineState === 'compacting') this.engineState = 'streaming';
				break;
			case 'compaction_failed':
				this.messages.push({ kind: 'error', text: `compaction failed: ${str(ev.error)}` });
				if (this.engineState === 'compacting') this.engineState = 'streaming';
				break;
			case 'goal':
				this.goal = ev.goal ? (ev.goal as unknown as Goal) : null;
				break;
			case 'plan': {
				const next = arr<PlanStep>(ev.plan);
				if (JSON.stringify(next) !== JSON.stringify(this.plan)) this.planAt = Date.now();
				this.plan = next;
				break;
			}
			case 'approval_request':
				this.pendingApproval = {
					callId: str(ev.call_id),
					name: str(ev.name),
					summary: str(ev.summary),
					subagentId: typeof ev.subagent_id === 'string' && ev.subagent_id ? ev.subagent_id : null,
					hunks: parseHunks(ev.hunks),
					questions: parseQuestions(ev.questions),
					...(str(ev.url) ? { url: str(ev.url) } : {}),
					...(Array.isArray(ev.scopes) ? { scopes: arr<AlwaysScope>(ev.scopes) } : {})
				};
				break;
			// The conversation moved to its engine's own TUI on some client, or
			// came back: the transcript that follows is the whole conversation,
			// what the TUI added included.
			case 'surface':
				this.inTerminal = ev.surface === 'tui';
				this.terminal = ev.surface === 'tui' ? str(ev.term) : '';
				if (ev.surface === 'gui') this.keepNextTranscript = false;
				break;
			case 'mcp_login':
				this.mcpLoginUrl = str(ev.url);
				break;
			case 'engine_caps': {
				const agent = ev.agent as Record<string, unknown> | null | undefined;
				this.engineCaps = (ev.caps as Partial<BackendCaps> | undefined) ?? null;
				// A draft of this agent can pick a model (and more) before it starts.
				if (this.engineCaps) this.#remember({ caps: this.engineCaps });
				this.agentApprovals = typeof ev.approvals === 'boolean' ? ev.approvals : null;
				this.agentGateway = ev.gateway === true;
				this.agentInfo = agent
					? { id: typeof agent.id === 'string' ? agent.id : null, name: str(agent.name), version: str(agent.version) }
					: null;
				break;
			}
			// Sent for each engine process and kept in watch snapshots; like
			// engine_caps it may come before that process's startup, so startup
			// leaves it and the next process's event replaces it.
			case 'tool_provider': {
				const p = ev.provider as Record<string, unknown> | null | undefined;
				this.toolProvider =
					p && typeof p === 'object' && str(p.id)
						? {
								id: str(p.id),
								name: str(p.name) || str(p.id),
								model: str(p.model),
								// An older daemon names only its one model.
								models: Array.isArray(p.models) ? p.models.map(str).filter(Boolean) : [str(p.model)].filter(Boolean)
							}
						: null;
				break;
			}
			case 'session_options':
				// The agent's option types pass through; only these two render.
				this.sessionOptions = arr<SessionOption>(ev.options).filter((o) => o.type === 'select' || o.type === 'boolean');
				break;
			case 'command_list':
				this.commands = arr<CommandItem>(ev.commands);
				this.#remember({ commands: this.commands });
				break;
			case 'usage': {
				// A request's own usage closes it (an aggregate is a turn's sum).
				if (ev.aggregate !== true && this.call?.phase === 'output') this.call = null;
				if (typeof ev.billing_turn === 'string') {
					const id = ev.billing_turn;
					if (ev.billing_gateway === true) {
						const row = this.#billingTurns[id] ?? pendingCost();
						// A further request on a known turn is not yet in its settled snapshot.
						this.#billingTurns[id] = { ...row, pending_requests: Math.max(1, row.pending_requests) };
						this.billing = { ...(this.billing ?? pendingCost()), pending_requests: Math.max(1, this.billing?.pending_requests ?? 0) };
					}
					const ids = this.#turnStart !== null ? this.#turnBillingIds : this.#lastTurn ? (this.#lastTurn.billingTurns ??= []) : [];
					if (!ids.includes(id)) ids.push(id);
					if (this.#turnStart === null && this.#lastTurn) this.#lastTurn.billing = this.#turnBilling(ids);
				}
				const out = num(ev.output_tokens);
				const inn = num(ev.input_tokens);
				// Engines without cache figures (acp) leave the field out; an
				// aggregate (claude's subagents, summed) is no one request's prefix.
				if (typeof ev.cached_input_tokens === 'number' && ev.aggregate !== true) {
					const cached = ev.cached_input_tokens;
					if (this.#cacheWatch.check(inn, cached) && this.busy) this.cacheMiss = { input: inn, cached };
				}
				this.totalIn += inn;
				this.totalOut += out;
				// Estimate cost from tokens when the engine doesn't report it itself.
				if (!this.#engineCost) this.cost += costUsd(this.model, inn, out);
				if (this.#turnStart !== null) {
					this.#turnIn += inn;
					this.#turnOut += out;
				} else if (this.#lastTurn) {
					// claude reports the turn's usage after the turn ended.
					this.#lastTurn.inTokens += inn;
					this.#lastTurn.outTokens += out;
					this.#lastTurn.cost = this.cost - this.#turnCostStart;
				}
				// Prefer the active assistant message (jucode reports usage per
				// message, mid-turn). When it's already reset — e.g. claude reports
				// one usage at the end of the turn, after the assistant finished —
				// fall back to the last assistant message, matching #endTurn's
				// elapsed stamping so tokens and time land on the same bubble.
				let m = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : null;
				if (m?.kind !== 'assistant') {
					m = null;
					for (let i = this.messages.length - 1; i >= 0; i--) {
						if (this.messages[i].kind === 'assistant') {
							m = this.messages[i];
							break;
						}
					}
				}
				if (m?.kind === 'assistant') m.tokens = (m.tokens ?? 0) + out;
				break;
			}
			case 'subagent_lifecycle': {
				const path = str(ev.path);
				if (!path) break;
				const prev = this.subagents[path];
				// `message`: a message was queued for it, its state is unchanged.
				const status = str(ev.status) === 'message' ? (prev?.status ?? 'running') : str(ev.status);
				const now = Date.now();
				const ended = FINAL_AGENT.includes(status);
				// The end of one started before the engine process (claude):
				// nothing shown to end.
				if (ended && !prev && !str(ev.label)) break;
				this.subagents[path] = {
					status,
					message: str(ev.message) || (str(ev.status) === 'message' ? (prev?.message ?? '') : ''),
					...((str(ev.label) || prev?.label) ? { label: str(ev.label) || prev?.label } : {}),
					...((str(ev.model) || prev?.model) ? { model: str(ev.model) || prev?.model } : {}),
					...((str(ev.tool_use_id) || prev?.toolUseId) ? { toolUseId: str(ev.tool_use_id) || prev?.toolUseId } : {}),
					startedAt: prev?.startedAt ?? now,
					...(ended ? { endedAt: prev?.endedAt ?? now } : {})
				};
				const label = this.subagents[path]!.label;
				if (ended && label) this.#finishAgentTools(label);
				break;
			}
			// The plan as the model writes it: one message grows, and the
			// proposed_plan with the same id completes it.
			case 'plan_draft': {
				const id = str(ev.id);
				const known = this.messages.find((m) => m.kind === 'plan' && m.id === id);
				if (known?.kind === 'plan') {
					if (str(ev.title)) known.title = str(ev.title);
					known.text += str(ev.append);
				} else {
					this.#collapseReasoning();
					this.#closeSegment(Date.now());
					this.messages.push({ kind: 'plan', id, title: str(ev.title), text: str(ev.append), status: 'drafting' });
				}
				break;
			}
			case 'proposed_plan': {
				const id = str(ev.id);
				const plan = { kind: 'plan' as const, id, title: str(ev.title), text: str(ev.markdown), status: planStatus(ev.status) };
				const known = this.messages.find((m) => m.kind === 'plan' && m.id === id);
				if (known?.kind === 'plan') Object.assign(known, plan);
				else {
					this.#collapseReasoning();
					this.#closeSegment(Date.now());
					this.messages.push(plan);
				}
				if (plan.status !== 'pending' && this.planRevising === id) this.planRevising = null;
				break;
			}
			case 'background_tasks': {
				const before = new Map(this.bgTasks.map((x) => [x.id, x.message]));
				this.bgTasks = arr<Record<string, unknown>>(ev.tasks).map((x) => ({
					id: str(x.id),
					kind: str(x.kind),
					description: str(x.description),
					message: before.get(str(x.id)) ?? ''
				}));
				break;
			}
			case 'task_progress': {
				const task = this.bgTasks.find((x) => x.id === str(ev.task_id));
				if (task) task.message = str(ev.message);
				break;
			}
			case 'task_done':
				this.messages.push({
					kind: 'system',
					text: t('chat.taskDone', {
						kind: taskKindLabel(str(ev.kind)),
						status: t(`chat.taskStatus.${['completed', 'failed', 'stopped'].includes(str(ev.status)) ? str(ev.status) : 'completed'}`),
						summary: str(ev.summary)
					})
				});
				break;
			case 'task_output':
				this.taskOutputs[str(ev.task_id)] = {
					output: boundedOutput(str(ev.output)),
					truncated: ev.truncated === true,
					error: str(ev.error)
				};
				break;
			case 'side_answer': {
				const q = str(ev.question);
				const entry = this.sideAnswers.find((x) => x.pending && x.question === q);
				const answer = { question: q, answer: str(ev.answer), error: str(ev.error), pending: false };
				if (entry) Object.assign(entry, answer);
				else this.sideAnswers.push(answer);
				break;
			}
			case 'prompt_suggestion':
				this.suggestion = str(ev.text);
				break;
			case 'model_fallback':
				this.messages.push({
					kind: 'system',
					text: t('chat.modelFallback', { from: str(ev.from), to: str(ev.to), reason: fallbackReason(str(ev.reason)) })
				});
				break;
			case 'agent_runs': {
				this.agentRunsSeen = true;
				const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
				this.agentRuns = {
					workflows: arr<Record<string, unknown>>(ev.workflows).map((w) => {
						const run = {
							id: str(w.id),
							toolUseId: str(w.tool_use_id),
							name: str(w.name),
							description: str(w.description),
							status: str(w.status),
							startedAt: n(w.started_at),
							durationMs: n(w.duration_ms),
							tokens: n(w.tokens),
							toolCalls: n(w.tool_calls),
							phases: arr<Record<string, unknown>>(w.phases).map((p) => ({ index: n(p.index), title: str(p.title) })),
							agents: arr<Record<string, unknown>>(w.agents).map(agentRun)
						};
						// A Workflow that ended leaves its agents at their last reported
						// state (the engine updates the run only): they are not running.
						// Completed, it ran them to the end; stopped or failed, not.
						const end = runState(run.status);
						if (end !== 'running')
							for (const a of run.agents) if (['running', 'queued'].includes(runState(a.state))) a.state = end === 'done' ? 'completed' : 'stopped';
						return run;
					}),
					agents: arr<Record<string, unknown>>(ev.agents).map(agentRun)
				};
				// The run list is the engine's own: a subagent it says ended has
				// ended, though its lifecycle event never came (a reconnect, a
				// restarted engine).
				for (const a of this.agentRuns.agents) {
					const life = this.subagents[a.id];
					if (!life || life.endedAt || !a.state || ['running', 'queued'].includes(runState(a.state))) continue;
					this.subagents[a.id] = { ...life, status: a.state, endedAt: Date.now() };
					if (life.label) this.#finishAgentTools(life.label);
				}
				break;
			}
			case 'subagent_transcript': {
				const items = arr<Record<string, unknown>>(ev.items);
				// The first user item is the subagent's task; the rest is its work.
				const task = items[0] && str(items[0].role) === 'user' ? str(items[0].content) : '';
				const messages = items
					.slice(task ? 1 : 0)
					.map((it): Msg | null => {
						const role = str(it.role);
						if (role === 'assistant') return { kind: 'assistant', text: str(it.content) };
						if (role === 'reasoning') return { kind: 'reasoning', text: str(it.content), collapsed: true };
						if (role === 'user') return { kind: 'system', text: str(it.content) };
						if (role === 'tool')
							return {
								kind: 'tool',
								callId: str(it.call_id),
								name: str(it.name),
								// The call's arguments name what it acted on until its output does.
								output: str(it.output) || (it.input && typeof it.input === 'object' ? JSON.stringify(it.input) : str(it.input)),
								running: it.running === true,
								isError: it.is_error === true
							};
						return null;
					})
					.filter((m): m is Msg => m !== null);
				// Read again every few seconds while the subagent works: the
				// messages already shown stay the same objects, so their rows
				// stay (and a reasoning block the reader opened stays open).
				const shown = this.subagentTranscripts[str(ev.agent_id)]?.messages ?? [];
				const kept = messages.map((m, i) => {
					const old = shown[i];
					if (!old || old.kind !== m.kind || (m.kind === 'tool' && old.kind === 'tool' && (old.callId !== m.callId || old.name !== m.name))) return m;
					if (m.kind === 'reasoning' && old.kind === 'reasoning') m.collapsed = old.collapsed;
					Object.assign(old, m);
					return old;
				});
				this.subagentTranscripts[str(ev.agent_id)] = { task, messages: kept, error: str(ev.error) };
				break;
			}
			case 'permission_rules':
				this.permissionRules = {
					rules: arr<Record<string, unknown>>(ev.rules).map((r) => ({
						behavior: str(r.behavior),
						source: str(r.source),
						rule: str(r.rule),
						editability: str(r.editability)
					})),
					directories: arr<Record<string, unknown>>(ev.directories).map((d) => ({ path: str(d.path), source: str(d.source) }))
				};
				break;
			case 'plan_usage': {
				const windows = arr<Record<string, unknown>>(ev.windows)
					.filter((w) => typeof w.used === 'number')
					.map((w) => ({
						key: str(w.key),
						used: w.used as number,
						resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null,
						minutes: typeof w.minutes === 'number' ? w.minutes : null
					}));
				this.planUsage = windows.length ? { plan: typeof ev.plan === 'string' ? ev.plan : null, windows } : null;
				break;
			}
			case 'rate_limit': {
				const level = ev.level === 'limited' ? 'limited' : ev.level === 'warning' ? 'warning' : null;
				if (!level) {
					this.rateLimit = null; // limit cleared → drop the banner
					break;
				}
				const resetsAt = typeof ev.resets_at === 'number' && ev.resets_at > 0 ? ev.resets_at : null;
				this.rateLimit = {
					level,
					message: str(ev.message),
					resetsAt,
					window: str(ev.window),
					used: typeof ev.used === 'number' ? ev.used : null,
					overage: ev.overage === true
				};
				break;
			}
			case 'connecting':
				this.engineState = 'connecting';
				this.suggestion = '';
				this.#startTurn();
				// A snapshot's, of the turn this chat was timing: its request
				// goes on, timed from when it began.
				if (!(rejoinedTurn && this.call)) this.#requestStarted();
				// Without the model's answer reported, the wait is for the first token.
				if (this.#sending?.state === 'sending') this.#setSend(ANSWER_REPORTED.has(this.backendId) ? 'connecting' : 'waiting');
				break;
			case 'compaction_start':
				this.engineState = 'compacting';
				this.compactionTokens = 0;
				break;
			case 'status': {
				const msg = str(ev.message);
				if (msg === 'interrupted') this.#stopped = true;
				const m = msg.match(/^(?:new|resumed) session (\S+)/);
				if (m) this.sessionId = m[1];
				this.engineState = msg;
				// A status event with no error means the (possibly just-restarted) engine
				// is healthy again, so clear the crash auto-restart budget. This replaces
				// the old time-window reset, which cleared the counter merely because 30s
				// had elapsed even if every attempt had crashed.
				if (!ev.error) {
					this.restarts = 0;
					this.restartWindowStart = null;
					this.daemonRetries = 0;
				}
				if (!this.busy) {
					this.retry = null;
					// A turn ended without an error: a later failure is a new one,
					// with its own automatic retries.
					if (this.#turnStart !== null) this.autoRetries = 0;
					this.#endTurn();
					this.#resetCurrent();
					this.pendingApproval = null;
					// Safety net: a lost tool_output (e.g. a subagent frame whose
					// tool_result never mapped) would otherwise leave a card spinning
					// forever — the turn is over, so nothing is still running.
					this.#finishStuckTools();
				}
				break;
			}
			case 'mcp_servers':
				this.mcpServers = parseMcpServersEvent(ev);
				break;
			case 'info':
				this.messages.push({ kind: 'system', text: str(ev.message) });
				break;
			// Nobody was watching this hosted session, so a gated call was
			// recorded for the desk instead of prompting here.
			case 'action_deferred':
				this.messages.push({
					kind: 'system',
					text: t('chat.actionDeferred', { name: str(ev.name), summary: str(ev.summary) })
				});
				break;
			case 'action_decided':
				this.messages.push({
					kind: 'system',
					text: t(ev.decision === 'allow' ? 'chat.actionAllowed' : 'chat.actionDenied', {
						id: str(ev.id)
					})
				});
				break;
			case 'error': {
				// An engine without the agent trace refuses its ops: nothing failed.
				const refused = /^unknown op: (agent_runs|subagent_transcript|context_usage)$/.exec(str(ev.message));
				if (refused) {
					if (refused[1] === 'context_usage') this.contextBreakdown = { error: str(ev.message) };
					if (refused[1] === 'subagent_transcript' && this.agentFocus && !this.subagentTranscripts[this.agentFocus])
						this.subagentTranscripts[this.agentFocus] = { task: '', messages: [], error: t('dock.agents.noTranscript') };
					break;
				}
				this.retry = null;
				// A turn was being sent or run (not, say, a refused command).
				const started = this.#turnStart !== null;
				const inTurn = started || this.#sending !== null;
				const last = this.messages[this.messages.length - 1];
				this.lastError = str(ev.message);
				this.pendingApproval = null;
				this.#setSend('failed');
				this.#sending = null;
				// The engines can report one failure twice (the item, then the turn).
				if (!(last?.kind === 'error' && last.text === str(ev.message)))
					this.messages.push({ kind: 'error', text: str(ev.message) });
				this.#endTurn();
				this.#resetCurrent();
				if (inTurn) ChatState.onTurnFailed?.(this, str(ev.message), started);
				break;
			}
		}
	}
}
