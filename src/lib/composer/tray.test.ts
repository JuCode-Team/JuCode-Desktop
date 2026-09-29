import { describe, it, expect } from 'vitest';
import { answerStep, startFlow, togglePick, trayNav } from './tray';
import type { Question } from '$lib/approval';

const none = (n: number) => Array(n).fill(false);

describe('trayNav', () => {
	it('moves down/up with wraparound', () => {
		expect(trayNav('ArrowDown', 0, none(3))).toEqual({ kind: 'move', index: 1 });
		expect(trayNav('ArrowDown', 2, none(3))).toEqual({ kind: 'move', index: 0 });
		expect(trayNav('ArrowUp', 0, none(3))).toEqual({ kind: 'move', index: 2 });
	});
	it('skips disabled rows', () => {
		const d = [false, true, false];
		expect(trayNav('ArrowDown', 0, d)).toEqual({ kind: 'move', index: 2 });
		expect(trayNav('ArrowUp', 2, d)).toEqual({ kind: 'move', index: 0 });
		expect(trayNav('Home', 2, [true, false, false])).toEqual({ kind: 'move', index: 1 });
		expect(trayNav('End', 0, [false, false, true])).toEqual({ kind: 'move', index: 1 });
	});
	it('picks only enabled rows on Enter', () => {
		expect(trayNav('Enter', 1, none(2))).toEqual({ kind: 'pick' });
		expect(trayNav('Enter', 1, [false, true])).toBeNull();
	});
	it('handles Tab per mode', () => {
		expect(trayNav('Tab', 0, none(2), 'pick')).toEqual({ kind: 'pick' });
		expect(trayNav('Tab', 0, none(2), 'close')).toEqual({ kind: 'close' });
		expect(trayNav('Tab', 0, none(2))).toBeNull();
	});
	it('closes on Escape and ignores other keys / empty lists', () => {
		expect(trayNav('Escape', 0, none(2))).toEqual({ kind: 'close' });
		expect(trayNav('a', 0, none(2))).toBeNull();
		expect(trayNav('ArrowDown', 0, [])).toBeNull();
		expect(trayNav('ArrowDown', 0, [true, true])).toBeNull();
	});
});

describe('togglePick', () => {
	it('adds and removes, keeping order', () => {
		expect(togglePick(['a'], 'b')).toEqual(['a', 'b']);
		expect(togglePick(['a', 'b'], 'a')).toEqual(['b']);
	});
});

describe('answerStep', () => {
	const qs: Question[] = [
		{ question: 'Which DB?', options: [{ label: 'pg' }], multiSelect: false },
		{ question: 'Features?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: true }
	];
	it('steps through questions and reports done with the full answer map', () => {
		const one = answerStep(qs, startFlow(), 'pg');
		expect(one).toEqual({ flow: { step: 1, answers: { 'Which DB?': 'pg' } }, done: false });
		const two = answerStep(qs, one.flow, 'a, b');
		expect(two.done).toBe(true);
		expect(two.flow.answers).toEqual({ 'Which DB?': 'pg', 'Features?': 'a, b' });
	});
	it('accepts free-form text as an answer', () => {
		const r = answerStep(qs.slice(0, 1), startFlow(), 'sqlite, actually');
		expect(r.done).toBe(true);
		expect(r.flow.answers).toEqual({ 'Which DB?': 'sqlite, actually' });
	});
});
