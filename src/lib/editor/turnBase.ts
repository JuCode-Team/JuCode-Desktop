// A file as it was before a turn edited it, from what it is now and the
// diffs of the turn's edits (the engines' tool cards): each edit undone, the
// last first. The diffs come in two shapes: unified hunks with context
// (Codex, JuCode) and plain "-old / +new" pairs (Claude Code, ACP agents),
// several pairs of a MultiEdit one after another.

interface Hunk {
	old: string[];
	new: string[];
}

/** The hunks of one edit's diff, in order. */
export function hunks(diff: string): Hunk[] {
	const out: Hunk[] = [];
	let cur: Hunk | null = null;
	let last = '';
	const lines = diff.split('\n');
	if (lines.at(-1) === '') lines.pop();
	for (const line of lines) {
		if (/^(--- |\+\+\+ |diff |index |\\ )/.test(line)) continue;
		const mark = line[0] ?? ' ';
		// A new hunk: its header, or a removal right after an addition (the
		// next pair of a MultiEdit; unified hunks keep context between).
		if (line.startsWith('@@') || !cur || (mark === '-' && last === '+')) {
			cur = { old: [], new: [] };
			out.push(cur);
			if (line.startsWith('@@')) {
				last = '';
				continue;
			}
		}
		const body = line.slice(1);
		if (mark === '-') cur.old.push(body);
		else if (mark === '+') cur.new.push(body);
		else {
			// Context (an empty line may come without its leading space).
			const text = mark === ' ' ? body : line;
			cur.old.push(text);
			cur.new.push(text);
		}
		last = mark;
	}
	return out.filter((h) => h.old.length || h.new.length);
}

/** `now` with the edits (`diffs`, in the order made) undone; null when one
 *  can't be found in it (changed since, or nothing to find it by). */
export function turnBase(now: string, diffs: string[]): string | null {
	let text = now;
	for (const diff of [...diffs].reverse()) {
		for (const h of hunks(diff).reverse()) {
			const after = h.new.join('\n');
			const before = h.old.join('\n');
			// A removal with no context: nothing left to find its place by.
			if (!after) return null;
			const at = text.indexOf(after);
			if (at < 0) return null;
			text = text.slice(0, at) + before + text.slice(at + after.length);
		}
	}
	return text;
}
