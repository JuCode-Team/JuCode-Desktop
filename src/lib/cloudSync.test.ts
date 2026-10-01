import { describe, it, expect } from 'vitest';
import { planSync, stableJson } from './cloudSync.svelte';

const at = (value: unknown, updated_at: number) => ({ value, updated_at });

describe('stableJson', () => {
	it('ignores key order', () => {
		expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableJson({ a: [{ c: 2, d: 1 }], b: 1 }));
	});
});

describe('planSync', () => {
	it('a computer syncing first takes the cloud and uploads what it lacks', () => {
		const plan = planSync({ 'ui.theme': 'dark', 'ui.locale': 'en' }, { 'ui.theme': at('light', 5) }, {});
		expect(plan).toEqual({ apply: { 'ui.theme': 'light' }, push: { 'ui.locale': 'en' } });
	});

	it('a value changed here is pushed', () => {
		const state = { 'ui.theme': { value: stableJson('light'), at: 5 } };
		const plan = planSync({ 'ui.theme': 'dark' }, { 'ui.theme': at('light', 5) }, state);
		expect(plan).toEqual({ apply: {}, push: { 'ui.theme': 'dark' } });
	});

	it('a newer cloud value is applied when nothing changed here', () => {
		const state = { 'ui.theme': { value: stableJson('light'), at: 5 } };
		const plan = planSync({ 'ui.theme': 'light' }, { 'ui.theme': at('dark', 9) }, state);
		expect(plan).toEqual({ apply: { 'ui.theme': 'dark' }, push: {} });
	});

	it('nothing moves when both sides agree', () => {
		const state = { 'ui.theme': { value: stableJson('dark'), at: 9 } };
		expect(planSync({ 'ui.theme': 'dark' }, { 'ui.theme': at('dark', 9) }, state)).toEqual({ apply: {}, push: {} });
	});

	it('a key the cloud lost is uploaded again', () => {
		const state = { 'ui.theme': { value: stableJson('dark'), at: 9 } };
		expect(planSync({ 'ui.theme': 'dark' }, {}, state)).toEqual({ apply: {}, push: { 'ui.theme': 'dark' } });
	});
});
