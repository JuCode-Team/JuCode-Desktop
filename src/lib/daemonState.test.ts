import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./protocol', () => ({
	daemon: {
		connect: vi.fn(() => Promise.resolve()),
		post: vi.fn(() => Promise.resolve()),
		request: vi.fn((op: { op: string; schedule?: Record<string, unknown> }) =>
			Promise.resolve(
				op.op === 'schedule_save'
					? { type: 'schedule_saved', schedule: { id: 'sch-new', ...op.schedule } }
					: op.op === 'schedule_run'
						? { type: 'schedule_started', schedule: 'sch-new', session: 's-run' }
						: {}
			)
		)
	}
}));

import { DaemonState } from './daemonState.svelte';
import { daemon } from './protocol';

beforeEach(() => vi.clearAllMocks());

const action = (id: string) => ({ id, session_id: 's1', cwd: '/w', name: 'bash', arguments: '{}', summary: 'ls', created_at: 1 });

describe('DaemonState', () => {
	it('tells of an action deferred after the first list, not of those waiting at connect', () => {
		const state = new DaemonState();
		const told: string[] = [];
		state.onAction = (a) => told.push(a.id);
		state.handle({ type: 'actions', actions: [action('a1')], closed: [] });
		state.handle({ type: 'actions', actions: [action('a1'), action('a2')], closed: [] });
		expect(told).toEqual(['a2']);
		expect(state.actions.map((a) => a.id)).toEqual(['a1', 'a2']);
	});

	it('tells of a session that stopped running, not of one whose state the daemon does not send', () => {
		const state = new DaemonState();
		const told: string[] = [];
		state.onFinished = (s) => told.push(s);
		const view = (session: string, busy?: boolean) => ({ session, cwd: '/w', created_at: 1, open: true, ...(busy === undefined ? {} : { busy }) });
		state.handle({ type: 'sessions', sessions: [view('s1', true), view('s2', false), view('s3')] });
		state.handle({ type: 'sessions', sessions: [view('s1', false), view('s2', false), view('s3')] });
		state.handle({ type: 'sessions', sessions: [view('s1', false), view('s2', false), view('s3')] });
		expect(told).toEqual(['s1']);
	});

	it('passes on a scheduled run that needs the user', () => {
		const state = new DaemonState();
		const onEvent = vi.fn();
		state.onScheduleEvent = onEvent;
		state.handle({ type: 'schedule_event', schedule: 'sch-1', name: '巡检', kind: 'failed', detail: 'HTTP 502', session: 's1' });
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ schedule: 'sch-1', kind: 'failed', session: 's1' }));
	});

	it('saves, switches, runs and deletes scheduled tasks', async () => {
		const state = new DaemonState();
		const saved = await state.saveSchedule({
			name: 'n', prompt: 'p', cwd: '/w', engine: 'claude', mode: 'auto', options: { jucode_gateway: true },
			enabled: true, repeat: 'daily', time: '09:00', days: [], date: '', worktree: false, budget: ''
		});
		expect(daemon.request).toHaveBeenLastCalledWith({
			op: 'schedule_save',
			schedule: expect.objectContaining({ cwd: '/w', engine: 'claude', options: { jucode_gateway: true } })
		});
		expect(state.schedules.map((s) => s.id)).toEqual([saved.id]);
		expect(await state.runSchedule(saved.id)).toBe('s-run');
		await state.deleteSchedule(saved.id);
		expect(daemon.request).toHaveBeenLastCalledWith({ op: 'schedule_delete', schedule: 'sch-new' });
		expect(state.schedules).toEqual([]);
	});

	it('decides and closes actions by id', async () => {
		const state = new DaemonState();
		state.handle({ type: 'actions', actions: [action('a1')], closed: [] });
		await state.decide(action('a1'), true);
		expect(daemon.post).toHaveBeenCalledWith({ op: 'decide_action', session: 's1', action: 'a1', decision: 'allow' });
		expect(state.actions).toEqual([]);
		await state.close('a2');
		expect(daemon.request).toHaveBeenLastCalledWith({ op: 'item_close', kind: 'action', item: 'a2' });
	});
});
