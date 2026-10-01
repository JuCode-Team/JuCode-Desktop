// Coding-agent usage. The daemon records every turn whatever engine ran it
// (JuCode-CLI crates/daemon/src/usage.rs) and uploads it to the account, so
// the views read the daemon (this computer, with projects) or the account
// (every computer). This module holds what they share, and hands the per-day
// counts older versions kept in localStorage to the daemon once.

import type { ChannelKind, UsageSummary, UsageTokens } from './protocol';

const LEGACY_KEY = 'jucode-usage-daily';

export const fmtTokens = (n: number) =>
	n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

/** Moves the older localStorage counts into the daemon's records, then
 *  forgets them. A daemon that already has them answers `imported: false`. */
export async function importLegacyUsage(request: (op: Record<string, unknown>) => Promise<unknown>): Promise<void> {
	let raw: string | null;
	try {
		raw = localStorage.getItem(LEGACY_KEY);
	} catch {
		return;
	}
	if (!raw) return;
	let days: unknown;
	try {
		days = JSON.parse(raw);
	} catch {
		days = null;
	}
	if (days && typeof days === 'object') await request({ op: 'usage_import_legacy', days });
	try {
		localStorage.removeItem(LEGACY_KEY);
	} catch {
		/* storage unavailable: the daemon refuses a second import anyway */
	}
}

export const EMPTY_TOKENS: UsageTokens = {
	input_tokens: 0,
	cached_input_tokens: 0,
	cache_write_tokens: 0,
	output_tokens: 0,
	reasoning_tokens: 0,
	turns: 0
};

export const totalTokens = (u: UsageTokens) => u.input_tokens + u.output_tokens;

function add(a: UsageTokens, b: UsageTokens): UsageTokens {
	const cost = a.cost !== undefined || b.cost !== undefined ? String(Number(a.cost ?? 0) + Number(b.cost ?? 0)) : undefined;
	return {
		input_tokens: a.input_tokens + b.input_tokens,
		cached_input_tokens: a.cached_input_tokens + b.cached_input_tokens,
		cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
		output_tokens: a.output_tokens + b.output_tokens,
		reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
		turns: a.turns + b.turns,
		...(cost !== undefined ? { cost } : {})
	};
}

/** Display order of the channel kinds. */
export const CHANNEL_KINDS: ChannelKind[] = ['jucode', 'third_party', 'local', 'legacy'];

export interface ChannelGroup {
	kind: ChannelKind;
	usage: UsageTokens;
	/** JuCode: one row per group ('' = the gateway's default); the others:
	 *  one per provider. Largest first. */
	rows: { key: string; usage: UsageTokens }[];
}

/** The channel rows grouped by kind. */
export function groupChannels(rows: UsageSummary['by_channel']): ChannelGroup[] {
	const groups = new Map<ChannelKind, Map<string, UsageTokens>>();
	for (const row of rows) {
		const kind = CHANNEL_KINDS.includes(row.channel_kind) ? row.channel_kind : 'local';
		const key = kind === 'jucode' ? (row.group ?? '') : row.channel;
		const sub = groups.get(kind) ?? new Map<string, UsageTokens>();
		sub.set(key, add(sub.get(key) ?? EMPTY_TOKENS, row));
		groups.set(kind, sub);
	}
	return CHANNEL_KINDS.filter((kind) => groups.has(kind)).map((kind) => {
		const sub = [...groups.get(kind)!].map(([key, usage]) => ({ key, usage }));
		sub.sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage));
		return { kind, usage: sub.reduce((sum, row) => add(sum, row.usage), EMPTY_TOKENS), rows: sub };
	});
}

/** Every day of the last `n` (oldest first, `YYYY-MM-DD` local), zero-filled. */
export function dayRange(n: number, today = new Date()): string[] {
	const out: string[] = [];
	for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
	return out;
}

export function dayKey(d: Date): string {
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}
