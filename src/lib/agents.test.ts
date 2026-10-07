import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./protocol', () => ({
	daemon: {
		connect: vi.fn(() => Promise.resolve()),
		post: vi.fn(() => Promise.resolve()),
		request: vi.fn((op: { op: string; schedule?: Record<string, unknown> }) =>
			Promise.resolve(
				op.op === 'session_list'
					? { type: 'sessions', sessions: [] }
					: op.op === 'report_list'
						? { type: 'reports', reports: [] }
						: op.op === 'schedule_save'
							? { type: 'schedule_saved', schedule: { id: 'sch-new', ...op.schedule } }
							: op.op === 'timer_list'
								? {
										type: 'timers',
										timers: [
											{ timer: 't2', agent: 'ops', fire_at: 20 },
											{ timer: 't1', agent: 'ops', fire_at: 10 },
											{ timer: 't3', agent: 'web', fire_at: 5 }
										]
									}
								: { type: 'agent_created', agent: { id: 'ops' } }
			)
		)
	}
}));

import { AgentDirectory, agentWorkspace, agentsOfWorkspace } from './agents.svelte';
import { daemon } from './protocol';

beforeEach(() => vi.clearAllMocks());

const session = (id: string, agent: string | null, created_at: number) => ({
	session: id,
	cwd: '/w',
	agent,
	created_at,
	open: true
});

describe('AgentDirectory', () => {
	it('keeps the agents and sessions the daemon broadcasts', () => {
		const dir = new AgentDirectory();
		dir.handle({ type: 'agents', agents: [{ id: 'ops', name: 'Ops', busy: true }] });
		expect(dir.agents.map((a) => a.id)).toEqual(['ops']);
		// A changed agent list refreshes the session list too.
		expect(daemon.request).toHaveBeenCalledWith({ op: 'session_list' });
		dir.handle({ type: 'sessions', sessions: [session('s1', 'ops', 1)] });
		expect(dir.sessions).toHaveLength(1);
	});

	it("picks an agent's most recently created session", () => {
		const dir = new AgentDirectory();
		dir.handle({
			type: 'sessions',
			sessions: [
				session('old', 'ops', 1),
				session('new', 'ops', 5),
				session('other', 'web', 9),
				session('plain', null, 10)
			]
		});
		expect(dir.latestSession('ops')?.session).toBe('new');
		expect(dir.latestSession('nobody')).toBeUndefined();
	});

	it('reports a lost connection until it is started again', async () => {
		const dir = new AgentDirectory();
		dir.disconnected();
		expect(dir.status).toBe('off');
		dir.start();
		await Promise.resolve();
		await Promise.resolve();
		expect(dir.status).toBe('on');
		dir.disconnected();
		expect(dir.status).toBe('unreachable');
		dir.stop();
		expect(dir.status).toBe('off');
	});

	it('creates an agent through the daemon', async () => {
		const dir = new AgentDirectory();
		await dir.create({ id: 'ops', name: 'Ops', cwd: '/w', role: 'keep it green' });
		expect(daemon.request).toHaveBeenCalledWith({
			op: 'agent_create',
			agent: 'ops',
			name: 'Ops',
			cwd: '/w',
			role: 'keep it green'
		});
	});
});

describe('desk state', () => {
	const question = { id: 'q1', agent: 'ops', session: 's1', title: 'Ship?', importance: 'high' };
	const action = {
		id: 'act-1',
		session_id: 's1',
		cwd: '/w',
		name: 'bash',
		arguments: '{}',
		summary: 'make'
	};

	it('counts open questions and pending actions as waiting for the user', () => {
		const dir = new AgentDirectory();
		dir.handle({ type: 'questions', questions: [question] });
		dir.handle({ type: 'actions', actions: [action] });
		expect(dir.pending).toBe(2);
		dir.handle({ type: 'questions', questions: [] });
		expect(dir.pending).toBe(1);
	});

	it('decides an action in its session and drops it from the list', async () => {
		const dir = new AgentDirectory();
		dir.handle({ type: 'actions', actions: [action] });
		await dir.decide(dir.actions[0], true);
		expect(daemon.post).toHaveBeenCalledWith({
			op: 'decide_action',
			session: 's1',
			action: 'act-1',
			decision: 'allow'
		});
		expect(dir.actions).toEqual([]);
	});

	it('puts a new report first and marks it read once', async () => {
		const dir = new AgentDirectory();
		dir.handle({ type: 'report_posted', report: { id: 'r1', title: 'old', read: false } });
		dir.handle({ type: 'report_posted', report: { id: 'r2', title: 'new', read: false } });
		expect(dir.reports.map((r) => r.id)).toEqual(['r2', 'r1']);
		await dir.markRead(dir.reports[0]);
		await dir.markRead(dir.reports[0]);
		expect(dir.reports[0].read).toBe(true);
		expect(
			vi.mocked(daemon.request).mock.calls.filter(([op]) => op.op === 'report_read')
		).toHaveLength(1);
	});

	it('finds the agent a daemon session belongs to', () => {
		const dir = new AgentDirectory();
		dir.handle({ type: 'sessions', sessions: [session('s1', 'ops', 1)] });
		dir.agents = [{ id: 'ops', name: 'Ops' } as never];
		expect(dir.agentOfSession('s1')?.name).toBe('Ops');
		expect(dir.agentOfSession('nope')).toBeUndefined();
		expect(dir.agentName('ghost')).toBe('ghost');
	});
});

