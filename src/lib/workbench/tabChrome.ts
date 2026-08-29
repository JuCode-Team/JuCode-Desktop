// Tab chrome shared by workspaces and sessions: an optional tag color plus an
// optional icon (builtin lucide id, free-form slug/emoji, or pasted SVG).
// Pure data + node-safe validation — no DOM, so the SVG sanitizer is a strict
// string allowlist that rejects (returns null) instead of stripping.

export type TabIcon =
	| { kind: 'builtin'; id: string }
	| { kind: 'slug'; value: string }
	| { kind: 'svg'; markup: string };

export const BUILTIN_ICONS = [
	'layers', 'folder', 'code', 'bug', 'rocket', 'terminal', 'globe',
	'star', 'home', 'file', 'git-branch', 'bot', 'sparkles', 'zap',
	'heart', 'bookmark', 'box', 'cpu', 'database', 'message-square',
	'search', 'shield', 'target', 'wrench'
] as const;

export const TAB_COLORS = [
	'#6d3bd7', '#2563eb', '#0891b2', '#059669', '#ca8a04',
	'#ea580c', '#dc2626', '#db2777', '#9333ea', '#64748b'
];

const MAX_SLUG = 32;
const MAX_SVG = 8192;

/** Elements a stored icon SVG may contain (shapes + grouping only). */
const SVG_TAGS = new Set([
	'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'title', 'defs'
]);
/** Presentation attributes kept on those elements. Anything else is dirty. */
const SVG_ATTRS = new Set([
	'xmlns', 'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
	'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity',
	'fill-opacity', 'stroke-opacity', 'd', 'width', 'height', 'cx', 'cy', 'r',
	'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'transform'
]);

/**
 * Validate user-pasted SVG markup with a string allowlist (no DOM, so it runs
 * under vitest's node environment). Returns the trimmed markup when every tag
 * and attribute is on the allowlist, null when anything looks dirty — the
 * result is stored and later rendered via {@html}, so reject, never repair.
 */
export function sanitizeSvg(markup: string): string | null {
	const s = markup.trim();
	if (!s || s.length > MAX_SVG) return null;
	if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return null;
	// Comments, CDATA and processing instructions can smuggle markup past a
	// tag-level scan — reject them outright.
	if (/<!--|<!\[|<\?/.test(s)) return null;
	const tagRe = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'<>])*?)(\/?)\s*>/g;
	const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = tagRe.exec(s))) {
		// Text between tags (e.g. a <title>'s content) must hold no markup.
		if (/[<>]/.test(s.slice(last, m.index))) return null;
		last = m.index + m[0].length;
		if (!SVG_TAGS.has(m[2].toLowerCase())) return null;
		if (m[1]) continue; // closing tag has no attributes
		let a: RegExpExecArray | null;
		while ((a = attrRe.exec(m[3]))) {
			const name = a[1].toLowerCase();
			if (name.startsWith('on') || !SVG_ATTRS.has(name)) return null;
			const value = (a[2] ?? a[3] ?? a[4] ?? '').toLowerCase();
			// Entity sequences (&#40; → '(', &lpar; …) decode in the browser and
			// would smuggle url(...) past the raw-string checks below. No allowed
			// attribute legitimately needs '&', so reject it outright — never repair.
			if (value.includes('&')) return null;
			// url(...) paint servers can reference external resources.
			if (value.includes('javascript:') || value.includes('data:') || value.includes('url(')) return null;
		}
	}
	if (/[<>]/.test(s.slice(last))) return null;
	return s;
}

/** Structural validation of a persisted (or user-built) icon value. */
export function parseTabIcon(raw: unknown): TabIcon | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const o = raw as Record<string, unknown>;
	if (o.kind === 'builtin' && typeof o.id === 'string') {
		return (BUILTIN_ICONS as readonly string[]).includes(o.id) ? { kind: 'builtin', id: o.id } : undefined;
	}
	if (o.kind === 'slug' && typeof o.value === 'string') {
		const value = o.value.trim();
		return value && value.length <= MAX_SLUG ? { kind: 'slug', value } : undefined;
	}
	if (o.kind === 'svg' && typeof o.markup === 'string') {
		const markup = sanitizeSvg(o.markup);
		return markup ? { kind: 'svg', markup } : undefined;
	}
	return undefined;
}

/** `#rgb` / `#rrggbb` only, lowercased; anything else is undefined. */
export function normalizeColor(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	const v = raw.trim().toLowerCase();
	return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v) ? v : undefined;
}

/** A short non-ASCII slug (an emoji or a grapheme cluster or two) renders as
 *  literal text rather than being looked up as a lucide icon name. */
export function isEmojiSlug(s: string): boolean {
	const v = s.trim();
	if (!v || /^[\x20-\x7e]*$/.test(v)) return false;
	return [...v].length <= 8;
}
