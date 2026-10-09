// The finished part of a streaming reply split into chunks (MessageList).

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;

/** The finished part of a streaming reply as stable chunks: each top-level
 *  block (paragraph, list, fenced or indented code) is one chunk whose text
 *  never changes once complete, so a keyed {#each} renders it once. Rendering
 *  the whole finished prefix as one Markdown re-parsed, re-highlighted and
 *  re-sanitized everything before it whenever a paragraph completed:
 *  quadratic in the reply's length.
 *
 *  A blank line outside a fence ends a chunk only when the next line starts a
 *  new top-level block: an indented line continues a list item or indented
 *  code, and in a list the next item continues the list. With no next line yet
 *  the blank stays in the last chunk. */
export function stableBlocks(done: string): { key: string; text: string }[] {
	const out: { key: string; text: string }[] = [];
	let start = 0;
	let open = false;
	let list = false;
	const lines = done.split('\n');
	let pos = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (FENCE.test(line)) open = !open;
		else if (!open && LIST_ITEM.test(line)) list = true;
		pos += line.length + 1;
		if (open || line.trim() !== '' || pos - start <= 1) continue;
		let j = i + 1;
		while (j < lines.length && lines[j]!.trim() === '') j++;
		const next = lines[j];
		if (next === undefined) continue;
		// A list item's continuation may be indented less than code's 4 spaces.
		if (list ? /^\s/.test(next) || LIST_ITEM.test(next) : /^( {4}|\t)/.test(next)) continue;
		const text = done.slice(start, pos);
		if (text.trim()) out.push({ key: `${start}:${text.length}`, text });
		start = pos;
		list = false;
	}
	const rest = done.slice(start);
	if (rest.trim()) out.push({ key: `${start}:${rest.length}`, text: rest });
	return out;
}
