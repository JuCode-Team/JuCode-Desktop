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

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** Reactive chat state projected from the engine's AgentEvent stream. */
export class ChatState {
	messages = $state<Msg[]>([]);
	provider = $state('');
	model = $state('');
	engineState = $state('starting');
	contextTokens = $state(0);
	contextWindow = $state(0);
	cost = $state(0);
	pending = $state(0);
	picker = $state<Picker>(null);

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
				this.contextWindow = num(ev.context_window);
				this.messages.push({ kind: 'system', text: `jucode ${str(ev.version)} · ${str(ev.cwd)}` });
				break;
			case 'model_status':
				this.provider = str(ev.provider);
				this.model = str(ev.model);
				this.engineState = str(ev.state) || this.engineState;
				this.contextWindow = num(ev.context_window);
				break;
			case 'user_message':
				this.messages.push({ kind: 'user', text: str(ev.content) });
				this.#resetCurrent();
				break;
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
