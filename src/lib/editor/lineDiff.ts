// Pure line-level diff (Myers O(ND)) for the editor's git-HEAD gutter.
// Framework-free so it's unit-testable; bounded so a pathological file can't
// hang the UI: files beyond MAX_DIFF_LINES disable the gutter entirely, and a
// diff needing more than MAX_EDIT_DISTANCE edits degrades to one coarse
// "modified" chunk covering the changed middle.

export interface DiffChunk {
	/** Replaced range in the old text, [fromA, toA) in line numbers (0-based). */
	fromA: number;
	toA: number;
	/** Replacement range in the new text, [fromB, toB). */
	fromB: number;
	toB: number;
}

export type GutterMarkType = 'added' | 'modified' | 'deleted';
export interface GutterMark {
	/** 0-based line in the NEW document the mark attaches to. */
	line: number;
	type: GutterMarkType;
}

export const MAX_DIFF_LINES = 20_000;
const MAX_EDIT_DISTANCE = 2_000;

/**
 * Diff two documents line-by-line. Returns replacement chunks in ascending
 * order (pure inserts have fromA === toA; pure deletes fromB === toB), or
 * `null` when either side exceeds MAX_DIFF_LINES (gutter disabled).
 */
export function lineDiff(oldText: string, newText: string): DiffChunk[] | null {
	const a = oldText.split('\n');
	const b = newText.split('\n');
	if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;
	return computeChunks(a, b);
}

function computeChunks(a: string[], b: string[]): DiffChunk[] {
	const n = a.length;
	const m = b.length;
	// Trim the common prefix/suffix so Myers only sees the changed middle.
	let start = 0;
	while (start < n && start < m && a[start] === b[start]) start++;
	let endA = n;
	let endB = m;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	if (endA === start && endB === start) return [];
	const chunks = myers(a.slice(start, endA), b.slice(start, endB));
	if (!chunks) {
		// Edit-distance budget exceeded: one coarse chunk over the whole middle.
		return [{ fromA: start, toA: endA, fromB: start, toB: endB }];
	}
	for (const c of chunks) {
		c.fromA += start;
		c.toA += start;
		c.fromB += start;
		c.toB += start;
	}
	return chunks;
}

/** Classic Myers with a trace for backtracking; null when D exceeds the budget. */
function myers(a: string[], b: string[], maxD = MAX_EDIT_DISTANCE): DiffChunk[] | null {
	const n = a.length;
	const m = b.length;
	if (n === 0) return m === 0 ? [] : [{ fromA: 0, toA: 0, fromB: 0, toB: m }];
	if (m === 0) return [{ fromA: 0, toA: n, fromB: 0, toB: 0 }];
	const limit = Math.min(n + m, maxD);
	const off = limit;
	const v = new Int32Array(2 * limit + 2);
	const trace: Int32Array[] = [];
	let endD = -1;
	for (let d = 0; d <= limit && endD < 0; d++) {
		trace.push(v.slice(0));
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
			else x = v[off + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[off + k] = x;
			if (x >= n && y >= m) {
				endD = d;
				break;
			}
		}
	}
	if (endD < 0) return null;

	// Backtrack the trace into single-line ops (del consumes a[xa]; ins consumes
	// b[yb] at a-position xa), then coalesce adjacent ops into chunks.
	const ops: { del: boolean; xa: number; yb: number }[] = [];
	let x = n;
	let y = m;
	for (let d = endD; d > 0; d--) {
		const pv = trace[d];
		const k = x - y;
		const prevK =
			k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
		const prevX = pv[off + prevK];
		const prevY = prevX - prevK;
		ops.push({ del: prevK !== k + 1, xa: prevX, yb: prevY });
		x = prevX;
		y = prevY;
	}
	ops.reverse();
	const chunks: DiffChunk[] = [];
	for (const op of ops) {
		const last = chunks[chunks.length - 1];
		if (last && op.xa === last.toA && op.yb === last.toB) {
			if (op.del) last.toA++;
			else last.toB++;
		} else {
			chunks.push(
				op.del
					? { fromA: op.xa, toA: op.xa + 1, fromB: op.yb, toB: op.yb }
					: { fromA: op.xa, toA: op.xa, fromB: op.yb, toB: op.yb + 1 }
			);
		}
	}
	return chunks;
}

/**
 * Project chunks onto gutter marks in the new document: pure inserts → added,
 * replacements → modified, pure deletes → a deletion mark on the line the
 * removal happened before (clamped into the document).
 */
export function gutterMarks(chunks: DiffChunk[], docLines: number): GutterMark[] {
	const marks: GutterMark[] = [];
	for (const c of chunks) {
		const insLen = c.toB - c.fromB;
		const delLen = c.toA - c.fromA;
		if (insLen > 0) {
			const type: GutterMarkType = delLen > 0 ? 'modified' : 'added';
			for (let l = c.fromB; l < c.toB; l++) marks.push({ line: l, type });
		} else if (delLen > 0) {
			marks.push({ line: Math.max(0, Math.min(c.fromB, docLines - 1)), type: 'deleted' });
		}
	}
	return marks;
}
