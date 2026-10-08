import { describe, it, expect } from 'vitest';
import {
	agentOfCall,
	agentRows,
	cardMode,
	pillParts,
	planShown,
	planSummary,
	rowElapsed,
	shortPath,
	spawnPayload,
	stepState,
	waitTargets,
	type AgentRow
} from './agentProgress';
import type { AgentRun, WorkflowRun } from './chat.svelte';

const run = (over: Partial<AgentRun>): AgentRun => ({
	id: 'a1',
	label: '',
	phase: 0,
	model: '',
	state: 'running',
	startedAt: 1000,
	durationMs: 0,
	tokens: 0,
	toolCalls: 0,
	prompt: '',
	result: '',
	error: '',
	type: 'subagent',
	toolUseId: '',
	activity: '',
	effort: '',
	...over
});

describe('plan summary', () => {
	it('reads every engine’s step words as four', () => {
		expect(['pending', 'in_progress', 'inProgress', 'completed', 'skipped', 'odd'].map(stepState)).toEqual([
			'pending',
			'active',
			'active',
			'done',
			'skipped',
			'pending'
		]);
	});

	it('counts done steps and finds the current one', () => {
		const p = planSummary([
			{ step: 'Read', status: 'completed' },
			{ step: 'Fix', status: 'in_progress' },
			{ step: 'Test', status: 'pending' }
		]);
		expect([p.done, p.total, p.current]).toEqual([1, 3, 1]);
		// No step marked active: the first one still to do, once work began.
		expect(planSummary([{ step: 'a', status: 'completed' }, { step: 'b', status: 'pending' }]).current).toBe(1);
		expect(planSummary([{ step: 'a', status: 'pending' }]).current).toBe(-1);
		expect(planSummary([{ step: 'a', status: 'skipped' }, { step: 'b', status: 'completed' }]).done).toBe(2);
	});

	it('shows a plan of this turn, or an open one while a turn runs', () => {
		const open = planSummary([{ step: 'a', status: 'pending' }]);
		const done = planSummary([{ step: 'a', status: 'completed' }]);
		expect(planShown(open, true, false)).toBe(true);
		expect(planShown(open, false, false)).toBe(false);
		expect(planShown(done, false, true)).toBe(true);
		expect(planShown(planSummary([]), true, true)).toBe(false);
	});
});

describe('subagent rows', () => {
	it('joins the agent trace with the lifecycle and prefers the engine’s activity', () => {
		const rows = agentRows({
			runs: {
				workflows: [],
				agents: [run({ id: '/root/scan_auth', label: '', model: 'gpt-5.5', activity: 'Read src/auth.ts', toolUseId: 'call_1' })]
			},
			subagents: { '/root/scan_auth': { status: 'running', message: 'started', label: 'scan_auth', startedAt: 900 } }
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: '/root/scan_auth', label: 'scan_auth', model: 'gpt-5.5', state: 'running', activity: 'Read src/auth.ts', toolUseId: 'call_1' });
	});

	it('falls back to the subagent’s last call, then its lifecycle message, then its task', () => {
		const base = { runs: { workflows: [], agents: [] } };
		const [byTool] = agentRows({ ...base, subagents: { t1: { status: 'running', message: 'Reading', label: 'Scan auth' } }, lastTool: (l) => (l === 'Scan auth' ? 'Read auth.ts' : '') });
		expect(byTool!.activity).toBe('Read auth.ts');
		const [byMessage] = agentRows({ ...base, subagents: { t1: { status: 'running', message: 'Reading the config', label: 'Scan' } } });
		expect(byMessage!.activity).toBe('Reading the config');
		const [quiet] = agentRows({ ...base, subagents: { t1: { status: 'running', message: 'started' } } });
		expect(quiet!.activity).toBe('');
		const [task] = agentRows({ runs: { workflows: [], agents: [run({ prompt: 'Find the bug\nin auth' })] }, subagents: {} });
		expect(task!.activity).toBe('Find the bug');
	});

	it('shows a finished agent’s result and a failed one’s error', () => {
		const rows = agentRows({
			runs: { workflows: [], agents: [run({ id: 'a', state: 'completed', result: 'Found 2 issues\n…' }), run({ id: 'b', state: 'failed', error: 'timeout' })] },
			subagents: {}
		});
		expect(rows.map((r) => [r.state, r.activity])).toEqual([
			['done', 'Found 2 issues'],
			['failed', 'timeout']
		]);
	});

	it('lists a workflow as one row with its progress', () => {
		const w: WorkflowRun = {
			id: 'w1',
			toolUseId: 'call_w',
			name: 'review',
			description: 'Review the diff',
			status: 'running',
			startedAt: 1,
			durationMs: 0,
			tokens: 0,
			toolCalls: 0,
			phases: [],
			agents: [run({ id: 'x', state: 'completed', label: 'Find' }), run({ id: 'y', state: 'running', label: 'Verify' })]
		};
		const [row] = agentRows({ runs: { workflows: [w], agents: [] }, subagents: {} });
		expect(row).toMatchObject({ workflow: true, label: 'review', progress: { done: 1, total: 2 }, activity: 'Verify' });
	});

	it('keeps old finished runs out once a turn started after them', () => {
		const runs = { workflows: [], agents: [run({ id: 'old', state: 'completed', startedAt: 1000 }), run({ id: 'new', startedAt: 90_000 })] };
		expect(agentRows({ runs, subagents: {}, since: 60_000 }).map((r) => r.id)).toEqual(['new']);
		expect(agentRows({ runs, subagents: {} }).map((r) => r.id)).toEqual(['old', 'new']);
	});

	it('reads lifecycle-only subagents (older engines) and their time', () => {
		const [row] = agentRows({ runs: { workflows: [], agents: [] }, subagents: { '/root/w': { status: 'errored', message: 'boom', startedAt: 10, endedAt: 2010 } } });
		expect(row).toMatchObject({ label: 'w', state: 'failed', error: 'boom', durationMs: 2000 });
	});

	it('times a running agent from its start', () => {
		const row = { state: 'running', startedAt: 1000, durationMs: 0, endedAt: 0 } as AgentRow;
		expect(rowElapsed(row, 4000)).toBe(3000);
		expect(rowElapsed({ ...row, state: 'done', durationMs: 1200 }, 9000)).toBe(1200);
		expect(rowElapsed({ ...row, state: 'done', endedAt: 1500 }, 9000)).toBe(500);
	});

	it('finds the agent a spawn call started', () => {
		const rows = [{ toolUseId: 'c1', id: 'a' }, { toolUseId: 'c2', id: 'b' }] as AgentRow[];
		expect(agentOfCall(rows, 'c2')?.id).toBe('b');
		expect(agentOfCall(rows, '')).toBeUndefined();
		expect(shortPath('/root/scan_auth')).toBe('scan_auth');
		expect(shortPath('Scan auth')).toBe('Scan auth');
	});
});

