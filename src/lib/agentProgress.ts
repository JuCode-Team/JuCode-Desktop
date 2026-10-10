// What the conversation shows of a turn's progress: its todo list (the plan)
// and the subagents it runs, as the progress card at the top of the chat and
// the subagent cards in the message list read them. Pure: the components pass
// in the chat's state and a clock.

import type { AgentRun, PlanStep, SubagentInfo, WorkflowRun } from './chat.svelte';
import { runState, type RunState } from './agentTrace';

export type StepState = 'pending' | 'active' | 'done' | 'skipped';

/** A plan step's status as one of four (engines say in_progress, inProgress, completed …). */
export function stepState(status: string): StepState {
	switch (status) {
		case 'in_progress':
		case 'inProgress':
		case 'active':
		case 'running':
			return 'active';
		case 'completed':
		case 'done':
			return 'done';
		case 'skipped':
		case 'cancelled':
		case 'canceled':
			return 'skipped';
		default:
			return 'pending';
	}
}

export interface PlanSummary {
	steps: { text: string; state: StepState }[];
	/** Steps done or skipped. */
	done: number;
	total: number;
	/** The step being worked on (the first active one, else the first pending
	 *  one while work remains); -1 when there is none. */
	current: number;
}

export function planSummary(plan: PlanStep[]): PlanSummary {
	const steps = plan.map((p) => ({ text: p.step, state: stepState(p.status) }));
	const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
	let current = steps.findIndex((s) => s.state === 'active');
	if (current < 0 && done < steps.length && done > 0) current = steps.findIndex((s) => s.state === 'pending');
	return { steps, done, total: steps.length, current };
}

