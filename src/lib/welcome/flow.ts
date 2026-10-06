import type { DepReport } from '$lib/protocol';

export const STEPS = ['env', 'account', 'agent', 'model', 'appearance', 'basics'] as const;
export type StepKey = (typeof STEPS)[number];
export type StepStatus = Record<StepKey, boolean>;

export function requiredDepsReady(list: DepReport[]): boolean {
	return ['node', 'git'].every((id) => list.some((dep) => dep.id === id && dep.present));
}

export function canVisitStep(step: StepKey, done: StepStatus): boolean {
	return STEPS.slice(0, STEPS.indexOf(step)).every((key) => done[key]);
}

export function canFinishSetup(step: StepKey, done: StepStatus): boolean {
	return step === STEPS[STEPS.length - 1] && STEPS.every((key) => done[key]);
}
