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
}

export interface DaemonSessionView {
	session: string;
	cwd: string;
	agent?: string | null;
	created_at: number;
	open: boolean;
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
		}
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
		} catch (e) {
			this.status = 'unreachable';
			this.error = String(e);
		}
	}
}

export const agentDirectory = new AgentDirectory();
