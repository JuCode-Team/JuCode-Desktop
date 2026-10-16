// The background tasks (TaskPanel): how a Workflow's agents and a session's
// Task subagents read — their state, their time, the raw numbers.

import type { AgentRun, WorkflowRun } from './chat.svelte';

export type RunState = 'running' | 'done' | 'failed' | 'stopped' | 'queued';

/** The engine's state words (`done`, `completed`, `killed`, `pending` …) as five. */
export function runState(state: string): RunState {
	switch (state) {
		case 'running':
		case 'progress':
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