describe('spawn and wait payloads', () => {
	it('reads the agent a spawn call names', () => {
		expect(spawnPayload('{"task_name":"scan","path":"/root/scan","status":"running"}')).toEqual({ name: 'scan', task: '', path: '/root/scan' });
		expect(spawnPayload('{"description":"Scan auth","prompt":"Find the bug"}')).toMatchObject({ name: 'Scan auth', task: 'Find the bug' });
		expect(spawnPayload('not json')).toEqual({ name: '', task: '', path: '' });
	});

	it('reads which agents a wait names and their states', () => {
		expect(waitTargets('{"status":{"/root/a":"running","/root/b":{"completed":"ok"},"/root/c":{"errored":"x"},"/root/d":"closed"},"timed_out":true}')).toEqual([
			{ id: '/root/a', state: 'running', timedOut: true },
			{ id: '/root/b', state: 'done', timedOut: true },
			{ id: '/root/c', state: 'failed', timedOut: true },
			{ id: '/root/d', state: 'stopped', timedOut: true }
		]);
		expect(waitTargets('{"description":"pong: completed\\nping: running"}').map((w) => [w.id, w.state])).toEqual([
			['pong', 'done'],
			['ping', 'running']
		]);
		expect(waitTargets('')).toEqual([]);
	});
});

describe('progress card', () => {
	const plan = planSummary([
		{ step: 'a', status: 'completed' },
		{ step: 'b', status: 'in_progress' }
	]);
	const runningRow = { state: 'running' } as AgentRow;
	const doneRow = { state: 'done' } as AgentRow;
	const base = { plan, rows: [] as AgentRow[], busy: true, fold: 'auto' as const, endedAt: 0, now: 10_000, planFresh: true };

	it('opens while a turn has a plan or subagents', () => {
		expect(cardMode(base)).toBe('card');
		expect(cardMode({ ...base, plan: planSummary([]), rows: [runningRow] })).toBe('card');
		expect(cardMode({ ...base, plan: planSummary([]) })).toBe('hidden');
	});

	it('folds as the user says', () => {
		expect(cardMode({ ...base, fold: 'folded' })).toBe('pill');
		expect(cardMode({ ...base, busy: false, endedAt: 1, fold: 'open' })).toBe('card');
	});

	it('folds to the pill a few seconds after the turn, unless an agent still runs', () => {
		const done = planSummary([{ step: 'a', status: 'completed' }]);
		const after = { ...base, plan: done, busy: false, rows: [doneRow], endedAt: 8000 };
		expect(cardMode({ ...after, now: 9000 })).toBe('card');
		expect(cardMode({ ...after, now: 12_500 })).toBe('pill');
		expect(cardMode({ ...after, now: 12_500, rows: [runningRow] })).toBe('card');
		// Reopened later (no turn ended in this run): folded straight away.
		expect(cardMode({ ...after, endedAt: 0 })).toBe('pill');
	});

	it('writes the pill', () => {
		expect(pillParts(plan, [runningRow, doneRow], true)).toEqual({ steps: '1/2', agents: 2, running: 1 });
		expect(pillParts(plan, [], false).steps).toBe('');
	});
});
