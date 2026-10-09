import { describe, it, expect } from 'vitest';
import { byPhase, elapsed, formatDuration, runState, timeline } from './agentTrace';
import type { AgentRun, WorkflowRun } from './chat.svelte';

const agent = (id: string, startedAt: number, durationMs: number, state = 'done', phase = 1): AgentRun => ({
	id,
	label: id,
	phase,
	model: '',
	state,
	startedAt,
	durationMs,
	tokens: 0,
	toolCalls: 0,
	prompt: '',
	result: '',
	error: '',
	type: '',
	toolUseId: '',
	activity: '',
	effort: ''
});

describe('agent trace', () => {
	it('reads the engine state words as five', () => {
		expect(['done', 'completed', 'start', 'failed', 'killed', 'pending'].map(runState)).toEqual([
			'done',
			'done',
			'running',
			'failed',
			'stopped',
			'queued'
		]);
	});

	it('times a running agent from its start', () => {
		expect(elapsed({ startedAt: 1000, durationMs: 200 }, 'running', 5000)).toBe(4000);
		expect(elapsed({ startedAt: 1000, durationMs: 200 }, 'done', 5000)).toBe(200);
	});

	it('writes durations in plain units', () => {
		const u = { s: 's', m: 'm', h: 'h' };
		expect(formatDuration(1843, u)).toBe('1.8 s');
		expect(formatDuration(125_000, u)).toBe('2 m 05 s');
		expect(formatDuration(3_720_000, u)).toBe('1 h 02 m');
	});

	it('lays agents out on one time axis', () => {
		const { bars } = timeline([agent('a', 0 + 1000, 1000), agent('b', 1500, 1500)], 0);
		expect(bars.get('a')).toEqual({ left: 0, width: 50 });
		expect(bars.get('b')).toEqual({ left: 25, width: 75 });
	});

	it('groups a workflow by phase, unphased agents last', () => {
		const run = {
			phases: [
				{ index: 1, title: 'Find' },
				{ index: 2, title: 'Verify' }
			],
			agents: [agent('a', 1, 1, 'done', 2), agent('b', 1, 1, 'done', 1), agent('c', 1, 1, 'done', 0)]
		} as WorkflowRun;
		expect(byPhase(run).map((g) => [g.title, g.agents.map((a) => a.id)])).toEqual([
			['Find', ['b']],
			['Verify', ['a']],
			['', ['c']]
		]);
	});
});
