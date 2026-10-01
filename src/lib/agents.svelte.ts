// The long-lived agents hosted by the local `jucode daemon`, kept current
// from its `agents` / `sessions` / `schedules` broadcasts.

import { daemon as sharedDaemon } from './protocol';
import type { DaemonClient } from './daemon';
import { toWire, upsert, type Schedule, type ScheduleDraft } from './schedules';
import type { TabIcon } from './workbench/tabChrome';

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
	/** Those sessions (older daemons leave it out). */
	running?: string[];
	sandbox: 'read-only' | 'workspace-write' | 'full-access';
	network: boolean;
	directories: { path: string; mode: 'ro' | 'rw' }[];
	command_rules: { prefix: string; action: 'allow' | 'ask' | 'forbid' }[];
	/** Custom icon, as the daemon stored it (unsanitized; see AgentAvatar). */
	icon?: TabIcon | null;
	/** `#rrggbb`. */
	color?: string | null;
	/** Seeds the generated avatar; older agents have none and use the id. */
	avatar_seed?: string;
	/** The workspace it is listed in (see agentWorkspace); older agents have none. */
	workspace?: string;
}

/** The workspace an agent is listed in: its own, else (none yet, or that
 *  workspace is gone) the default one. Listing only: agents run whichever
 *  workspace is open. */
export function agentWorkspace(agent: Pick<AgentView, 'workspace'>, workspaces: { id: string; isDefault?: boolean }[]): string {
	if (agent.workspace && workspaces.some((w) => w.id === agent.workspace)) return agent.workspace;
	return (workspaces.find((w) => w.isDefault) ?? workspaces[0])?.id ?? '';
}

/** The agents listed in workspace `id`. */
export function agentsOfWorkspace<A extends Pick<AgentView, 'workspace'>>(
	agents: A[],
	workspaces: { id: string; isDefault?: boolean }[],
	id: string
): A[] {
	return agents.filter((a) => agentWorkspace(a, workspaces) === id);
}

/** Settings `agent_update` accepts; omitted fields stay as they are.
 *  `role` rewrites its role.md; `icon: null` / `color: null` clear them. */
export type AgentChanges = Partial<
	Pick<
		AgentView,
		| 'name'
		| 'enabled'
		| 'approval_mode'
		| 'sandbox'
		| 'network'
		| 'directories'
		| 'command_rules'
		| 'icon'
		| 'color'
		| 'avatar_seed'
	>
> & { role?: string; workspace?: string | null };

export interface DaemonSessionView {
	session: string;
	cwd: string;
	agent?: string | null;
	created_at: number;
	open: boolean;
	/** The daemon's title, or the engine's label (newer daemons). */
	title?: string | null;
	archived?: boolean;
	/** The JuCode group its gateway requests route to (null: automatic). */
	group?: string | null;
	/** Claude Code / Codex: it last ran through the JuCode gateway. */
	gateway?: boolean;
	updated_at?: number;
	chat?: boolean;
	/** `jucode`, `claude`, `codex` or `acp` (newer daemons). */
	engine?: string;
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

/** One message to an agent, as the daemon logged it: a task from the user, a
 *  scheduled run, a reminder it set, another agent's message or the answer
 *  to one of its questions. */
export interface MessageView {
	id: string;
	agent: string;
	/** `user`, `schedule:<id>`, `timer:<id>`, `agent:<id>` or `question:<id>`. */
	from: string;
	body: string;
	/** ms */
	at: number;
	status: 'pending' | 'delivered' | 'undeliverable';
	/** Where it was delivered. */
	session: string | null;
	/** Why it can't be delivered. */
	reason: string | null;
}

export interface AgentDetail {
	agent: AgentView;
	brief: Record<string, string>;
	memory: string[];
	sessions: DaemonSessionView[];
}

/** A reminder the agent set itself with its `timer` tool. */
export interface TimerView {
	timer: string;
	agent: string;
	session: string;
	/** ms */
	fire_at: number;
	body: string;
}

export interface NewAgent {
	id: string;
	name: string;
	cwd: string;
	role: string;
	/** The avatar previewed while creating it; the daemon picks one without. */
	avatar_seed?: string;
	/** The workspace it is created in. */
	workspace?: string;
}

/** Reconnect backoff: 1 s, doubling to 30 s; reset by a good connection. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** Traffic at least this often keeps a relay stream from being closed as
 *  idle (the relay drops streams after 10 minutes without any). */
const KEEPALIVE_MS = 60_000;

export class AgentDirectory {
	agents = $state<AgentView[]>([]);
	sessions = $state<DaemonSessionView[]>([]);
	questions = $state<QuestionView[]>([]);
	actions = $state<ActionView[]>([]);
	reports = $state<ReportView[]>([]);
	schedules = $state<Schedule[]>([]);
	/** Bumped when an agent's message log changes (a delivery, a report). */
	activity = $state(0);
	/** Items waiting for the user: open questions and pending actions. */
	pending = $derived(this.questions.length + this.actions.length);
	/** `off` until started; `unreachable` while the daemon cannot be reached. */
	status = $state<'off' | 'connecting' | 'on' | 'unreachable'>('off');
	error = $state('');
	#retry: ReturnType<typeof setInterval> | null = null;
	#keepalive: ReturnType<typeof setInterval> | null = null;
	#delay = RETRY_MIN_MS;
	#nextAttempt = 0;
	/** Lists received at least once: later items in them are new arrivals. */
	#seen = new Set<string>();
	/** Called for a new question, pending action or report (the desktop shows
	 *  an OS notification while it is in the background). */
	onArrival: ((kind: 'question' | 'action' | 'report', agent: string, text: string, agentId?: string) => void) | null =
		null;
	#daemon: DaemonClient;

