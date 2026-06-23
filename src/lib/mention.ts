// Pure logic for @-mention completion (files + folders). Kept framework-free so
// it's unit-testable and reusable.

export type AtEntry = { path: string; dir: boolean };

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/** Files plus every parent folder derived from their paths (deduped). */
export function buildEntries(files: string[]): AtEntry[] {
	const dirs = new Set<string>();
	for (const f of files) {
		const parts = f.split('/');
		let acc = '';
		for (let i = 0; i < parts.length - 1; i++) {
			acc = acc ? `${acc}/${parts[i]}` : parts[i];
			dirs.add(acc);
		}
	}
	const entries: AtEntry[] = files.map((p) => ({ path: p, dir: false }));
	for (const d of dirs) entries.push({ path: d, dir: true });
	return entries;
}

/** fzf-lite subsequence score: 0 = no match; higher = better. Rewards matches at
 *  word/segment boundaries (/._-) and consecutive runs. */
export function fuzzyScore(text: string, q: string): number {
	const t = text.toLowerCase();
	let ti = 0;
	let score = 0;
	let prev = -2;
	for (let qi = 0; qi < q.length; qi++) {
		const at = t.indexOf(q[qi], ti);
		if (at < 0) return 0;
		let b = 1;
		if (at === prev + 1) b += 5;
		const before = t[at - 1];
		if (at === 0 || before === '/' || before === '.' || before === '_' || before === '-') b += 6;
		score += b;
		prev = at;
		ti = at + 1;
	}
	return score;
}

const dirFirst = (a: AtEntry, b: AtEntry) =>
	a.dir === b.dir ? a.path.localeCompare(b.path) : a.dir ? -1 : 1;

/** Resolve the menu for a query: '' → root entries; trailing '/' → drill into a
 *  folder's direct children; otherwise fuzzy-rank. Uses bounded top-K selection
 *  (no full sort of all matches) so a broad query can't blow up. */
export function mentionMatches(entries: AtEntry[], rawQuery: string, limit = 10): AtEntry[] {
	const q = rawQuery.toLowerCase();
	if (q === '') {
		return entries.filter((e) => !e.path.includes('/')).sort(dirFirst).slice(0, limit);
	}
	if (q.endsWith('/')) {
		return entries
			.filter((e) => e.path.toLowerCase().startsWith(q) && e.path.length > q.length && !e.path.slice(q.length).includes('/'))
			.sort(dirFirst)
			.slice(0, limit);
	}
	// Bounded top-K: keep only the best `limit` by score as we scan.
	const top: { e: AtEntry; s: number }[] = [];
	for (const e of entries) {
		const s = Math.max(fuzzyScore(e.path, q), fuzzyScore(base(e.path), q) * 2);
		if (s <= 0) continue;
		if (top.length < limit) {
			top.push({ e, s });
			if (top.length === limit) top.sort((a, b) => a.s - b.s); // ascending; top[0] = weakest
		} else if (s > top[0].s) {
			let i = 0;
			while (i < limit - 1 && top[i + 1].s < s) i++;
			top.splice(0, 1);
			top.splice(i, 0, { e, s });
		}
	}
	return top.sort((a, b) => b.s - a.s || a.e.path.length - b.e.path.length).map((x) => x.e);
}
