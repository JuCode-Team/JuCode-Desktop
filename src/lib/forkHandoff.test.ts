import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { handoffPrompt } from './forkHandoff';

const user = (text: string): Msg => ({ kind: 'user', text });
const reply = (text: string): Msg => ({ kind: 'assistant', text });
const tool = (name: string, output: object): Msg => ({ kind: 'tool', callId: '', name, output: JSON.stringify(output), running: false, isError: false });

describe('handoffPrompt', () => {
	const taken = [user('fix the bug'), reply('fixed')];

	it("reads only the fork's own turns, with what its tools did", () => {
		const prompt = handoffPrompt([...taken, user('try another way'), tool('bash', { command: 'ls' }), tool('str_replace', { path: 'a.ts' }), reply('done')], 1);
		expect(prompt).not.toContain('fix the bug');
		expect(prompt).toMatch(/^User: try another way\n\n\(.+\)\n\nAgent: done$/);
	});

	it('names the branch of a worktree fork, and is empty before the fork goes on', () => {
		expect(handoffPrompt([...taken, user('go'), reply('ok')], 1, 'fork/x')).toMatch(/^The fork's changes are on git branch fork\/x/);
		expect(handoffPrompt(taken, 1)).toBe('');
	});

	it('keeps the end of a long fork', () => {
		const prompt = handoffPrompt([...taken, user('go'), reply('x'.repeat(20_000) + 'END')], 1);
		expect(prompt.startsWith('…')).toBe(true);
		expect(prompt.endsWith('END')).toBe(true);
	});
});
