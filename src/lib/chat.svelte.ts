import type { AgentEvent } from './protocol';

export type Msg =
	| { kind: 'user'; text: string }
	| { kind: 'assistant'; text: string }
	| { kind: 'reasoning'; text: string }
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

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** Reactive chat state projected from the engine's AgentEvent stream. */
export class ChatState {
	messages = $state<Msg[]>([]);
	provider = $state('');
	model = $state('');
	cwd = $state('');
	engineState = $state('starting');
	contextTokens = $state(0);
	contextWindow = $state(0);
	cost = $state(0);
	pending = $state(0);
	picker = $state<Picker>(null);
	title = $state('New session');
	pendingFill = $state<string | null>(null);
	trustPrompt = $state<{ cwd: string; repoRoot: string | null } | null>(null);
	goal = $state<Goal | null>(null);
	subagents = $state<Record<string, { status: string; message: string }>>({});
	commands = $state<CommandItem[]>([]);
	totalIn = $state(0);
	totalOut = $state(0);

	#assistantIdx = -1;
	#reasoningIdx = -1;

	get busy() {
		return ['streaming', 'connecting', 'compacting', 'steering'].includes(this.engineState);
	}

	closePicker() {
		this.picker = null;
	}

	#resetCurrent() {
		this.#assistantIdx = -1;
		this.#reasoningIdx = -1;
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
				this.contextWindow = num(ev.context_window);
				break;
			case 'model_status':
				this.provider = str(ev.provider);
				this.model = str(ev.model);
				this.engineState = str(ev.state) || this.engineState;
				this.contextWindow = num(ev.context_window);
				break;
			case 'user_message': {
				const text = str(ev.content);
				this.messages.push({ kind: 'user', text });
				if (this.title === 'New session' && text.trim()) {
					this.title = text.trim().slice(0, 40);
				}
				this.#resetCurrent();
				break;
			}
			case 'assistant_start':
				this.messages.push({ kind: 'assistant', text: '' });
				this.#assistantIdx = this.messages.length - 1;
				break;
			case 'assistant_delta': {
				if (this.#assistantIdx < 0) {
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
					this.messages.push({ kind: 'reasoning', text: '' });
					this.#reasoningIdx = this.messages.length - 1;
				}
				const m = this.messages[this.#reasoningIdx];
				if (m?.kind === 'reasoning') m.text += str(ev.delta);
				break;
			}
			case 'tool_start':
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
				break;
			}
			case 'context_usage':
				this.contextTokens = num(ev.tokens);
				if (typeof ev.cost === 'number') this.cost = ev.cost;
				break;
			case 'pending_messages':
				this.pending = Array.isArray(ev.messages) ? ev.messages.length : 0;
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
			case 'compaction_end':
				this.messages.push({ kind: 'system', text: 'context compacted' });
				break;
			case 'compaction_failed':
				this.messages.push({ kind: 'error', text: `compaction failed: ${str(ev.error)}` });
				break;
			case 'goal':
				this.goal = ev.goal ? (ev.goal as unknown as Goal) : null;
				break;
			case 'command_list':
				this.commands = arr<CommandItem>(ev.commands);
				break;
			case 'usage':
				this.totalIn += num(ev.input_tokens);
				this.totalOut += num(ev.output_tokens);
				break;
			case 'subagent_lifecycle': {
				const path = str(ev.path);
				if (path) this.subagents[path] = { status: str(ev.status), message: str(ev.message) };
				break;
			}
			case 'connecting':
				this.engineState = 'connecting';
				break;
			case 'compaction_start':
				this.engineState = 'compacting';
				this.messages.push({ kind: 'system', text: 'compacting context…' });
				break;
			case 'status':
				this.engineState = str(ev.message);
				if (!this.busy) this.#resetCurrent();
				break;
			case 'info':
				this.messages.push({ kind: 'system', text: str(ev.message) });
				break;
			case 'error':
				this.messages.push({ kind: 'error', text: str(ev.message) });
				this.#resetCurrent();
				break;
		}
	}
}
