import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '$lib/daemon';
import { Requirements, gateNext, gateOf, grouped, groupOf, workMode, type Requirement } from './requirements.svelte';

const req = (id: string, status: Requirement['status'], updated_at = 0, sessions: string[] = []): Requirement => ({
	id,
	text: id,
	title: id,
	images: [],
	project: null,
	state: status === 'idea' || status === 'done' || status === 'parked' || status === 'proposed' ? status : 'open',
	status,
	sessions,
	progress: null,
	source: 'desktop',
	created_at: 0,
	updated_at
});

describe('requirements', () => {
	it('groups by whose turn it is, the latest change first', () => {
		expect(groupOf('review')).toBe('attention');
		expect(groupOf('approval')).toBe('attention');
		expect(groupOf('failed')).toBe('attention');
		expect(groupOf('confirm')).toBe('attention');
		expect(groupOf('proposed')).toBe('attention');
		expect(groupOf('proposal')).toBe('attention');
		expect(groupOf('running')).toBe('active');
		expect(groupOf('open')).toBe('active');
		expect(groupOf('parked')).toBe('closed');
		const g = grouped([req('R-1', 'review', 1), req('R-2', 'idea'), req('R-3', 'approval', 5), req('R-4', 'done')]);
		expect(g.attention.map((r) => r.id)).toEqual(['R-3', 'R-1']);
		expect(g.idea.map((r) => r.id)).toEqual(['R-2']);
		expect(g.closed.map((r) => r.id)).toEqual(['R-4']);
	});

	it('takes the daemon list and maps sessions to their requirement', () => {
		const reqs = new Requirements({ request: vi.fn() } as unknown as DaemonClient);
		reqs.handle({ type: 'requirements', requirements: [req('R-1', 'review', 0, ['s1', 's2']), req('R-2', 'idea')] });
		reqs.handle({ type: 'dispatches', dispatches: [] });
		expect(reqs.pending).toBe(1);
		expect(reqs.bySession.get('s2')?.id).toBe('R-1');
		expect(reqs.get('R-2')?.status).toBe('idea');
	});

	it('sends the requirement as `requirement` and fetches a screenshot once', async () => {
		const request = vi.fn(async (op: Record<string, unknown>) =>
			op.op === 'requirement_image' ? { data: 'data:image/png;base64,eA==' } : { session: 's9', text: 'prompt' }
		);
		const reqs = new Requirements({ request } as unknown as DaemonClient);
		expect(await reqs.reply('R-1', { text: 'more', newSession: true })).toBe('s9');
		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({ op: 'requirement_reply', requirement: 'R-1', text: 'more', new_session: true })
		);
		await reqs.image('R-1', 0);
		await reqs.image('R-1', 0);
		expect(request.mock.calls.filter(([op]) => op.op === 'requirement_image')).toHaveLength(1);
	});

	it('names the gate step and the mode the work runs in', () => {
		const gate = { session: 's1', stage: 'understand' as const, plan: true, mode: 'auto' };
		expect(gateNext(gate)).toBe('understandPlan');
		expect(gateNext({ ...gate, plan: false })).toBe('understandGo');
		expect(gateNext({ ...gate, stage: 'plan' })).toBe('planGo');
		const r = { ...req('R-1', 'confirm'), gate };
		expect(gateOf(r, 's1')).toBe(gate);
		expect(gateOf(r, 's2')).toBeUndefined();
		expect(workMode('plan')).toBe('edits');
		expect(workMode('auto')).toBe('auto');
	});

	it('begins, confirms and answers proposals with the spec ops', async () => {
		const request = vi.fn(async () => ({}));
		const reqs = new Requirements({ request } as unknown as DaemonClient);
		await reqs.begin('R-1', { session: 's1', plan: true, mode: 'edits', text: 'note' });
		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({ op: 'requirement_begin', requirement: 'R-1', session: 's1', plan: true, mode: 'edits', text: 'note' })
		);
		await reqs.confirm('R-1', 'go');
		expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'requirement_confirm', requirement: 'R-1', text: 'go' }));
		await reqs.answerProposal('R-1', false);
		expect(request).toHaveBeenLastCalledWith({ op: 'requirement_proposal', requirement: 'R-1', accept: false });
		await reqs.reply('R-1', { newSession: true, plan: true, mode: 'auto' });
		expect(request).toHaveBeenLastCalledWith(
			expect.objectContaining({ op: 'requirement_reply', new_session: true, plan: true, mode: 'auto' })
		);
	});
});