/** One subagent as the progress card and its spawn card show it. */
export interface AgentRow {
	/** The id its conversation is read by (agent_runs / lifecycle path). */
	id: string;
	label: string;
	model: string;
	state: RunState;
	startedAt: number;
	/** Its reported running time, ms. */
	durationMs: number;
	/** When this client saw it end, ms (0: not seen). */
	endedAt: number;
	/** Its latest action, in one line. */
	activity: string;
	/** The call that started it. */
	toolUseId: string;
	prompt: string;
	result: string;
	error: string;
	/** Its kind as the engine names it (claude's subagent_type, e.g. Explore); '' when unknown. */
	type: string;
	/** Tokens and tool calls so far (the agent trace; 0 when the engine sends none). */
	tokens: number;
	toolCalls: number;
	/** A Workflow (claude), not one agent: opens the trace's run list. */
	workflow?: boolean;
	/** Workflow agents finished out of all. */
	progress?: { done: number; total: number };
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

/** Lifecycle words that are not news (an agent queued, started, finished). */
const QUIET = new Set(['', 'reserved', 'started', 'finished', 'queued message', 'close requested']);

export interface RowInput {
	runs: { workflows: WorkflowRun[]; agents: AgentRun[] };
	subagents: Record<string, SubagentInfo>;
	/** The latest call a claude subagent made, by its label, in one line. */
	lastTool?: (label: string) => string;
	/** Only runs started since (ms), besides the running ones and the ones the
	 *  lifecycle still lists; 0 keeps every run. */
	since?: number;
}

/** The subagents to show, oldest first: the agent trace's runs (when the engine
 *  sends one), joined with what their lifecycle events say, then the
 *  subagents only the lifecycle (or a spawn call) reports. */
export function agentRows({ runs, subagents, lastTool, since = 0 }: RowInput): AgentRow[] {
	const rows: AgentRow[] = [];
	const seen = new Set<string>();
	// A few seconds of slack: the engine stamps a run with its own clock.
	const recent = (state: RunState, startedAt: number, id: string) =>
		state === 'running' || state === 'queued' || id in subagents || !since || startedAt >= since - 5000;
	for (const w of runs.workflows) {
		const state = runState(w.status);
		if (!recent(state, w.startedAt, w.id)) continue;
		seen.add(w.id);
		const done = w.agents.filter((a) => !['running', 'queued'].includes(runState(a.state))).length;
		const live = w.agents.filter((a) => runState(a.state) === 'running');
		rows.push({
			id: w.id,
			label: w.name || firstLine(w.description) || w.id,
			model: '',
			state,
			startedAt: w.startedAt,
			durationMs: w.durationMs,
			endedAt: 0,
			activity: live.length ? live.map((a) => a.label).filter(Boolean).join(' · ') : firstLine(w.description),
			toolUseId: w.toolUseId,
			prompt: w.description,
			result: '',
			error: '',
			type: '',
			tokens: w.tokens,
			toolCalls: 0,
			workflow: true,
			progress: { done, total: w.agents.length }
		});
	}
	for (const a of runs.agents) {
		const life = subagents[a.id];
		const state = runState(a.state || life?.status || '');
		if (!a.id || !recent(state, a.startedAt, a.id)) continue;
		seen.add(a.id);
		const label = a.label || life?.label || a.id;
		rows.push({
			id: a.id,
			label: shortPath(label),
			model: a.model || life?.model || '',
			state,
			startedAt: a.startedAt || life?.startedAt || 0,
			durationMs: a.durationMs,
			endedAt: life?.endedAt ?? 0,
			activity: activityOf(state, a.activity, lastTool?.(label) ?? '', life?.message ?? '', a.result, a.error, a.prompt),
			toolUseId: a.toolUseId || life?.toolUseId || '',
			prompt: a.prompt,
			result: a.result,
			error: a.error,
			type: a.type,
			tokens: a.tokens,
			toolCalls: a.toolCalls
		});
	}
	for (const [id, life] of Object.entries(subagents)) {
		if (seen.has(id)) continue;
		const state = runState(life.status);
		const label = life.label || id;
		rows.push({
			id,
			label: shortPath(label),
			model: life.model ?? '',
			state,
			startedAt: life.startedAt ?? 0,
			durationMs: life.endedAt && life.startedAt ? life.endedAt - life.startedAt : 0,
			endedAt: life.endedAt ?? 0,
			activity: activityOf(state, '', lastTool?.(label) ?? '', life.message, '', state === 'failed' ? life.message : '', ''),
			toolUseId: life.toolUseId ?? '',
			prompt: '',
			result: '',
			error: state === 'failed' ? life.message : '',
			type: '',
			tokens: 0,
			toolCalls: 0
		});
	}
	return rows;
}

/** A JuCode agent path (`/root/scan_auth`) by its own name. */
export const shortPath = (label: string) => (label.startsWith('/') ? label.split('/').filter(Boolean).pop() || label : label);

function activityOf(
	state: RunState,
	activity: string,
	tool: string,
	message: string,
	result: string,
	error: string,
	prompt: string
): string {
	if (state === 'failed' && error) return firstLine(error);
	if (state === 'done' && result) return firstLine(result);
	const said = QUIET.has(message) ? '' : message;
	return firstLine(activity) || tool || firstLine(said) || (state === 'running' || state === 'queued' ? firstLine(prompt) : '');
}

/** How long an agent has run (running: since it started), ms. */
export function rowElapsed(row: AgentRow, now: number): number {
	if (row.state === 'running' && row.startedAt > 0) return Math.max(row.durationMs, now - row.startedAt);
	if (row.durationMs > 0) return row.durationMs;
	return row.endedAt && row.startedAt ? row.endedAt - row.startedAt : 0;
}

/** The subagent a spawn call started (by the call's id). */
export const agentOfCall = (rows: AgentRow[], callId: string) => (callId ? rows.find((r) => r.toolUseId === callId) : undefined);

/** Tool names that start a subagent, and the ones that wait for subagents. */
export const SPAWN_TOOLS = new Set(['spawn_agent', 'Task', 'Agent']);
export const WAIT_TOOLS = new Set(['wait_agent', 'agent_wait']);

/** What a spawn call's own payload says (its arguments or its output):
 *  the agent's name and task, for an engine that sends no trace. */
export function spawnPayload(output: string): { name: string; task: string; path: string } {
	const o = parse(output);
	const s = (k: string) => (typeof o?.[k] === 'string' ? (o[k] as string) : '');
	return {
		name: s('description') || s('task_name') || s('name'),
		task: s('prompt') || s('message') || s('task'),
		path: s('path')
	};
}

export type WaitState = RunState | 'unknown';

/** The agents a wait call names and their states, from its output:
 *  `{"status": {"/root/x": "running" | {"completed": …} | {"errored": …}}}`
 *  (JuCode), or Codex's `{"description": "label: status\n…"}`. */
export function waitTargets(output: string): { id: string; state: WaitState; timedOut: boolean }[] {
	const o = parse(output);
	if (!o) return [];
	const timedOut = o.timed_out === true;
	if (o.status && typeof o.status === 'object' && !Array.isArray(o.status)) {
		return Object.entries(o.status as Record<string, unknown>).map(([id, v]) => ({
			id,
			state:
				typeof v === 'string'
					? runState(v === 'errored' ? 'failed' : v === 'interrupted' || v === 'closed' ? 'stopped' : v)
					: v && typeof v === 'object'
						? 'completed' in v
							? 'done'
							: 'errored' in v
								? 'failed'
								: 'unknown'
						: 'unknown',
			timedOut
		}));
	}
	if (typeof o.description === 'string') {
		return o.description
			.split(/\n|,\s*/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const m = /^(.*?):\s*(\w+)$/.exec(line);
				return m ? { id: m[1]!, state: runState(m[2]!), timedOut } : { id: line, state: 'unknown' as const, timedOut };
			});
	}
	return [];
}

function parse(output: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(output);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Whether the plan is worth showing: it changed in this turn, or the turn
 *  running now still has steps to do. */
export const planShown = (plan: PlanSummary, busy: boolean, planFresh: boolean) =>
	plan.total > 0 && (planFresh || (busy && plan.done < plan.total));

/** The progress tray above the composer: hidden (nothing to show), its one-line
 *  bar, or open (the bar plus the to-dos and subagents) when the user opened
 *  it for this session. */
export type TrayMode = 'hidden' | 'bar' | 'open';

export function trayMode(plan: PlanSummary, rows: AgentRow[], busy: boolean, planFresh: boolean, open: boolean): TrayMode {
	if (!planShown(plan, busy, planFresh) && !rows.length) return 'hidden';
	return open ? 'open' : 'bar';
}

/** The bar's counts: steps done of all, and subagents (running ones while any run). */
export function pillParts(plan: PlanSummary, rows: AgentRow[], showPlan: boolean): { steps: string; agents: number; running: number } {
	return {
		steps: showPlan ? `${plan.done}/${plan.total}` : '',
		agents: rows.length,
		running: rows.filter((r) => r.state === 'running' || r.state === 'queued').length
	};
}

/** A running time as the cards show it: 8s, 1m05s, 1h02m. */
export function shortElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
