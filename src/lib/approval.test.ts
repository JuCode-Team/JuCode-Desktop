import { describe, it, expect } from 'vitest';
import {
	allHunkIds,
	buildApproveOp,
	buildSetApprovalModeOp,
	fromEngineMode,
	parseHunks,
	reconcileMode,
	selectionState,
	toEngineMode,
	toggleHunk,
	type ApprovalHunk,
	type ApprovalMode
} from './approval';

const HUNKS: ApprovalHunk[] = [
	{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
	{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] },
	{ id: 'f1h1', file: 'src/b.rs', header: '@@ -1,1 +1,1 @@', lines: ['-e', '+f'] }
];

describe('approval mode mapping', () => {
	it('maps each desktop mode to its engine mode and back (round trip)', () => {
		const modes: ApprovalMode[] = ['ask', 'edits', 'all'];
		for (const m of modes) expect(fromEngineMode(toEngineMode(m))).toBe(m);
		expect(toEngineMode('ask')).toBe('read-only');
		expect(toEngineMode('edits')).toBe('auto-edit');
		expect(toEngineMode('all')).toBe('full-auto');
	});

	it('returns null for an unknown engine mode', () => {
		expect(fromEngineMode('yolo')).toBeNull();
		expect(fromEngineMode('')).toBeNull();
	});

	it('reconciles from an approval_mode event, keeping the current mode on garbage', () => {
		expect(reconcileMode('ask', 'full-auto')).toBe('all');
		expect(reconcileMode('all', 'read-only')).toBe('ask');
		expect(reconcileMode('edits', 'not-a-mode')).toBe('edits');
	});

	it('builds the set_approval_mode op', () => {
		expect(buildSetApprovalModeOp('edits')).toEqual({ op: 'set_approval_mode', mode: 'auto-edit' });
	});
});

describe('parseHunks', () => {
	it('parses the approval_request hunks array', () => {
		expect(
			parseHunks([{ id: 'f0h1', file: 'x.ts', header: '@@', lines: [' a', '+b'] }])
		).toEqual([{ id: 'f0h1', file: 'x.ts', header: '@@', lines: [' a', '+b'] }]);
	});

	it('collapses null / absent / malformed hunks to null (whole-call approval)', () => {
		expect(parseHunks(null)).toBeNull();
		expect(parseHunks(undefined)).toBeNull();
		expect(parseHunks('f0h1')).toBeNull();
		expect(parseHunks([{ file: 'x.ts' }])).toBeNull(); // missing id
		expect(parseHunks([{ id: '' }])).toBeNull();
	});
});

describe('hunk selection', () => {
	it('toggles a hunk in and out of the selection', () => {
		let sel = allHunkIds(HUNKS);
		sel = toggleHunk(sel, 'f0h2');
		expect(sel).toEqual(['f0h1', 'f1h1']);
		sel = toggleHunk(sel, 'f0h2');
		expect(sel).toContain('f0h2');
		expect(sel).toHaveLength(3);
	});

	it('classifies all / some / none selections', () => {
		expect(selectionState(HUNKS, allHunkIds(HUNKS))).toBe('all');
		expect(selectionState(HUNKS, ['f0h1'])).toBe('some');
		expect(selectionState(HUNKS, [])).toBe('none');
		// ids not in the hunk list don't count towards the selection
		expect(selectionState(HUNKS, ['ghost'])).toBe('none');
	});
});

describe('buildApproveOp', () => {
	it('builds a whole-call allow (no hunks / always keys)', () => {
		expect(buildApproveOp('call_1', 'allow')).toEqual({
			op: 'approve',
			call_id: 'call_1',
			decision: 'allow'
		});
	});

	it('builds a subset allow with the checked hunk ids', () => {
		expect(buildApproveOp('call_1', 'allow', { hunks: ['f0h1', 'f1h1'] })).toEqual({
			op: 'approve',
			call_id: 'call_1',
			decision: 'allow',
			hunks: ['f0h1', 'f1h1']
		});
	});

	it('builds a deny and an always-allow', () => {
		expect(buildApproveOp('call_9', 'deny')).toEqual({
			op: 'approve',
			call_id: 'call_9',
			decision: 'deny'
		});
		expect(buildApproveOp('call_9', 'allow', { always: true })).toEqual({
			op: 'approve',
			call_id: 'call_9',
			decision: 'allow',
			always: true
		});
	});

	it('rejects always with hunks (always is whole-call only)', () => {
		expect(() => buildApproveOp('c', 'allow', { always: true, hunks: ['f0h1'] })).toThrow();
	});

	it('rejects hunks on a deny (partial approval is allow-only)', () => {
		expect(() => buildApproveOp('c', 'deny', { hunks: ['f0h1'] })).toThrow();
	});
});
