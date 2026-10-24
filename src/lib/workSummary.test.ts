import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { workSummary } from './workSummary';

type Tool = Extract<Msg, { kind: 'tool' }>;
const tool = (name: string, output: object = {}, isError = false): Tool => ({ kind: 'tool', callId: '', name, output: JSON.stringify(output), running: false, isError });

describe('workSummary', () => {
	it('keeps edits and commands, and counts the rest as other actions', () => {
		const run = [
			tool('read', { path: 'a.ts' }),
			tool('str_replace', { path: 'a.ts' }),
			tool('bash', { command: 'ls' }),
			tool('str_replace', { path: 'a.ts' }),
			tool('write', { path: 'b.ts' }),
			tool('read', { path: 'b.ts' }),
			tool('bash', { command: 'pnpm test' })
		];
		expect(workSummary(run)).toEqual({ parts: [{ key: 'files', n: 2 }, { key: 'commands', n: 2 }], others: 2 });
	});

	it('shows the two parts in the order they came', () => {
		const run = [tool('ripgrep', { pattern: 'x' }), tool('read', { path: 'a' }), tool('read', { path: 'b' })];
		expect(workSummary(run)).toEqual({ parts: [{ key: 'searches', n: 1 }, { key: 'reads', n: 2 }], others: 0 });
	});

	it('does not count a failed edit as a changed file', () => {
		const run = [tool('str_replace', { path: 'a.ts', error: 'no match' }), tool('bash', {}, true)];
		expect(workSummary(run)).toEqual({ parts: [{ key: 'tools', n: 1 }, { key: 'commands', n: 1 }], others: 0 });
	});

	it('reads what an ACP call does from its kind, not its title', () => {
		const run = [tool('Edit a.rs', { kind: 'edit', path: 'a.rs' }), tool('cargo test', { kind: 'execute' }), tool('Read b.rs', { kind: 'read' })];
		expect(workSummary(run)).toEqual({ parts: [{ key: 'files', n: 1 }, { key: 'commands', n: 1 }], others: 1 });
	});

	it('counts an edit that names no file as one file', () => {
		expect(workSummary([tool('apply_patch'), tool('apply_patch', { paths: ['x', 'y'] })]).parts).toEqual([{ key: 'files', n: 3 }]);
	});
});
