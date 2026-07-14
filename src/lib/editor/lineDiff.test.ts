import { describe, it, expect } from 'vitest';
import { lineDiff, gutterMarks, MAX_DIFF_LINES, type DiffChunk } from './lineDiff';

const join = (...lines: string[]) => lines.join('\n');

/** Sanity: applying the chunks to `a` must reproduce `b`. */
function apply(a: string, b: string, chunks: DiffChunk[]): string {
	const al = a.split('\n');
	const bl = b.split('\n');
	const out: string[] = [];
	let pos = 0;
	for (const c of chunks) {
		out.push(...al.slice(pos, c.fromA));
		out.push(...bl.slice(c.fromB, c.toB));
		pos = c.toA;
	}
	out.push(...al.slice(pos));
	return out.join('\n');
}

describe('lineDiff', () => {
	it('identical texts produce no chunks', () => {
		expect(lineDiff('a\nb\nc', 'a\nb\nc')).toEqual([]);
		expect(lineDiff('', '')).toEqual([]);
	});

	it('pure insertion', () => {
		const chunks = lineDiff(join('a', 'c'), join('a', 'b', 'c'))!;
		expect(chunks).toEqual([{ fromA: 1, toA: 1, fromB: 1, toB: 2 }]);
	});

	it('pure deletion', () => {
		const chunks = lineDiff(join('a', 'b', 'c'), join('a', 'c'))!;
		expect(chunks).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 1 }]);
	});

	it('single line modification', () => {
		const chunks = lineDiff(join('a', 'b', 'c'), join('a', 'B', 'c'))!;
		expect(chunks).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 2 }]);
	});

	it('insertion at start and end', () => {
		expect(lineDiff(join('a'), join('x', 'a'))).toEqual([{ fromA: 0, toA: 0, fromB: 0, toB: 1 }]);
		expect(lineDiff(join('a'), join('a', 'x'))).toEqual([{ fromA: 1, toA: 1, fromB: 1, toB: 2 }]);
	});

	it('deletion at start and end', () => {
		expect(lineDiff(join('x', 'a'), join('a'))).toEqual([{ fromA: 0, toA: 1, fromB: 0, toB: 0 }]);
		expect(lineDiff(join('a', 'x'), join('a'))).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 1 }]);
	});

	it('empty old text vs content (new file)', () => {
		const chunks = lineDiff('', join('a', 'b'))!;
		expect(apply('', join('a', 'b'), chunks)).toBe(join('a', 'b'));
	});

	it('content vs empty new text', () => {
		const chunks = lineDiff(join('a', 'b'), '')!;
		expect(apply(join('a', 'b'), '', chunks)).toBe('');
	});

	it('multiple separated edits produce separate chunks', () => {
		const a = join('1', '2', '3', '4', '5', '6', '7');
		const b = join('1', 'two', '3', '4', '5', 'six', '6.5', '7');
		const chunks = lineDiff(a, b)!;
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(apply(a, b, chunks)).toBe(b);
	});

	it('adjacent delete+insert coalesce into one replacement chunk', () => {
		const a = join('keep', 'old1', 'old2', 'tail');
		const b = join('keep', 'new1', 'new2', 'new3', 'tail');
		const chunks = lineDiff(a, b)!;
		expect(chunks).toEqual([{ fromA: 1, toA: 3, fromB: 1, toB: 4 }]);
	});

	it('round-trips random-ish edits (apply reproduces new text)', () => {
		const a = Array.from({ length: 200 }, (_, i) => `line-${i}`).join('\n');
		const bl = a.split('\n');
		bl.splice(10, 3, 'changed-a', 'changed-b');
		bl.splice(50, 0, 'inserted');
		bl.splice(120, 5);
		bl[180] = 'tail-mod';
		const b = bl.join('\n');
		const chunks = lineDiff(a, b)!;
		expect(apply(a, b, chunks)).toBe(b);
	});

	it('handles repeated lines correctly', () => {
		const a = join('x', 'x', 'x');
		const b = join('x', 'x', 'x', 'x');
		const chunks = lineDiff(a, b)!;
		expect(apply(a, b, chunks)).toBe(b);
	});

	it('returns null above the line cap (gutter disabled)', () => {
		const big = Array.from({ length: MAX_DIFF_LINES + 1 }, () => 'l').join('\n');
		expect(lineDiff(big, 'a')).toBeNull();
		expect(lineDiff('a', big)).toBeNull();
	});

	it('degrades to a coarse chunk when edit distance explodes', () => {
		// Completely disjoint content forces the D budget to blow — expect a
		// single replacement chunk that still round-trips.
		const a = Array.from({ length: 6000 }, (_, i) => `a-${i}`).join('\n');
		const b = Array.from({ length: 6000 }, (_, i) => `b-${i}`).join('\n');
		const chunks = lineDiff(a, b)!;
		expect(chunks).toEqual([{ fromA: 0, toA: 6000, fromB: 0, toB: 6000 }]);
		expect(apply(a, b, chunks)).toBe(b);
	});
});

describe('gutterMarks', () => {
	it('classifies inserts as added and replacements as modified', () => {
		const marks = gutterMarks(
			[
				{ fromA: 1, toA: 1, fromB: 1, toB: 3 }, // insert 2 lines
				{ fromA: 5, toA: 6, fromB: 7, toB: 8 } // replace 1 line
			],
			20
		);
		expect(marks).toEqual([
			{ line: 1, type: 'added' },
			{ line: 2, type: 'added' },
			{ line: 7, type: 'modified' }
		]);
	});

	it('marks deletions on the following line, clamped into the doc', () => {
		expect(gutterMarks([{ fromA: 2, toA: 4, fromB: 2, toB: 2 }], 10)).toEqual([
			{ line: 2, type: 'deleted' }
		]);
		// Deletion at end of document clamps to the last line.
		expect(gutterMarks([{ fromA: 9, toA: 10, fromB: 9, toB: 9 }], 9)).toEqual([
			{ line: 8, type: 'deleted' }
		]);
	});

	it('replacement that also shrinks still reads as modified', () => {
		expect(gutterMarks([{ fromA: 0, toA: 3, fromB: 0, toB: 1 }], 5)).toEqual([
			{ line: 0, type: 'modified' }
		]);
	});
});
