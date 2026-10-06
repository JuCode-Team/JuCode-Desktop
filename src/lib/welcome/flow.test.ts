import { describe, expect, it } from 'vitest';
import { canFinishSetup, canVisitStep, requiredDepsReady, STEPS, type StepStatus } from './flow';
import type { DepReport } from '$lib/protocol';
const complete: StepStatus = { env: true, account: true, agent: true, model: true, appearance: true, basics: true };
const dep = (id: string, present: boolean): DepReport => ({ id, present, detail: '', plan: { kind: 'run', program: '', args: [] } });

describe('first-run flow', () => {
	it('puts all installation before account, agent and model choice', () => {
		expect(STEPS.slice(0, 4)).toEqual(['env', 'account', 'agent', 'model']);
	});
	it('requires Node and Git, not FFmpeg or gh', () => {
		expect(requiredDepsReady([dep('node', true), dep('git', true), dep('ffmpeg', false), dep('gh', false)])).toBe(true);
		for (const missing of ['node', 'git']) expect(requiredDepsReady([dep('node', missing !== 'node'), dep('git', missing !== 'git')])).toBe(false);
		expect(requiredDepsReady([])).toBe(false);
	});
	it('prevents skipping incomplete steps', () => {
		expect(canVisitStep('env', { ...complete, env: false })).toBe(true);
		expect(canVisitStep('agent', { ...complete, env: false })).toBe(false);
		expect(canVisitStep('appearance', { ...complete, model: false })).toBe(false);
		expect(canVisitStep('account', complete)).toBe(true);
	});
	it('only starts from the last step after all requirements are met', () => {
		for (const step of STEPS.slice(0, -1)) expect(canFinishSetup(step, complete)).toBe(false);
		for (const key of STEPS) expect(canFinishSetup('basics', { ...complete, [key]: false })).toBe(false);
		expect(canFinishSetup('basics', complete)).toBe(true);
	});
});
