import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { keyOf, timeline } from './timeline';

const user = (text: string): Msg => ({ kind: 'user', text });
const reply = (text: string, elapsed?: number): Msg =>
	({ kind: 'assistant', text, ...(elapsed ? { turn: { elapsed, inTokens: 0, outTokens: 0, tools: 0, cost: 0, model: '', segments: 1 } } : {}) }) as Msg;
const think = (text: string): Msg => ({ kind: 'reasoning', text, collapsed: true });
const tool = (name: string, output = '{}'): Msg => ({ kind: 'tool', callId: '', name, output, running: false, isError: false });
const note = (text: string): Msg => ({ kind: 'system', text });
const opts = { shows: (m: Msg) => m.kind !== 'system', ownRow: () => false, foldTurns: true, busy: false };

describe('timeline', () => {
	it('makes a run of calls, with the reasoning before each, one row', () => {
		const q = user('go');
		const run = [think('a'), tool('read'), note('task done'), tool('bash'), think('b'), tool('grep')];
		const after = think('then');
		const { blocks } = timeline([q, ...run, after, reply('ok')], { ...opts, foldTurns: false });
		expect(blocks.map((b) => b.item?.m.kind)).toEqual(['user', 'reasoning', 'reasoning', 'assistant']);
		expect(blocks[1]!.item!.run).toEqual(run.filter((m) => m.kind !== 'system'));
	});

	it('keeps a long run in one block, whatever its length', () => {
		const calls = Array.from({ length: 500 }, (_, i) => tool(`t${i}`));
		const { blocks, blockOf } = timeline([user('go'), reply('starting'), ...calls], { ...opts, busy: true });
		expect(blocks).toHaveLength(3);
		expect(calls.every((m) => blockOf.get(m) === 2)).toBe(true);
	});

	it('folds a finished turn into one block where its work began', () => {
		const q = user('fix');
		const work = [tool('read'), reply('found'), tool('edit')];
		const answer = reply('done', 1000);
		const err: Msg = { kind: 'error', text: 'x' };
		const { blocks, blockOf, foldOf } = timeline([q, ...work, answer, err], opts);
		expect(blocks.map((b) => (b.fold ? 'fold' : b.item!.m.kind))).toEqual(['user', 'fold', 'assistant', 'error']);
		expect(blocks[1]!.fold!.items.map((it) => it.m)).toEqual(work);
		expect(blockOf.get(work[2]!)).toBe(1);
		expect(foldOf.get(work[0]!)?.key).toBe(q);
	});

	it('keys rows by message, so they keep their keys as the conversation changes', () => {
		const q = user('go');
		const t = tool('read');
		const before = timeline([q, t], { ...opts, busy: true });
		const after = timeline([note('x'), q, t, reply('ok')], { ...opts, busy: true });
		expect(after.blocks.map((b) => b.key).slice(0, 2)).toEqual(before.blocks.map((b) => b.key));
		expect(before.blocks[1]!.key).toBe(keyOf(t));
	});

	it("puts a finished turn's summary under its last block, not the running turn's", () => {
		const edit = tool('str_replace', JSON.stringify({ path: '/a.ts', diff: '+x' }));
		const msgs = [user('one'), edit, reply('done', 10), user('two'), tool('str_replace', JSON.stringify({ path: '/b.ts', diff: '+y' }))];
		const { blocks } = timeline(msgs, { ...opts, busy: true });
		const withSummary = blocks.filter((b) => b.summary);
		expect(withSummary).toHaveLength(1);
		expect(withSummary[0]!.item?.m).toBe(msgs[2]);
	});
});
