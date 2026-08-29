// Pure helpers for the ACP agent settings UI (kept DOM-free for unit tests).
// The registry itself lives Rust-side (acp_registry.rs) — these only shape
// the form fields.

/** Splits an argument line into argv entries, honoring single/double quotes
 *  (`--flag "a b"` → ['--flag', 'a b']). No escapes, no expansion — this is a
 *  form-field convenience, not a shell. */
export function tokenizeArgs(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quote: '"' | "'" | null = null;
	let started = false;
	for (const ch of line) {
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			started = true;
		} else if (ch === ' ' || ch === '\t') {
			if (started || cur) out.push(cur);
			cur = '';
			started = false;
		} else {
			cur += ch;
		}
	}
	if (started || cur) out.push(cur);
	return out.filter((a) => a.length > 0);
}

/** argv entries → an editable argument line (quotes entries with spaces). */
export function formatArgs(args: string[]): string {
	return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
}

/** A registry id from a display name: lowercase slug, deduplicated against
 *  `taken` with a numeric suffix. */
export function slugifyAgentId(name: string, taken: Set<string> = new Set()): string {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'agent';
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}
