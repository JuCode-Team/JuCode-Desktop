import type { AgentEvent } from './protocol';
import type { BackendId } from './backends/types';
import {
	EDIT_TOOLS,
	parseHunks,
	parseQuestions,
	reconcileMode,
	toEngineMode,
	type ApprovalHunk,
	type ApprovalMode,
	type EngineApprovalMode,
	type Question
} from './approval';
import { recordUsage } from './usageStats';
import { costUsd } from './pricing';
import { parseMcpServersEvent, type McpServerView } from './mcp';

export type Msg =
	| { kind: 'user'; text: string }
	| { kind: 'assistant'; text: string; tokens?: number; elapsed?: number; uuid?: string }
	| { kind: 'reasoning'; text: string; collapsed: boolean }
	| { kind: 'tool'; callId: string; name: string; output: string; running: boolean; isError: boolean }
	| { kind: 'system'; text: string }
	| { kind: 'error'; text: string };

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
	| { kind: 'resume'; items: ResumeItem[] }
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

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** Reactive chat state projected from the engine's AgentEvent stream. */
export class ChatState {
	/** Set by the page: invoked when the agent's `browser_open` tool succeeds,
	 *  so the embedded browser panel navigates to the requested URL. Static —
	 *  there's one browser panel regardless of which session's agent asked. */
	static onBrowserOpen: ((url: string) => void) | null = null;

	/** Set by the page: invoked with the file paths a successful edit tool
	 *  touched, so the built-in editor can auto-reload open tabs (⌘K flow). */
	static onFilesEdited: ((paths: string[]) => void) | null = null;

	/** Which engine backend drives this session ('jucode' default). Set once at
	 *  session creation; the `caps()` helper gates UI surfaces off it. */
	backendId: BackendId = 'jucode';

