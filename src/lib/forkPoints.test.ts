import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { forkPoints } from './forkPoints';

const user = (text: string): Msg => ({ kind: 'user', text });
const reply = (text: string): Msg => ({ kind: 'assistant', text });
const tool: Msg = { kind: 'tool', callId: '', name: 'bash', output: '', running: false, isError: false };

describe('forkPoints', () => {
	it("forks from each turn's last reply, keeping that turn and those before", () => {
		const first = reply('done');
		const second = reply('also done');
		const msgs = [user('a'), reply('looking'), tool, first, user('b'), second];
		expect([...forkPoints(msgs, false)]).toEqual([
			[first, 1],
			[second, 2]
		]);
	});

	it('does not fork from the turn still running, or a turn without a reply', () => {
		const done = reply('done');
		expect([...forkPoints([user('a'), done, user('b'), reply('half')], true)]).toEqual([[done, 1]]);
		expect(forkPoints([user('a'), tool, user('b')], false).size).toBe(0);
	});
});