	/** `daemon`: the connection it lists; the app's shared one by default
	 *  (the remote page keeps one directory per paired computer). */
	constructor(daemon: DaemonClient = sharedDaemon) {
		this.#daemon = daemon;
	}

	/** Connects now and keeps reconnecting, with backoff, while the daemon is
	 *  unreachable. */
	start() {
		if (this.#retry) return;
		this.#delay = RETRY_MIN_MS;
		void this.#connect();
		this.#retry = setInterval(() => {
			if (this.status === 'unreachable' && Date.now() >= this.#nextAttempt) void this.#connect();
		}, RETRY_MIN_MS);
		// An older daemon answers `ping` with an error, which is traffic too.
		this.#keepalive = setInterval(() => {
			if (this.status === 'on') this.#daemon.request({ op: 'ping' }).catch(() => {});
		}, KEEPALIVE_MS);
	}

	stop() {
		if (this.#retry) clearInterval(this.#retry);
		if (this.#keepalive) clearInterval(this.#keepalive);
		this.#retry = null;
		this.#keepalive = null;
		this.status = 'off';
	}

	/** A daemon-wide frame (wired to `this.#daemon.onEvent`). */
	handle(frame: Record<string, unknown>) {
		if (frame.type === 'agents' && Array.isArray(frame.agents)) {
			this.agents = frame.agents as AgentView[];
			// A new agent session changes the counts; refresh which sessions exist.
			void this.refreshSessions();
		} else if (frame.type === 'sessions' && Array.isArray(frame.sessions)) {
			this.sessions = frame.sessions as DaemonSessionView[];
		} else if (frame.type === 'message_delivered') {
			this.activity++;
			void this.refreshSessions();
		} else if (frame.type === 'questions' && Array.isArray(frame.questions)) {
			const list = frame.questions as QuestionView[];
			for (const q of this.#arrived('questions', this.questions, list))
				this.onArrival?.('question', this.agentName(q.agent), q.title, q.agent);
			this.questions = list;
		} else if (frame.type === 'actions' && Array.isArray(frame.actions)) {
			const list = frame.actions as ActionView[];
			for (const a of this.#arrived('actions', this.actions, list)) {
				const agent = this.agentOfSession(a.session_id);
				this.onArrival?.('action', agent?.name ?? a.cwd, a.summary || a.name, agent?.id);
			}
			this.actions = list;
		} else if (frame.type === 'report_posted' && frame.report) {
			const report = frame.report as ReportView;
			this.reports = [report, ...this.reports];
			this.activity++;
			this.onArrival?.('report', this.agentName(report.agent), report.title, report.agent);
		} else if (frame.type === 'schedules' && Array.isArray(frame.schedules)) {
			this.schedules = frame.schedules as Schedule[];
		}
	}

	/** Items of `next` not in `prev`; none for the first list of a kind (what
	 *  was already waiting at connect is not new). */
	#arrived<T extends { id: string }>(kind: string, prev: T[], next: T[]): T[] {
		if (!this.#seen.has(kind)) {
			this.#seen.add(kind);
			return [];
		}
		return next.filter((item) => !prev.some((p) => p.id === item.id));
	}

	/** Questions and pending actions of one agent. */
	pendingFor(agent: string): number {
		return (
			this.questions.filter((q) => q.agent === agent).length +
			this.actions.filter((a) => this.agentOfSession(a.session_id)?.id === agent).length
		);
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
		await this.#daemon.request({ op: 'question_answer', question, answer });
	}

	/** Allow or deny a pending action; the daemon reopens its session if
	 *  needed. The updated `actions` list arrives as a broadcast. */
	async decide(action: ActionView, allow: boolean) {
		await this.#daemon.post({
			op: 'decide_action',
			session: action.session_id,
			action: action.id,
			decision: allow ? 'allow' : 'deny'
		});
		this.actions = this.actions.filter((a) => a.id !== action.id);
	}

	async loadReports() {
		const reply = await this.#daemon.request({ op: 'report_list', limit: 50 });
		if (Array.isArray(reply.reports)) this.reports = reply.reports as ReportView[];
	}

	async markRead(report: ReportView) {
		if (report.read) return;
		this.reports = this.reports.map((r) => (r.id === report.id ? { ...r, read: true } : r));
		await this.#daemon.request({ op: 'report_read', report: report.id });
	}

	async detail(agent: string): Promise<AgentDetail> {
		return (await this.#daemon.request({ op: 'agent_get', agent })) as unknown as AgentDetail;
	}

	async update(agent: string, changes: AgentChanges): Promise<AgentView> {
		const reply = await this.#daemon.request({ op: 'agent_update', agent, ...changes });
		return reply.agent as AgentView;
	}

	/** Refused while the agent is working. Its sessions stay; its schedules go. */
	async remove(agent: string) {
		await this.#daemon.request({ op: 'agent_delete', agent });
		this.agents = this.agents.filter((a) => a.id !== agent);
		this.schedules = this.schedules.filter((s) => s.agent !== agent);
	}

	async readMemory(agent: string, file: string): Promise<string> {
		const reply = await this.#daemon.request({ op: 'agent_memory_read', agent, file });
		return String(reply.content ?? '');
	}

	/** The daemon delivers it to the agent's latest session or starts one;
	 *  `newSession` always starts one. */
	/** A new task (in a new session), or with `session` a follow-up there. */
	async message(agent: string, body: string, session?: string) {
		await this.#daemon.request({ op: 'message_send', agent, body, ...(session ? { session } : {}) });
		this.activity++;
	}

	/** The agent's messages, newest first. */
	async messages(agent: string, limit = 50): Promise<MessageView[]> {
		const reply = await this.#daemon.request({ op: 'message_list', agent, limit });
		return (reply.messages ?? []) as MessageView[];
	}

	/** What each of the agent's sessions concluded: session → handoff note. */
	async handoffs(agent: string): Promise<Record<string, string>> {
		const reply = await this.#daemon.request({ op: 'handoff_list', agent });
		const notes = (reply.handoffs ?? []) as { session: string; text: string }[];
		return Object.fromEntries(notes.map((note) => [note.session, note.text]));
	}

	/** The agent's own pending reminders, soonest first. */
	async timers(agent: string): Promise<TimerView[]> {
		const reply = await this.#daemon.request({ op: 'timer_list', agent });
		return ((reply.timers ?? []) as TimerView[])
			.filter((timer) => timer.agent === agent)
			.sort((a, b) => a.fire_at - b.fire_at);
	}

	async loadSchedules() {
		const reply = await this.#daemon.request({ op: 'schedule_list' });
		if (Array.isArray(reply.schedules)) this.schedules = reply.schedules as Schedule[];
	}

	async saveSchedule(draft: ScheduleDraft): Promise<Schedule> {
		const reply = await this.#daemon.request({ op: 'schedule_save', schedule: toWire(draft) });
		const saved = reply.schedule as Schedule;
		this.schedules = upsert(this.schedules, saved);
		return saved;
	}

	async setScheduleEnabled(id: string, enabled: boolean) {
		const reply = await this.#daemon.request({ op: 'schedule_save', schedule: { id, enabled } });
		this.schedules = upsert(this.schedules, reply.schedule as Schedule);
	}

	// The schedule's id travels as `schedule`: `id` is the request id.
	async deleteSchedule(id: string) {
		await this.#daemon.request({ op: 'schedule_delete', schedule: id });
		this.schedules = this.schedules.filter((s) => s.id !== id);
	}

	async runSchedule(id: string) {
		await this.#daemon.request({ op: 'schedule_run', schedule: id });
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
		const reply = await this.#daemon.request({
			op: 'agent_create',
			agent: agent.id,
			name: agent.name,
			cwd: agent.cwd,
			role: agent.role,
			...(agent.avatar_seed ? { avatar_seed: agent.avatar_seed } : {}),
			...(agent.workspace ? { workspace: agent.workspace } : {})
		});
		return reply.agent as AgentView;
	}

	async refreshSessions() {
		try {
			const reply = await this.#daemon.request({ op: 'session_list' });
			if (Array.isArray(reply.sessions)) this.sessions = reply.sessions as DaemonSessionView[];
		} catch {
			/* disconnected: the next connect sends the list again */
		}
	}

	async #connect() {
		this.status = 'connecting';
		try {
			await this.#daemon.connect();
			this.status = 'on';
			this.error = '';
			this.#delay = RETRY_MIN_MS;
			this.#nextAttempt = 0;
			await this.loadReports();
			// An older daemon has no schedules.
			this.loadSchedules().catch(() => {});
		} catch (e) {
			// Stopped while connecting: stay off.
			if (!this.#retry) return;
			this.status = 'unreachable';
			this.error = String(e);
			this.#nextAttempt = Date.now() + this.#delay;
			this.#delay = Math.min(this.#delay * 2, RETRY_MAX_MS);
		}
	}
}

export const agentDirectory = new AgentDirectory();