describe('schedules', () => {
	const schedule = (id: string, agent = 'ops') => ({ id, agent, name: id, enabled: true }) as never;

	it('keeps the list the daemon broadcasts', () => {
		const dir = new AgentDirectory();
		dir.handle({ type: 'schedules', schedules: [schedule('a'), schedule('b', 'web')] });
		expect(dir.schedules.map((s) => s.id)).toEqual(['a', 'b']);
		dir.handle({ type: 'schedules', schedules: [] });
		expect(dir.schedules).toEqual([]);
	});

	it('saves, runs and deletes by the schedule id, never the request id', async () => {
		const dir = new AgentDirectory();
		const saved = await dir.saveSchedule({
			agent: 'ops',
			name: 'Check',
			prompt: 'go',
			enabled: true,
			repeat: 'daily',
			time: '09:00',
			days: [],
			date: '',
			new_session: true
		});
		expect(saved.id).toBe('sch-new');
		expect(dir.schedules.map((s) => s.id)).toEqual(['sch-new']);
		await dir.runSchedule('sch-new');
		expect(daemon.request).toHaveBeenCalledWith({ op: 'schedule_run', schedule: 'sch-new' });
		await dir.deleteSchedule('sch-new');
		expect(daemon.request).toHaveBeenCalledWith({ op: 'schedule_delete', schedule: 'sch-new' });
		expect(dir.schedules).toEqual([]);
	});

	it("drops a deleted agent's schedules", async () => {
		const dir = new AgentDirectory();
		dir.agents = [{ id: 'ops' } as never, { id: 'web' } as never];
		dir.handle({ type: 'schedules', schedules: [schedule('a'), schedule('b', 'web')] });
		await dir.remove('ops');
		expect(daemon.request).toHaveBeenCalledWith({ op: 'agent_delete', agent: 'ops' });
		expect(dir.agents.map((a) => a.id)).toEqual(['web']);
		expect(dir.schedules.map((s) => s.id)).toEqual(['b']);
	});

	it("lists only this agent's reminders, soonest first", async () => {
		const dir = new AgentDirectory();
		expect((await dir.timers('ops')).map((x) => x.timer)).toEqual(['t1', 't2']);
	});
});

describe('arrivals', () => {
	it('reports new questions, actions and reports, not what waited at connect', () => {
		const dir = new AgentDirectory();
		const seen: string[] = [];
		dir.onArrival = (kind, _agent, text) => seen.push(`${kind}:${text}`);
		const q = (id: string) => ({ id, agent: 'ops', title: id });
		const a = (id: string) => ({ id, session_id: 's', cwd: '/w', name: 'bash', summary: id });
		dir.handle({ type: 'questions', questions: [q('q1')] });
		dir.handle({ type: 'actions', actions: [a('a1')] });
		expect(seen).toEqual([]);
		dir.handle({ type: 'questions', questions: [q('q1'), q('q2')] });
		dir.handle({ type: 'actions', actions: [a('a2')] });
		dir.handle({ type: 'report_posted', report: { id: 'r1', agent: 'ops', title: 'done' } });
		expect(seen).toEqual(['question:q2', 'action:a2', 'report:done']);
	});

	it('tells the user when an agent closes an item, not when they did', () => {
		const dir = new AgentDirectory();
		const seen: string[] = [];
		dir.onArrival = (kind, _agent, text) => seen.push(`${kind}:${text}`);
		const closed = (id: string, by: string) => ({ id, agent: 'ops', title: id, closed_by: by, closed_reason: 'r', closed_at: 1 });
		dir.handle({ type: 'questions', questions: [], closed: [closed('q0', 'agent:ops')] });
		dir.handle({ type: 'questions', questions: [], closed: [closed('q2', 'user'), closed('q1', 'agent:ops'), closed('q0', 'agent:ops')] });
		expect(seen).toEqual(['closed:q1']);
		expect(dir.closedQuestions.map((q) => q.id)).toEqual(['q2', 'q1', 'q0']);
		// An older daemon sends no closed list.
		dir.handle({ type: 'questions', questions: [] });
		expect(dir.closedQuestions).toEqual([]);
	});
});

describe('reminder cancellation', () => {
	it('uses the reminder id and surfaces a failed cancellation', async () => {
		const dir = new AgentDirectory();
		await dir.cancelTimer('t1');
		expect(daemon.request).toHaveBeenCalledWith({ op: 'timer_cancel', timer: 't1' });
		vi.mocked(daemon.request).mockRejectedValueOnce(new Error('already fired'));
		await expect(dir.cancelTimer('t2')).rejects.toThrow('already fired');
	});
});

describe('agent workspaces', () => {
	const workspaces = [{ id: 'w1', isDefault: true }, { id: 'w2' }];
	it("lists an agent in its workspace, else in the default one", () => {
		expect(agentWorkspace({ workspace: 'w2' }, workspaces)).toBe('w2');
		expect(agentWorkspace({}, workspaces)).toBe('w1');
		// Its workspace was deleted.
		expect(agentWorkspace({ workspace: 'gone' }, workspaces)).toBe('w1');
		const agents = [{ id: 'a', workspace: 'w2' }, { id: 'b' }, { id: 'c', workspace: 'gone' }];
		expect(agentsOfWorkspace(agents, workspaces, 'w1').map((a) => a.id)).toEqual(['b', 'c']);
		expect(agentsOfWorkspace(agents, workspaces, 'w2').map((a) => a.id)).toEqual(['a']);
	});
});
