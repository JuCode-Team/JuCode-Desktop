// File references in a reply: `src/lib/a.ts:12`, `crates/x.rs:3:4`,
// `./README.md`, `/abs/path.py#L7`. Recognized in prose only with a
// directory part (so "Node.js" or "and/or" stay text), and in inline code
// also as a bare file name of a known kind (`Cargo.toml`). They render as
// links whose href carries the line (`path#L12:4`), opened in the editor.

export interface FileRef {
	path: string;
	line?: number;
	col?: number;
}

/** Bare file names count only with one of these extensions. */
const KNOWN_EXT =
	'rs|ts|tsx|js|jsx|mjs|cjs|svelte|vue|py|go|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|rb|php|lua|dart|scala|sh|bash|zsh|fish|ps1|sql|md|mdx|txt|json|jsonc|toml|yaml|yml|ini|cfg|conf|env|lock|xml|html|htm|css|scss|less|proto|gradle|tf|dockerfile|mk';

// A path: optional ~ / ./ / ../ / leading slash, one or more directories,
// then a file with an extension; or (inline code only) a bare known file.
const SEGMENT = String.raw`[\w@+.-]+`;
const FILE = String.raw`[\w@+-][\w@+.-]*\.[A-Za-z][\w]{0,9}`;
const WITH_DIR = String.raw`(?:~|\.{1,2})?\/?(?:${SEGMENT}\/)+${FILE}`;
const BARE = String.raw`[\w@+-][\w@+.-]*\.(?:${KNOWN_EXT})`;
const POSITION = String.raw`(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)?`;

const IN_PROSE = new RegExp(String.raw`(^|[\s(\[{"'“‘（「，、：；])(${WITH_DIR})${POSITION}(?=$|[\s)\]}"'”’）」，。、：；!?,;]|\.(?:\s|$))`, 'g');
const WHOLE = new RegExp(String.raw`^(${WITH_DIR}|${BARE})${POSITION}$`);

/** A path that starts at a web domain is a URL without its scheme. */
const looksLikeDomain = (path: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,6}\//i.test(path) && !path.startsWith('.');

function toRef(path: string, a?: string, b?: string, c?: string, d?: string): FileRef | null {
	if (looksLikeDomain(path)) return null;
	const line = Number(a ?? c);
	const col = Number(b ?? d);
	return { path, ...(line > 0 ? { line } : {}), ...(col > 0 ? { col } : {}) };
}

/** The file an inline code span names, if all of it is one. */
export function codeFileRef(code: string): FileRef | null {
	const m = WHOLE.exec(code.trim());
	return m ? toRef(m[1], m[2], m[3], m[4], m[5]) : null;
}

/** Prose split into plain text and file references, in order. */
export function splitFileRefs(text: string): Array<string | (FileRef & { text: string })> {
	const out: Array<string | (FileRef & { text: string })> = [];
	let at = 0;
	for (const m of text.matchAll(IN_PROSE)) {
		const start = (m.index ?? 0) + m[1].length;
		const whole = m[0].slice(m[1].length);
		const ref = toRef(m[2], m[3], m[4], m[5], m[6]);
		if (!ref) continue;
		if (start > at) out.push(text.slice(at, start));
		out.push({ ...ref, text: whole });
		at = start + whole.length;
	}
	if (at < text.length) out.push(text.slice(at));
	return out;
}

/** The link target for a reference: its path, with `#L<line>[:<col>]`. */
export function fileHref(ref: FileRef): string {
	if (!ref.line) return ref.path;
	return `${ref.path}#L${ref.line}${ref.col ? `:${ref.col}` : ''}`;
}

/** A link target back to its path and position (`file://` and `?query`
 *  dropped; `#L12`, `#L12:4` and `#L12C4` read). */
export function parseFileHref(href: string): FileRef {
	const clean = href.replace(/^file:\/\//, '');
	const [main, hash = ''] = clean.split('#');
	// marked percent-encodes a link: 鹈鹕 and a Windows `\` arrive as %XX.
	let path = decodePath(main.split('?')[0].trim());
	// `file:///C:/x` leaves `/C:/x`; on Windows the drive starts the path.
	if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
	const m = /^L(\d+)(?::(\d+)|C(\d+))?$/.exec(hash);
	if (!m) return { path };
	const line = Number(m[1]);
	const col = Number(m[2] ?? m[3]);
	return { path, ...(line > 0 ? { line } : {}), ...(col > 0 ? { col } : {}) };
}

function decodePath(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path; // a literal `%` that is no escape
	}
}

/** An absolute path on any OS: `/x`, `C:\x`, `C:/x` or `\\server\share`. */
export function isAbsolutePath(path: string): boolean {
	return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
}

/** `path` under `root`, unless it is absolute already. */
export function joinPath(root: string, path: string): string {
	if (isAbsolutePath(path) || !root) return path;
	return `${root.replace(/[\\/]+$/, '')}/${path.replace(/^\.?[\\/]/, '')}`;
}

/** A path's extension, lowercased; '' when it has none. Either separator. */
export function pathExt(path: string): string {
	const name = path.split(/[\\/]/).pop() ?? '';
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
