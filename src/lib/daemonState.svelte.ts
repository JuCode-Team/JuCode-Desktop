// What the local `jucode daemon` holds beyond each session's own events,
// kept current from its broadcasts: its session list, the deferred actions
// waiting for the user, and the scheduled tasks.

import { daemon as sharedDaemon } from './protocol';
import type { DaemonClient } from './daemon';
import { toWire, upsert, type Schedule, type ScheduleDraft, type ScheduleUsage } from './schedules';

export interface DaemonSessionView {
	session: string;
	cwd: string;
	/** The scheduled task this session is a run of. */
	schedule?: string | null;
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
	/** ACP: the built-in preset it runs (`opencode`, `omp`, `pi`); null for a
	 *  registered agent, which only the desktop can reopen. */
	agent?: string | null;
	/** The id of the project it belongs to (null: none). */
	project?: string | null;
	/** Running a turn (newer daemons; missing: unknown). */
	busy?: boolean;
	/** Background work its turn left going runs: not a turn (newer daemons). */
	background?: boolean;
	/** The session that started it (`start_session`), if one did. */
	parent?: string | null;
	/** The git worktree the daemon made for it (a scheduled run's). */
	worktree?: { repo: string; path: string; branch: string; base: string; slug: string; gone?: boolean } | null;
}

/** A tool call an unwatched session deferred for the user to decide. */
export interface ActionView {
	id: string;
	session_id: string;
	cwd: string;
	name: string;
	arguments: string;
	summary: string;
	created_at: number;
}

/** An action put away undecided: by the user, or by a newer run of its
 *  scheduled task (`superseded`). It can be reopened for 7 days. */
export type Closed<T> = T & { closed_by: string; closed_reason: string; closed_at: number };

/** A scheduled run that needs the user: it failed, waits for an approval,
 *  or a time was skipped while it was still going. */
export interface ScheduleEvent {
	schedule: string;
	name: string;
	kind: 'failed' | 'stopped' | 'waiting' | 'skipped';
	detail: string;
	/** The run's session; empty when it never started. */
	session: string;
}

/** Reconnect backoff: 1 s, doubling to 30 s; reset by a good connection. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** Traffic at least this often keeps a relay stream from being closed as
 *  idle (the relay drops streams after 10 minutes without any). */
const KEEPALIVE_MS = 60_000;

export class DaemonState {
	sessions = $state<DaemonSessionView[]>([]);
	actions = $state<ActionView[]>([]);
	/** Closed lately, newest first. */
	closedActions = $state<Closed<ActionView>[]>([]);
	schedules = $state<Schedule[]>([]);
	/** `off` until started; `unreachable` while the daemon cannot be reached. */
	status = $state<'off' | 'connecting' | 'on' | 'unreachable'>('off');
	error = $state('');
	#retry: ReturnType<typeof setInterval> | null = null;
	#keepalive: ReturnType<typeof setInterval> | null = null;
	#delay = RETRY_MIN_MS;
	#nextAttempt = 0;
	/** The action list arrived at least once: later ones in it are new. */
	#seenActions = false;
	/** A new deferred action (the desktop shows an OS notification while it
	 *  is in the background). */
	onAction: ((action: ActionView) => void) | null = null;
	/** A scheduled run needs the user. */
	onScheduleEvent: ((event: ScheduleEvent) => void) | null = null;
	/** A session stopped running, watched by this client or not. */
	onFinished: ((session: string) => void) | null = null;
	#daemon: DaemonClient;

	/** `daemon`: the connection it follows; the app's shared one by default
	 *  (the remote page keeps one per paired computer). */
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
		if (frame.type === 'sessions' && Array.isArray(frame.sessions)) {
			const list = frame.sessions as DaemonSessionView[];
			const running = new Set(this.sessions.filter((s) => s.busy).map((s) => s.session));
			for (const s of list) if (s.busy === false && running.has(s.session)) this.onFinished?.(s.session);
			this.sessions = list;
		} else if (frame.type === 'actions' && Array.isArray(frame.actions)) {
			const list = frame.actions as ActionView[];
			if (this.#seenActions)
				for (const a of list) if (!this.actions.some((p) => p.id === a.id)) this.onAction?.(a);
			this.#seenActions = true;
			this.actions = list;
			this.closedActions = (Array.isArray(frame.closed) ? frame.closed : []) as Closed<ActionView>[];
		} else if (frame.type === 'schedules' && Array.isArray(frame.schedules)) {
			this.schedules = frame.schedules as Schedule[];
		} else if (frame.type === 'schedule_event') {
			this.onScheduleEvent?.(frame as unknown as ScheduleEvent);
		}
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

	/** Puts an action away undecided. The updated list arrives as a broadcast. */
	async close(action: string) {
		await this.#daemon.request({ op: 'item_close', kind: 'action', item: action });
	}

	/** Brings a closed action back, and its session out of the archive. */
	async reopen(action: string) {
		await this.#daemon.request({ op: 'item_reopen', kind: 'action', item: action });
	}

	async loadSchedules() {
		const reply = await this.#daemon.request({ op: 'schedule_list' });
		if (Array.isArray(reply.schedules)) this.schedules = reply.schedules as Schedule[];
	}

	async scheduleUsage(schedule: string): Promise<ScheduleUsage> {
		return (await this.#daemon.request({ op: 'schedule_usage', schedule })) as unknown as ScheduleUsage;
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

	/** Runs it now; returns the new run's session. */
	async runSchedule(id: string): Promise<string> {
		const reply = await this.#daemon.request({ op: 'schedule_run', schedule: id });
		return String(reply.session ?? '');
	}

	/** The connection dropped: the next attempt waits out the backoff. */
	disconnected() {
		if (this.status === 'off') return;
		this.status = 'unreachable';
		this.#nextAttempt = Date.now() + this.#delay;
	}

	/** Tries again within a second instead of after the backoff. */
	retryNow() {
		if (this.status !== 'unreachable') return;
		this.#delay = RETRY_MIN_MS;
		this.#nextAttempt = 0;
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

export const daemonState = new DaemonState();
