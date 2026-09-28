// The long-lived agents hosted by the local `jucode daemon`, kept current
// from its `agents` / `sessions` broadcasts. Only active while the
// background service setting is on.

import { daemon } from './protocol';

export interface AgentView {
	id: string;
	name: string;
	cwd: string;
	enabled: boolean;
	approval_mode: string;
	/** First line of the agent's role. */
	summary: string;
	sessions: number;
	/** One of its sessions is running or has queued messages. */
	busy: boolean;
	sandbox: 'read-only' | 'workspace-write' | 'full-access';
	network: boolean;
	directories: { path: string; mode: 'ro' | 'rw' }[];
	command_rules: { prefix: string; action: 'allow' | 'ask' | 'forbid' }[];
}

/** Settings `agent_update` accepts; omitted fields stay as they are. */
export type AgentChanges = Partial<
	Pick<
		AgentView,
		'name' | 'enabled' | 'approval_mode' | 'sandbox' | 'network' | 'directories' | 'command_rules'
	>
>;

export interface DaemonSessionView {
	session: string;
	cwd: string;
	agent?: string | null;
	created_at: number;
	open: boolean;
}

export interface QuestionView {
	id: string;
	agent: string;
	session: string;
	title: string;
	body: string;
	assumption: string;
	default: string;
	importance: 'low' | 'normal' | 'high';
	due_at: number | null;
	asked_at: number;
}

export interface ActionView {
	id: string;
	session_id: string;
	cwd: string;
	name: string;
	arguments: string;
	summary: string;
	created_at: number;
}

export interface ReportView {
	id: string;
	agent: string;
	session: string;
	title: string;
	body: string;
	at: number;
	read: boolean;
}

export interface AgentDetail {
	agent: AgentView;
	brief: Record<string, string>;
	memory: string[];
	sessions: DaemonSessionView[];
}

export interface NewAgent {
	id: string;
	name: string;
	cwd: string;
	role: string;
}

const RETRY_MS = 5000;

export class AgentDirectory {
	agents = $state<AgentView[]>([]);
	sessions = $state<DaemonSessionView[]>([]);
	questions = $state<QuestionView[]>([]);
	actions = $state<ActionView[]>([]);
	reports = $state<ReportView[]>([]);
	/** Items waiting for the user: open questions and pending actions. */
	pending = $derived(this.questions.length + this.actions.length);
	/** `off` until started; `unreachable` while the daemon cannot be reached. */
	status = $state<'off' | 'connecting' | 'on' | 'unreachable'>('off');
	error = $state('');
	#retry: ReturnType<typeof setInterval> | null = null;

	/** Connects now and keeps reconnecting while the daemon is unreachable. */
	start() {
		if (this.#retry) return;
		void this.#connect();
		this.#retry = setInterval(() => {
			if (this.status === 'unreachable') void this.#connect();
		}, RETRY_MS);
	}

	stop() {
		if (this.#retry) clearInterval(this.#retry);
		this.#retry = null;
		this.status = 'off';
	}

	/** A daemon-wide frame (wired to `daemon.onEvent`). */
	handle(frame: Record<string, unknown>) {
		if (frame.type === 'agents' && Array.isArray(frame.agents)) {
			this.agents = frame.agents as AgentView[];
			// A new agent session changes the counts; refresh which sessions exist.
			void this.refreshSessions();
		} else if (frame.type === 'sessions' && Array.isArray(frame.sessions)) {
			this.sessions = frame.sessions as DaemonSessionView[];
		} else if (frame.type === 'message_delivered') {
			void this.refreshSessions();
		} else if (frame.type === 'questions' && Array.isArray(frame.questions)) {
			this.questions = frame.questions as QuestionView[];
		} else if (frame.type === 'actions' && Array.isArray(frame.actions)) {
			this.actions = frame.actions as ActionView[];
		} else if (frame.type === 'report_posted' && frame.report) {
			this.reports = [frame.report as ReportView, ...this.reports];
		}
	}

	agentName(id: string): string {
		return this.agents.find((a) => a.id === id)?.name ?? id;
	}

	/** Which agent a daemon session belongs to. */
	agentOfSession(session: string): AgentView | undefined {
		const agent = this.sessions.find((s) => s.session === session)?.agent;
		return this.agents.find((a) => a.id === agent);
	}

	async answer(question: string, answer: string) {
		await daemon.request({ op: 'question_answer', question, answer });
	}

	/** Allow or deny a pending action; the daemon reopens its session if
	 *  needed. The updated `actions` list arrives as a broadcast. */
	async decide(action: ActionView, allow: boolean) {
		await daemon.post({
			op: 'decide_action',
			session: action.session_id,
			action: action.id,
			decision: allow ? 'allow' : 'deny'
		});
		this.actions = this.actions.filter((a) => a.id !== action.id);
	}

	async loadReports() {
		const reply = await daemon.request({ op: 'report_list', limit: 50 });
		if (Array.isArray(reply.reports)) this.reports = reply.reports as ReportView[];
	}

	async markRead(report: ReportView) {
		if (report.read) return;
		this.reports = this.reports.map((r) => (r.id === report.id ? { ...r, read: true } : r));
		await daemon.request({ op: 'report_read', report: report.id });
	}

	async detail(agent: string): Promise<AgentDetail> {
		return (await daemon.request({ op: 'agent_get', agent })) as unknown as AgentDetail;
	}

	async update(agent: string, changes: AgentChanges): Promise<AgentView> {
		const reply = await daemon.request({ op: 'agent_update', agent, ...changes });
		return reply.agent as AgentView;
	}

	disconnected() {
		if (this.status !== 'off') this.status = 'unreachable';
	}

	/** The agent's most recently created session, if it has one. */
	latestSession(agentId: string): DaemonSessionView | undefined {
		return this.sessions
			.filter((s) => s.agent === agentId)
			.reduce<DaemonSessionView | undefined>(
				(latest, s) => (!latest || s.created_at > latest.created_at ? s : latest),
				undefined
			);
	}

	async create(agent: NewAgent): Promise<AgentView> {
		// `id` is the request id on the wire; the agent's id travels as `agent`.
		const reply = await daemon.request({
			op: 'agent_create',
			agent: agent.id,
			name: agent.name,
			cwd: agent.cwd,
			role: agent.role
		});
		return reply.agent as AgentView;
	}

	async refreshSessions() {
		try {
			const reply = await daemon.request({ op: 'session_list' });
			if (Array.isArray(reply.sessions)) this.sessions = reply.sessions as DaemonSessionView[];
		} catch {
			/* disconnected: the next connect sends the list again */
		}
	}

	async #connect() {
		this.status = 'connecting';
		try {
			await daemon.connect();
			this.status = 'on';
			this.error = '';
			await this.loadReports();
		} catch (e) {
			this.status = 'unreachable';
			this.error = String(e);
		}
	}
}

export const agentDirectory = new AgentDirectory();
