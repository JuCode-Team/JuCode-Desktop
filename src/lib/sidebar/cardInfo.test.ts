import { describe, expect, it } from 'vitest';
import type { Msg } from '$lib/chat.svelte';
import { cardInfo } from './cardInfo';

const edit = (path: string, add: number, del: number): Msg => ({
	kind: 'tool',
	callId: path,
	name: 'str_replace',
	output: JSON.stringify({ path, add, del }),
	running: false,
	isError: false
});
const base = { plan: [], pendingMessages: [], subagents: {}, agentRuns: { workflows: [], agents: [] }, bgTasks: [] };

describe('cardInfo', () => {
	it('counts the lines the latest turn changed, not earlier ones', () => {
		const messages: Msg[] = [{ kind: 'user', text: 'a' }, edit('x.ts', 9, 9), { kind: 'user', text: 'b' }, edit('y.ts', 3, 1), edit('z.ts', 2, 0)];
		expect(cardInfo({ ...base, messages }).diff).toEqual({ add: 5, del: 1 });
	});

	it('leaves out what there is none of', () => {
		expect(cardInfo({ ...base, messages: [{ kind: 'user', text: 'a' }] })).toEqual({ diff: null, plan: null, tasks: 0, queued: 0 });
	});

	it('shows an unfinished plan and the queued messages', () => {
		const plan = [
			{ step: 'one', status: 'completed' },
			{ step: 'two', status: 'in_progress' },
			{ step: 'three', status: 'pending' }
		];
		const info = cardInfo({ ...base, messages: [], plan, pendingMessages: ['later'] } as never);
		expect(info.plan).toEqual({ done: 1, total: 3 });
		expect(info.queued).toBe(1);
	});
});
