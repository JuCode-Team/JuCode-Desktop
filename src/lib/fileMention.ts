// Files attached to a message go in its text as @-mentions, the way Claude
// Code and Codex refer to files (and the composer's @ picker writes them):
// `@src/a.ts`, quoted when the path has spaces.

export function fileMention(path: string): string {
	return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** The files a message's text mentions, split out of it: a mention is an @
 *  at the start or after a space, followed by a path (a quoted one, or one
 *  with a slash or a dot, so `@someone` stays text). */
export function splitMentions(text: string): { text: string; file?: string }[] {
	const out: { text: string; file?: string }[] = [];
	let last = 0;
	for (const m of text.matchAll(/(^|\s)@(?:"([^"\n]+)"|([^\s@"]*[./\\][^\s@"]*))/g)) {
		const start = m.index + m[1]!.length;
		if (start > last) out.push({ text: text.slice(last, start) });
		const file = m[2] ?? m[3]!;
		out.push({ text: m[0].slice(m[1]!.length), file });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last) });
	return out;
}
