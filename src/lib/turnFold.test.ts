import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { turnFolds } from './turnFold';

const user = (text: string): Msg => ({ kind: 'user', text });
const reply = (text: string, elapsed?: number): Msg =>
	({ kind: 'assistant', text, ...(elapsed ? { turn: { elapsed, inTokens: 0, outTokens: 0, tools: 0, cost: 0, model: '', segments: 1 } } : {}) }) as Msg;
const think = (text: string): Msg => ({ kind: 'reasoning', text, collapsed: true });
const tool = (name: string, output = '{}'): Msg => ({ kind: 'tool', callId: '', name, output, running: false, isError: false });
const all = () => true;

describe('turnFolds', () => {
	it('folds the work of a finished turn and keeps the final reply', () => {
		const q = user('fix it');
		const work = [think('look'), tool('read'), reply('found it'), tool('str_replace', '{"path":"a.ts"}'), tool('bash')];
		const answer = reply('done', 4200);
		const [fold] = turnFolds([q, ...work, answer], all, false);
		expect(fold!.key).toBe(q);
		expect(fold!.members).toEqual(work);
		expect(fold).toMatchObject({ elapsed: 4200, calls: 3, files: 1, commands: 1 });
	});

	it('leaves the running turn, and a turn without tools or thinking, alone', () => {
		const msgs = [user('hi'), reply('hello'), user('go'), tool('bash'), reply('ok')];
		expect(turnFolds(msgs, all, true)).toEqual([]);
		expect(turnFolds(msgs, all, false).map((f) => f.key)).toEqual([msgs[2]]);
	});

	it('folds what a running turn finished before, and leaves what runs now open', () => {
		const q = user('go');
		const work = [tool('bash'), think('so')];
		const answer = reply('started it', 900);
		const after = [tool('read'), reply('the task finished')];
		const [fold] = turnFolds([q, ...work, answer, ...after], all, true);
		expect(fold!.members).toEqual(work);
		expect(fold!.elapsed).toBe(900);
	});

	it('keeps plans and errors in view, and folds a turn that ended without a reply', () => {
		const err: Msg = { kind: 'error', text: 'boom' };
		const plan: Msg = { kind: 'plan', id: 'p', title: 't', text: '', status: 'pending' };
		const [fold] = turnFolds([user('go'), tool('bash'), plan, tool('read'), err], all, false);
		expect(fold!.members.map((m) => m.kind)).toEqual(['tool', 'tool']);
		expect(fold!.elapsed).toBeNull();
	});

	it('counts subagent deliveries as part of the turn, not a new one', () => {
		const delivery = user('[message from agent helper · a1]\nall done');
		const folds = turnFolds([user('go'), tool('bash'), delivery, reply('done')], all, false);
		expect(folds).toHaveLength(1);
		expect(folds[0]!.members).toContain(delivery);
	});
});
