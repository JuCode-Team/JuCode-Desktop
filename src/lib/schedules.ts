// Scheduled tasks, kept by the jucode daemon: a prompt sent to a new session
// in a directory at set times. The wire shape, the human summary of when one
// repeats, and the checks the daemon applies.

import { getLocale, t } from './i18n';
import type { UsageTokens } from './protocol';
import { BACKEND_LABELS } from './backends/types';

export interface ScheduleUsageTotals extends UsageTokens {
	/** Gateway-settled points, including group multipliers; null if unavailable. */
	gateway_cost: number | null;
	estimated_cost_usd: number | null;
	pending_requests: number;
	unpriced_requests: number;
	running: boolean;
}

export interface ScheduleUsage {
	totals: ScheduleUsageTotals;
	/** A session a run started (`start_session`) names it as `parent`. */
	sessions: (ScheduleUsageTotals & { session: string; started_at: number | null; parent?: string })[];
	billing_error?: string;
}

/** Keep settled points and reference USD estimates separate. */
export function usageCost(usage: ScheduleUsageTotals): string {
	const costs: string[] = [];
	if (usage.gateway_cost !== null) costs.push(t('shell.schedule.billedCost', { cost: usage.gateway_cost.toFixed(4) }));
	if (usage.estimated_cost_usd !== null) costs.push(t('shell.schedule.estimatedCost', { cost: usage.estimated_cost_usd.toFixed(4) }));
	return costs.join(' · ') || '—';
}

export type Repeat = 'once' | 'hourly' | 'daily' | 'weekdays' | 'weekly';
/** The engines a scheduled task can run on; `acp` runs a built-in ACP
 *  agent, named by `options.agent`. */
export type ScheduleEngine = 'jucode' | 'claude' | 'codex' | 'acp';
/** Permission modes, as the daemon names them for every engine. */
export type ScheduleMode = 'ask' | 'edits' | 'auto' | 'all';

/** A run: `waiting` for an approval, `failed` with `error`. */
export interface ScheduleRun {
	/** ms */
	at: number;
	session: string | null;
	/** `background`: its turn ended; background work it left going runs. */
	status: 'running' | 'waiting' | 'background' | 'done' | 'failed';
	error: string | null;
}

export interface Schedule {
	id: string;
	name: string;
	prompt: string;
	/** Where its runs start; null until picked (one moved from an agent). */
	cwd: string | null;
	engine: ScheduleEngine;
	mode: ScheduleMode;
	/** Engine start options (`jucode_gateway`, `bin`, `env`; ACP: `agent`). */
	options: Record<string, unknown>;
	enabled: boolean;
	repeat: Repeat;
	/** Local "HH:MM"; hourly uses the minute only. */
	time: string;
	/** Weekly only: 0 = Sunday … 6. */
	days?: number[] | null;
	/** Once only: local "YYYY-MM-DD". */
	date?: string | null;
	/** ms */
	created_at: number;
	next_run_at: number | null;
	last_run: ScheduleRun | null;
	/** Times skipped in a row while the last run was still going. */
	skipped: number;
	/** The agent proposal it was created from (`propose_schedule`). */
	origin?: string | null;
	/** Runs start in a git worktree of their own. Absent from an older
	 *  daemon, which has none of these four. */
	worktree?: boolean;
	/** What one run may cost: gateway points through the JuCode gateway,
	 *  estimated USD otherwise; null: no limit. */
	budget?: number | null;
	/** Runs failed in a row; at MAX_FAILURES the daemon switches it off. */
	failures?: number;
	/** The runs before `last_run`, newest first. */
	history?: ScheduleRun[];
}

/** Failures in a row after which the daemon switches a task off. */
export const MAX_FAILURES = 3;

