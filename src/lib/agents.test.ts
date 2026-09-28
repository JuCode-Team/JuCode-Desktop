import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./protocol', () => ({
	daemon: {
		connect: vi.fn(() => Promise.resolve()),
		request: vi.fn((op: { op: string }) =>
			Promise.resolve(
				op.op === 'session_list'
					? { type: 'sessions', sessions: [] }
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
