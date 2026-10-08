// The agent trace (AgentRunsPanel): how a Workflow's agents and a session's
// Task subagents read — their state, their time on a shared axis, the raw
// numbers.

import type { AgentRun, WorkflowRun } from './chat.svelte';

export type RunState = 'running' | 'done' | 'failed' | 'stopped' | 'queued';

/** The engine's state words (`done`, `completed`, `killed`, `pending` …) as five. */
export function runState(state: string): RunState {
	switch (state) {
		case 'running':
		case 'start':
		case 'started':
		case 'async_launched':
			return 'running';
		case 'done':
		case 'completed':
		case 'success':
			return 'done';
		case 'failed':
		case 'error':
		case 'errored':
			return 'failed';
		case 'stopped':
		case 'killed':
		case 'cancelled':
		case 'skipped':
		case 'interrupted':
		case 'closed':
			return 'stopped';
		default:
			return state ? 'queued' : 'done';
	}
}

/** Elapsed time of a run: its reported duration, or (running) since it started. */
export function elapsed(run: { startedAt: number; durationMs: number }, state: RunState, now: number): number {
	if (state === 'running' && run.startedAt > 0) return Math.max(run.durationMs, now - run.startedAt);
	return run.durationMs;
}

/** 1.8 s, 12.3 s, 2 m 05 s, 1 h 02 m — in the given units. */
export function formatDuration(ms: number, u: { s: string; m: string; h: string }): string {
	if (!ms || ms < 0) return `0 ${u.s}`;
	const s = ms / 1000;
	if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} ${u.s}`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} ${u.m} ${String(Math.round(s % 60)).padStart(2, '0')} ${u.s}`;
	return `${Math.floor(m / 60)} ${u.h} ${String(m % 60).padStart(2, '0')} ${u.m}`;
}

/** Token counts as written: 28,470. */
export const formatCount = (n: number) => Math.round(n).toLocaleString('en-US');

/** "claude-sonnet-5-5" → "sonnet-5-5": the family and version are what tell runs apart. */
export const shortModel = (model: string) => model.replace(/^claude-/, '');

/** Where each agent's bar sits on the run's time axis, in percent. */
export function timeline(agents: AgentRun[], now: number): { span: number; bars: Map<string, { left: number; width: number }> } {
	const timed = agents.filter((a) => a.startedAt > 0);
	const bars = new Map<string, { left: number; width: number }>();
	if (!timed.length) return { span: 0, bars };
	const start = Math.min(...timed.map((a) => a.startedAt));
	const end = Math.max(...timed.map((a) => a.startedAt + elapsed(a, runState(a.state), now)));
	const span = Math.max(1, end - start);
	for (const a of timed) {
		const left = ((a.startedAt - start) / span) * 100;
		const width = Math.max(0.8, (elapsed(a, runState(a.state), now) / span) * 100);
		bars.set(a.id, { left: Math.min(left, 99.2), width: Math.min(width, 100 - Math.min(left, 99.2)) });
	}
	return { span, bars };
}

/** A Workflow's agents grouped under its phases (agents of no listed phase last). */
export function byPhase(run: WorkflowRun): { title: string; agents: AgentRun[] }[] {
	const groups = run.phases.map((p) => ({ index: p.index, title: p.title, agents: [] as AgentRun[] }));
	const rest: AgentRun[] = [];
	for (const a of run.agents) {
		const g = groups.find((x) => x.index === a.phase);
		if (g) g.agents.push(a);
		else rest.push(a);
	}
	const out = groups.filter((g) => g.agents.length).map(({ title, agents }) => ({ title, agents }));
	if (rest.length) out.push({ title: '', agents: rest });
	return out;
}

/** Agents finished out of all, for a run's header. */
export function progress(run: WorkflowRun): { done: number; total: number } {
	return { done: run.agents.filter((a) => runState(a.state) !== 'running' && runState(a.state) !== 'queued').length, total: run.agents.length };
}

/** Whether any run is still going (the panel then ticks its clocks). */
export function anyRunning(workflows: WorkflowRun[], agents: AgentRun[]): boolean {
	return workflows.some((w) => runState(w.status) === 'running') || agents.some((a) => runState(a.state) === 'running');
}