/** What `schedule_save` takes: no id creates one. */
export type ScheduleDraft = Pick<Schedule, 'name' | 'prompt' | 'engine' | 'mode' | 'options' | 'enabled' | 'repeat' | 'time'> & {
	id?: string;
	/** Set once, when a task is created from an agent's proposal. */
	origin?: string;
	cwd: string;
	days: number[];
	date: string;
	worktree: boolean;
	/** The budget as typed: '' for none. */
	budget: string;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The draft as `schedule_save` expects it: `days` and `date` only where
 *  they apply. */
export function toWire(d: ScheduleDraft): Record<string, unknown> {
	const { days, date, id, budget, ...rest } = d;
	return {
		...(id ? { id } : {}),
		...rest,
		budget: budget.trim() ? Number(budget) : null,
		name: d.name.trim(),
		prompt: d.prompt.trim(),
		...(d.repeat === 'weekly' ? { days: [...days].sort((a, b) => a - b) } : {}),
		...(d.repeat === 'once' ? { date } : {})
	};
}

export function toDraft(s: Schedule): ScheduleDraft {
	return {
		id: s.id,
		name: s.name,
		prompt: s.prompt,
		cwd: s.cwd ?? '',
		engine: s.engine,
		mode: s.mode,
		options: s.options ?? {},
		enabled: s.enabled,
		repeat: s.repeat,
		time: s.time,
		days: s.days ?? [],
		date: s.date ?? '',
		worktree: s.worktree ?? false,
		budget: s.budget ? String(s.budget) : ''
	};
}

/** Why the daemon would refuse the draft (a message for the user), or null.
 *  `now` is for the once-only date, which must lie ahead. */
export function validate(d: ScheduleDraft, now = new Date()): string | null {
	if (!d.name.trim()) return t('shell.schedule.errName');
	if (!d.prompt.trim()) return t('shell.schedule.errPrompt');
	if (d.enabled && !d.cwd) return t('shell.schedule.errCwd');
	if (!TIME.test(d.time)) return t('shell.schedule.errTime');
	if (d.budget.trim() && !(Number(d.budget) > 0)) return t('shell.schedule.errBudget');
	if (d.repeat === 'weekly' && (d.days.length === 0 || d.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)))
		return t('shell.schedule.errDays');
	if (d.repeat === 'once') {
		const at = localTime(d.date, d.time);
		if (!at) return t('shell.schedule.errDate');
		if (at <= now) return t('shell.schedule.errPast');
	}
	return null;
}

/** The local moment of `date` + `time`, or null when the date is invalid. */
function localTime(date: string, time: string): Date | null {
	const m = DATE.exec(date);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const [h, mi] = time.split(':').map(Number);
	const at = new Date(y, mo - 1, d, h, mi);
	return at.getMonth() === mo - 1 && at.getDate() === d ? at : null;
}

/** When it runs, e.g. 每天 11:00 · 每周一、三 18:00 · 每小时第 15 分. */
export function summary(s: Pick<Schedule, 'repeat' | 'time' | 'days' | 'date'>): string {
	const time = s.time;
	switch (s.repeat) {
		case 'hourly':
			return t('shell.schedule.sumHourly', { minute: Number(time.split(':')[1] ?? 0) });
		case 'daily':
			return t('shell.schedule.sumDaily', { time });
		case 'weekdays':
			return t('shell.schedule.sumWeekdays', { time });
		case 'weekly': {
			const names = t('shell.schedule.dayNames').split(',');
			// Monday first; Sunday last.
			const days = [...(s.days ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
			return t('shell.schedule.sumWeekly', { days: days.map((d) => names[d]).join(t('shell.schedule.daySep')), time });
		}
		case 'once': {
			const at = localTime(s.date ?? '', time);
			const date = at
				? at.toLocaleDateString(getLocale() === 'zh' ? 'zh-CN' : 'en-US', {
						month: getLocale() === 'zh' ? 'long' : 'short',
						day: 'numeric'
					})
				: (s.date ?? '');
			return t('shell.schedule.sumOnce', { date, time });
		}
	}
}

/** Weekday chips in display order (Monday first). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** The engine it runs on, for lists: an ACP task by its agent's name. */
export function engineLabel(s: Pick<Schedule, 'engine' | 'options'>, presets: { id: string; name: string }[]): string {
	if (s.engine !== 'acp') return BACKEND_LABELS[s.engine];
	const agent = String(s.options?.agent ?? '');
	return presets.find((p) => p.id === agent)?.name ?? (agent || BACKEND_LABELS.acp);
}

/** Its runs, newest first: the latest, then the earlier ones. */
export function runsOf(s: Pick<Schedule, 'last_run' | 'history'>): ScheduleRun[] {
	return [...(s.last_run ? [s.last_run] : []), ...(s.history ?? [])];
}

/** Insert or replace by id. */
export function upsert(list: Schedule[], s: Schedule): Schedule[] {
	return list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
}
