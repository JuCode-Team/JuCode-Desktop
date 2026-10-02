import { describe, it, expect, vi } from 'vitest';
import { Dispatches, type DispatchView } from './dispatch.svelte';
import type { DaemonClient } from '$lib/daemon';

describe('Dispatches', () => {
	it('follows the daemon list and sends the user choices as they are', async () => {
		const request = vi.fn(async (op: Record<string, unknown>) => ({ type: 'ok', dispatch: { id: 'd1' }, op }));
		const store = new Dispatches({ request } as unknown as DaemonClient);
		const d = (status: DispatchView['status']) => ({ id: status, status, tasks: [] }) as unknown as DispatchView;
		store.handle({ type: 'dispatches', dispatches: [d('awaiting'), d('running'), d('awaiting')] });
		expect(store.pending).toBe(2);
		store.handle({ type: 'sessions', sessions: [] });
		expect(store.list).toHaveLength(3);

		await store.send('修好登录；加分页', true, 'full-access');
		await store.confirm('d1', false);
		expect(request.mock.calls.map(([op]) => op)).toEqual([
			{ op: 'dispatch_send', text: '修好登录；加分页', plan: true, approval_mode: 'full-access' },
			{ op: 'dispatch_confirm', dispatch: 'd1', approve: false, note: '' }
		]);
	});
});
