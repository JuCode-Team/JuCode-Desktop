import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./protocol', () => ({
	daemon: {
		connect: vi.fn(() => Promise.resolve()),
		post: vi.fn(() => Promise.resolve()),
		request: vi.fn((op: { op: string }) =>
			Promise.resolve(
				op.op === 'session_list'
					? { type: 'sessions', sessions: [] }
					: op.op === 'report_list'
						? { type: 'reports', reports: [] }
						: { type: 'agent_created', agent: { id: 'ops' } }
			)
		)
	}
}));

import { AgentDirectory } from './agents.svelte';
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
