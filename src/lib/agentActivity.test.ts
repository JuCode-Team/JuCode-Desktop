import { describe, expect, it } from 'vitest';
import { messageSource, threads } from './agentActivity';
import type { MessageView, ReportView } from './agents.svelte';
import type { Schedule } from './schedules';

const schedules = [{ id: 'sch-1', name: '每日巡检' }] as Schedule[];

const message = (id: string, at: number, from = 'user', agent = 'ops'): MessageView => ({
	id,
	agent,
	from,
	body: 'b',
	at,
	status: 'delivered',
	session: 's1',
	reason: null
});
const report = (id: string, at: number, agent = 'ops') => ({ id, agent, at }) as ReportView;

describe('messageSource', () => {
	it('names where a message came from', () => {
		expect(messageSource('user', schedules)).toEqual({ kind: 'user' });
		expect(messageSource('schedule:sch-1', schedules)).toEqual({ kind: 'schedule', name: '每日巡检' });
		expect(messageSource('schedule:gone', schedules)).toEqual({ kind: 'schedule', name: 'gone' });
		expect(messageSource('timer:t1', schedules)).toEqual({ kind: 'timer' });
		expect(messageSource('agent:web', schedules)).toEqual({ kind: 'agent', id: 'web' });
		expect(messageSource('question:q1', schedules)).toEqual({ kind: 'answer' });
		expect(messageSource('webhook', schedules)).toEqual({ kind: 'other', from: 'webhook' });
	});
});

describe('threads', () => {
	const msg = (id: string, at: number, session: string | null, extra: Partial<MessageView> = {}): MessageView => ({
		...message(id, at),
		session,
		...extra
	});
	const rep = (id: string, at: number, session: string) => ({ id, agent: 'ops', at, session, title: id }) as ReportView;

	it("groups one agent's messages and reports by session, most recently active first", () => {
		const list = threads(
			'ops',
			[
				{ session: 's1', agent: 'ops', title: '巡检', created_at: 1 },
				{ session: 's2', agent: 'ops', title: '', created_at: 2, updated_at: 5 },
				{ session: 'w1', agent: 'web', created_at: 3 }
			],
			[
				msg('m1', 10, 's1', { from: 'schedule:sch-1' }),
				msg('m2', 30, 's1'),
				msg('x', 40, 'w1', { agent: 'web' }),
				msg('m3', 50, null, { status: 'pending' })
			],
			[rep('r1', 20, 's1'), rep('r2', 25, 's1')],
			schedules,
			['s1'],
			{ s1: '工单已处理' }
		);
		expect(list.map((t) => t.id)).toEqual(['m3', 's1', 's2']);
		const [queued, s1, s2] = list;
		expect(queued).toMatchObject({ session: null, status: 'queued' });
		expect(s1).toMatchObject({ title: '巡检', status: 'running', handoff: '工单已处理', latest: 30 });
		expect(s1.task?.id).toBe('m1');
		expect(s1.source).toEqual({ kind: 'schedule', name: '每日巡检' });
		expect(s1.followUps.map((m) => m.id)).toEqual(['m2']);
		expect(s1.reports.map((r) => r.id)).toEqual(['r2', 'r1']);
		// A session opened by hand has no task.
		expect(s2).toMatchObject({ task: null, status: 'idle', latest: 5 });
	});

	it('marks the tasks whose session is archived', () => {
		const list = threads(
			'ops',
			[
				{ session: 's1', agent: 'ops', created_at: 1, archived: true },
				{ session: 's2', agent: 'ops', created_at: 2 }
			],
			[],
			[],
			schedules,
			[],
			{}
		);
		expect(list.map((t) => [t.id, t.archived])).toEqual([
			['s2', false],
			['s1', true]
		]);
	});

	it('marks a task that cannot be delivered', () => {
		const [only] = threads('ops', [], [msg('m1', 1, null, { status: 'undeliverable' })], [], schedules, [], {});
		expect(only.status).toBe('undeliverable');
	});
});
