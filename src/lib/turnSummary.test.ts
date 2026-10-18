import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { fileStats, relativeTo, turnSummary } from './turnSummary';

const tool = (name: string, output: unknown, isError = false): Msg => ({
	kind: 'tool',
	callId: '',
	name,
	output: JSON.stringify(output),
	running: false,
	isError
});

describe('turnSummary', () => {
	it('adds up edits per file and keeps the presented files and proposals', () => {
		const summary = turnSummary([
			{ kind: 'user', text: 'make it' },
			tool('str_replace', { path: '/p/a.ts', diff: '-x\n+y\n+z' }),
			tool('write', { path: '/p/a.ts', diff: '+w' }),
			tool('apply_patch', { path: '/p/b.ts', paths: ['/p/b.ts', '/p/c.ts'], diff: '', files: [{ path: '/p/b.ts', add: 3, del: 1 }, { path: '/p/c.ts', add: 0, del: 2 }] }),
			tool('str_replace', { path: '/p/failed.ts', error: 'no match' }, true),
			tool('present_files', { files: [{ path: '/p/out.mp4', description: '34 s film', size: 9 }] }),
			tool('present_files', { files: [{ path: '/p/page.html', description: '', size: 3 }, { path: '/p/out.mp4', description: 'final cut', size: 10 }] }),
			tool('propose_schedule', { id: 'prop-1', name: 'Tests', prompt: 'run tests', repeat: 'daily', time: '09:00' }),
			tool('start_session', { session: 's-1', engine: 'codex', title: 'Review', status: 'running' }),
			tool('start_session', 'a session started by another session cannot start sessions', true),
			{ kind: 'assistant', text: 'done' }
		]);
		expect(summary!.edited).toEqual([
			{ path: '/p/a.ts', add: 3, del: 1 },
			{ path: '/p/b.ts', add: 3, del: 1 },
			{ path: '/p/c.ts', add: 0, del: 2 }
		]);
		expect(summary!.artifacts.map((a) => [a.path, a.description])).toEqual([
			['/p/page.html', ''],
			['/p/out.mp4', 'final cut']
		]);
		expect(summary!.proposals.map((p) => p.id)).toEqual(['prop-1']);
		expect(summary!.children).toEqual([{ session: 's-1', engine: 'codex', title: 'Review' }]);
	});

	it('has nothing to show for a turn without edits or presented files', () => {
		expect(turnSummary([{ kind: 'user', text: 'hi' }, tool('present_files', 'no such file'), { kind: 'assistant', text: 'hello' }])).toBeNull();
	});

	it('splits a multi-file diff at its headers', () => {
		const diff = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b', '--- a/gone.ts', '+++ /dev/null', '-c'].join('\n');
		expect(fileStats({ diff })).toEqual([
			{ path: 'x.ts', add: 1, del: 1 },
			{ path: 'gone.ts', add: 0, del: 1 }
		]);
	});

	it('shows paths inside the folder relative to it', () => {
		expect(relativeTo('/p/src/a.ts', '/p/')).toBe('src/a.ts');
		expect(relativeTo('/other/a.ts', '/p')).toBe('/other/a.ts');
	});
});