	messages = $state<Msg[]>([]);
	provider = $state('');
	model = $state('');
	/** Compact display name for `model` when a backend provides one (claude's
	 *  "Opus 4.8 (1M)"); falls back to `model` in the UI when empty. */
	modelLabel = $state('');
	cwd = $state('');
	sessionId = $state('');
	effort = $state('');
	efforts = $state<string[]>([]);
	engineState = $state('starting');
	// True from session creation until the engine emits its first event — i.e.
	// while the claude/codex/jucode child is still booting. Drives the spawn
	// loading animation in the empty chat area.
	booting = $state(true);
	// Last model catalog seen (from a `model_view`), so the picker popover can open
	// instantly from cache while a fresh `/model` round-trip refreshes it.
	modelCatalog = $state<ModelOption[]>([]);
	modelCatalogEffort = $state('');
	// File-checkpoint sha captured just before each user turn (index = turn), so a
	// rewind can restore the working tree to that turn's state (codex/claude, where
	// the engine only rewinds the conversation, not files).
	fileCheckpoints = $state<Record<number, string>>({});
	contextTokens = $state(0);
	contextWindow = $state(0);
	contextLimit = $state(0);
	cost = $state(0);
	pendingMessages = $state<string[]>([]);
	picker = $state<Picker>(null);
	title = $state('New session');
	pendingFill = $state<string | null>(null);
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
	} | null>(null);
	subagents = $state<Record<string, { status: string; message: string }>>({});
	commands = $state<CommandItem[]>([]);
	totalIn = $state(0);
	totalOut = $state(0);
	unseen = $state(false);
	compactionTokens = $state(0);
	// Files the agent edited this session (drives the Changes panel).
	changedFiles = $state<string[]>([]);
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
	restarts = 0;
	restartWindowStart: number | null = null;
	// Set when a claude --resume target isn't found: the next restart must NOT
	// resume the same doomed id (it would crash-loop). One-shot — consumed by the
	// store's restartSession, which then comes up fresh.
	resumeBroken = false;
	// Set while an intentional provider-switch restart is in flight, so the exit it
	// causes isn't treated as a crash to auto-restart.
	switching = false;

	#assistantIdx = -1;
	#reasoningIdx = -1;
	// Set once the engine reports an authoritative cost (jucode via context_usage).
	// While false we estimate cost client-side from token usage × model pricing
	// (claude/codex don't report cost).
	#engineCost = false;
	#turnStart: number | null = null;
	#pendingUserEcho: string | null = null;
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
		this.approvalMode = mode;
		try {
			localStorage.setItem('jucode-approval-mode', mode);
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** Show a just-sent user message immediately, before the engine echoes it.
	 *  The echo is de-duplicated in the `user_message` handler. */
	optimisticUser(content: string) {
		this.messages.push({ kind: 'user', text: content });
		this.#pendingUserEcho = content;
		if (this.title === 'New session' && content.trim()) this.title = content.trim().slice(0, 40);
		this.#resetCurrent();
	}

	/** Stamp the turn's total elapsed onto its last assistant message. */
	#endTurn() {
		this.#collapseReasoning();
		if (this.#turnStart === null) return;
		const elapsed = Date.now() - this.#turnStart;
		this.#turnStart = null;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'assistant') {
				m.elapsed = elapsed;
				break;
			}
		}
	}

	get busy() {
		return ['streaming', 'connecting', 'compacting', 'steering'].includes(this.engineState);
	}

	/** Meta/status notices (retrying, compaction, stderr, engine warnings, restart
	 *  notices) — kept out of the conversation bubble stream and shown in the
	 *  collapsible status strip instead. Real conversation (user/assistant/
	 *  reasoning/tool) and errors stay inline. */
	get statusLog(): string[] {
		const out: string[] = [];
		for (const m of this.messages) if (m.kind === 'system') out.push(m.text);
		return out;
	}

	/** Number of user turns in the transcript (one per sent message). */
	get userTurns() {
		return this.messages.filter((m) => m.kind === 'user').length;
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
	 *  so `/resume <id>` would fail with "No such file". Gates restart/switch resume
	 *  and which tabs get persisted. */
	get resumable() {
		return this.sessionId !== '' && this.messages.some((m) => m.kind === 'user');
	}

	/** The activity phase shown by the bottom indicator. O(1) — checks the last message. */
	get phase(): 'connecting' | 'waiting' | 'generating' | 'tool' | 'compacting' | null {
		if (this.engineState === 'compacting') return 'compacting';
		if (!this.busy) return null;
		const last = this.messages[this.messages.length - 1];
		if (last?.kind === 'tool') return last.running ? 'tool' : 'waiting';
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
			if (m.kind === 'tool' && m.running) m.running = false;
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

	handle(ev: AgentEvent) {
		// The engine has spoken — the child is up, so the boot animation ends.
		this.booting = false;
		switch (ev.type) {
			case 'startup':
				this.model = str(ev.model);
				this.cwd = str(ev.cwd);
				if (str(ev.session_id)) this.sessionId = str(ev.session_id);
				this.contextWindow = num(ev.context_window);
				// A fresh engine incarnation (first start, crash auto-restart or
				// provider switch) announces its approval mode next — re-arm the
				// startup sync so the desktop's persisted mode is pushed again.
				this.#modeSynced = false;
				break;
			case 'approval_mode': {
				const engineMode = str(ev.mode);
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
				this.provider = str(ev.provider);
				this.model = str(ev.model);
				this.modelLabel = str(ev.model_label);
				this.effort = str(ev.reasoning_effort);
				this.efforts = arr<string>(ev.reasoning_efforts);
				this.engineState = str(ev.state) || this.engineState;
				this.contextWindow = num(ev.context_window);
				this.contextLimit = num(ev.context_limit);
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
				this.messages.push({ kind: 'user', text });
				if (this.title === 'New session' && text.trim()) {
					this.title = text.trim().slice(0, 40);
				}
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
				if (this.#assistantIdx < 0) {
					this.#collapseReasoning();
					this.messages.push({ kind: 'assistant', text: '' });
					this.#assistantIdx = this.messages.length - 1;
				}
				const m = this.messages[this.#assistantIdx];
				if (m?.kind === 'assistant') m.text += str(ev.delta);
				break;
			}
			case 'thinking_start':
				break;
			case 'reasoning_delta': {
				if (this.#reasoningIdx < 0) {
					this.messages.push({ kind: 'reasoning', text: '', collapsed: false });
					this.#reasoningIdx = this.messages.length - 1;
				}
				const m = this.messages[this.#reasoningIdx];
				if (m?.kind === 'reasoning') m.text += str(ev.delta);
				break;
			}
			case 'tool_start':
				// One reasoning block per round: collapse this round's reasoning once
				// its tool call appears, so the next round starts a fresh block.
				this.#collapseReasoning();
				{
					const callId = str(ev.call_id);
					const toolMsg: Extract<Msg, { kind: 'tool' }> = {
						kind: 'tool',
						callId,
						name: str(ev.name),
						output: '',
						running: true,
						isError: false
					};
					this.messages.push(toolMsg);
					if (callId) this.#toolsByCallId.set(callId, toolMsg);
				}
				break;
			case 'tool_update': {
				const t = this.#tool(str(ev.call_id));
				if (t) t.output = str(ev.output);
				break;
			}
			case 'tool_output': {
				const t = this.#tool(str(ev.call_id));
				if (t) {
					t.output = str(ev.output);
					t.running = false;
					t.isError = ev.is_error === true;
				}
				// A successful browser_open acknowledgement carries the URL the agent
				// wants shown — drive the embedded browser panel.
				if (ev.is_error !== true && str(ev.name) === 'browser_open') {
					try {
						const out = JSON.parse(str(ev.output)) as Record<string, unknown>;
						if (typeof out.url === 'string' && out.url) ChatState.onBrowserOpen?.(out.url);
					} catch {
						/* non-JSON output */
					}
				}
				// Record files touched by a successful edit tool for the Changes panel.
				if (ev.is_error !== true && EDIT_TOOLS.includes(str(ev.name))) {
					try {
						const out = JSON.parse(str(ev.output)) as Record<string, unknown>;
						const paths = [out.path, ...(Array.isArray(out.paths) ? out.paths : [])];
						const edited: string[] = [];
						for (const p of paths) {
							if (typeof p === 'string' && p) {
								edited.push(p);
								if (!this.changedFiles.includes(p)) this.changedFiles.push(p);
							}
						}
						if (edited.length) ChatState.onFilesEdited?.(edited);
					} catch (e) {
						/* non-JSON output */
						console.warn('tool_output JSON parse failed', e);
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
			case 'context_usage':
				this.contextTokens = num(ev.tokens);
				if (typeof ev.cost === 'number') {
					this.cost = ev.cost;
					this.#engineCost = true;
				}
				break;
			case 'pending_messages':
				this.pendingMessages = arr<string>(ev.messages);
				break;
			case 'tree_view':
				this.picker = { kind: 'tree', nodes: arr<TreeNode>(ev.nodes) };
				break;
			case 'model_view':
				this.modelCatalog = arr<ModelOption>(ev.models);
				this.modelCatalogEffort = str(ev.active_effort);
				this.picker = {
					kind: 'model',
					models: arr<ModelOption>(ev.models),
					activeEffort: str(ev.active_effort)
				};
				break;
			case 'resume_view':
				this.picker = { kind: 'resume', items: arr<ResumeItem>(ev.items) };
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
				const items = arr<Record<string, unknown>>(ev.items);
				// The message array is reassigned wholesale below and restored tool
				// entries carry no call_id, so the fast-lookup map is now stale — clear
				// it and let #tool() fall back to scanning.
				this.#toolsByCallId.clear();
				this.messages = items
					.map((it): Msg | null => {
						const role = str(it.role);
						if (role === 'user') return { kind: 'user', text: str(it.content) };
						if (role === 'assistant') return { kind: 'assistant', text: str(it.content) };
						if (role === 'tool')
							return {
								kind: 'tool',
								callId: '',
								name: str(it.name),
								output: str(it.output),
								running: false,
								isError: false
							};
						if (role === 'branch') return { kind: 'system', text: `branch: ${str(it.label)}` };
						return null;
					})
					.filter((m): m is Msg => m !== null);
				if (this.title === 'New session') {
					const firstUser = this.messages.find((m) => m.kind === 'user');
					if (firstUser && firstUser.kind === 'user' && firstUser.text.trim())
						this.title = firstUser.text.trim().slice(0, 40);
				}
				this.#resetCurrent();
				break;
			}
			case 'fill_input':
				this.pendingFill = str(ev.content);
				break;
			case 'trust_prompt':
				this.trustPrompt = {
					cwd: str(ev.cwd),
					repoRoot: typeof ev.repo_root === 'string' ? ev.repo_root : null
				};
				break;
			case 'retrying':
				this.messages.push({ kind: 'system', text: `reconnecting… (attempt ${num(ev.attempt)})` });
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
				this.messages.push({ kind: 'system', text: 'context compacted' });
				break;
			case 'compaction_failed':
				this.messages.push({ kind: 'error', text: `compaction failed: ${str(ev.error)}` });
				break;
			case 'goal':
				this.goal = ev.goal ? (ev.goal as unknown as Goal) : null;
				break;
			case 'plan':
				this.plan = arr<PlanStep>(ev.plan);
				break;
			case 'approval_request':
				this.pendingApproval = {
					callId: str(ev.call_id),
					name: str(ev.name),
					summary: str(ev.summary),
					subagentId: typeof ev.subagent_id === 'string' && ev.subagent_id ? ev.subagent_id : null,
					hunks: parseHunks(ev.hunks),
					questions: parseQuestions(ev.questions)
				};
				break;
			case 'command_list':
				this.commands = arr<CommandItem>(ev.commands);
				break;
			case 'usage': {
				const out = num(ev.output_tokens);
				const inn = num(ev.input_tokens);
				this.totalIn += inn;
				this.totalOut += out;
				// Estimate cost from tokens when the engine doesn't report it itself.
				if (!this.#engineCost) this.cost += costUsd(this.model, inn, out);
				recordUsage(inn, out, this.provider);
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
				if (path) this.subagents[path] = { status: str(ev.status), message: str(ev.message) };
				break;
			}
			case 'connecting':
				this.engineState = 'connecting';
				if (this.#turnStart === null) this.#turnStart = Date.now();
				break;
			case 'compaction_start':
				this.engineState = 'compacting';
				this.compactionTokens = 0;
				break;
			case 'status': {
				const msg = str(ev.message);
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
				}
				if (!this.busy) {
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
			case 'error':
				this.pendingApproval = null;
				this.messages.push({ kind: 'error', text: str(ev.message) });
				this.#endTurn();
				this.#resetCurrent();
				break;
		}
	}
}
