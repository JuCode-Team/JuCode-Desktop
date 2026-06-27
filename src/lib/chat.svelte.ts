import type { AgentEvent } from './protocol';
import { EDIT_TOOLS } from './approval';

export type Msg =
	| { kind: 'user'; text: string }
	| { kind: 'assistant'; text: string; tokens?: number; elapsed?: number }
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
	model: string;
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
	messages = $state<Msg[]>([]);
	provider = $state('');
	model = $state('');
	cwd = $state('');
	sessionId = $state('');
	effort = $state('');
	efforts = $state<string[]>([]);
	engineState = $state('starting');
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
	pendingApproval = $state<{ callId: string; name: string; summary: string } | null>(null);
	subagents = $state<Record<string, { status: string; message: string }>>({});
	commands = $state<CommandItem[]>([]);
	totalIn = $state(0);
	totalOut = $state(0);
	unseen = $state(false);
	compactionTokens = $state(0);
	// Files the agent edited this session (drives the Changes panel).
	changedFiles = $state<string[]>([]);
	// Approval policy applied client-side: 'ask' surfaces every gated tool,
	// 'edits' auto-allows file mutations (still asks for shell), 'all' allows
	// everything. The page reads this to auto-respond to approval_request.
	approvalMode = $state<'ask' | 'edits' | 'all'>('ask');
	// A rewind targeted at a specific rendered user message: the page sets this
	// before sending `/rewind`, and the checkpoint_view handler resolves it to a
	// concrete turn id (positional: the i-th user turn matches the i-th user message).
	rewindIntent: { userIndex: number; text: string } | null = null;
	pendingRewind = $state<{ id: string; text: string } | null>(null);

	// Engine crash auto-restart bookkeeping (driven by the page on agent-exit).
	restarts = 0;
	restartWindowStart: number | null = null;
	// Set while an intentional provider-switch restart is in flight, so the exit it
	// causes isn't treated as a crash to auto-restart.
	switching = false;

	#assistantIdx = -1;
	#reasoningIdx = -1;
	#turnStart: number | null = null;
	#pendingUserEcho: string | null = null;

	constructor() {
		try {
			const saved = localStorage.getItem('jucode-approval-mode');
			if (saved === 'edits' || saved === 'all') this.approvalMode = saved;
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

	#tool(callId: string): Extract<Msg, { kind: 'tool' }> | undefined {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'tool' && m.callId === callId) return m;
		}
		return undefined;
	}

	handle(ev: AgentEvent) {
		switch (ev.type) {
			case 'startup':
				this.model = str(ev.model);
				this.cwd = str(ev.cwd);
				if (str(ev.session_id)) this.sessionId = str(ev.session_id);
				this.contextWindow = num(ev.context_window);
				break;
			case 'model_status':
				this.provider = str(ev.provider);
				this.model = str(ev.model);
				this.effort = str(ev.reasoning_effort);
				this.efforts = arr<string>(ev.reasoning_efforts);
				this.engineState = str(ev.state) || this.engineState;
				this.contextWindow = num(ev.context_window);
				this.contextLimit = num(ev.context_limit);
				break;
			case 'user_message': {
				const text = str(ev.content);
				// Skip the echo of a message we already showed optimistically.
				const last = this.messages[this.messages.length - 1];
				if (this.#pendingUserEcho === text && last?.kind === 'user' && last.text === text) {
					this.#pendingUserEcho = null;
					this.#resetCurrent();
					break;
				}
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
				this.messages.push({
					kind: 'tool',
					callId: str(ev.call_id),
					name: str(ev.name),
					output: '',
					running: true,
					isError: false
				});
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
				// Record files touched by a successful edit tool for the Changes panel.
				if (ev.is_error !== true && EDIT_TOOLS.includes(str(ev.name))) {
					try {
						const out = JSON.parse(str(ev.output)) as Record<string, unknown>;
						const paths = [out.path, ...(Array.isArray(out.paths) ? out.paths : [])];
						for (const p of paths) {
							if (typeof p === 'string' && p && !this.changedFiles.includes(p)) this.changedFiles.push(p);
						}
					} catch {
						/* non-JSON output */
					}
				}
				break;
			}
			case 'context_usage':
				this.contextTokens = num(ev.tokens);
				if (typeof ev.cost === 'number') this.cost = ev.cost;
				break;
			case 'pending_messages':
				this.pendingMessages = arr<string>(ev.messages);
				break;
			case 'tree_view':
				this.picker = { kind: 'tree', nodes: arr<TreeNode>(ev.nodes) };
				break;
			case 'model_view':
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
					summary: str(ev.summary)
				};
				break;
			case 'command_list':
				this.commands = arr<CommandItem>(ev.commands);
				break;
			case 'usage': {
				const out = num(ev.output_tokens);
				this.totalIn += num(ev.input_tokens);
				this.totalOut += out;
				if (this.#assistantIdx >= 0) {
					const m = this.messages[this.#assistantIdx];
					if (m?.kind === 'assistant') m.tokens = (m.tokens ?? 0) + out;
				}
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
				if (!this.busy) {
					this.#endTurn();
					this.#resetCurrent();
					this.pendingApproval = null;
				}
				break;
			}
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
