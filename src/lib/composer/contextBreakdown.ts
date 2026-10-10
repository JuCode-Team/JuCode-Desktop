// The context by category as the context popover shows it: what is in use
// (with its share of the window), tools that load only when called, and the
// room kept for auto-compaction and left free. Categories are named as
// Claude Code names them; the JuCode engine uses the same names.

import type { ContextBreakdown } from '$lib/chat.svelte';

/** i18n keys (chat.contextCat.*) for the names engines send; others show as sent. */
const KEYS: Record<string, string> = {
	'System prompt': 'systemPrompt',
	'System tools': 'systemTools',
	'System tools (deferred)': 'systemToolsDeferred',
	'MCP tools': 'mcpTools',
	'MCP tools (deferred)': 'mcpToolsDeferred',
	'Custom agents': 'customAgents',
	'Memory files': 'memoryFiles',
	Skills: 'skills',
	Messages: 'messages',
	'Compacted summary': 'compacted',
	'User messages': 'userMessages',
	'Assistant messages': 'assistantMessages',
	Reasoning: 'reasoning',
	'Tool calls': 'toolCalls',
	'Tool results': 'toolResults',
	Images: 'images',
	'Autocompact buffer': 'buffer',
	'Free space': 'free'
};

export const categoryKey = (name: string): string | undefined => KEYS[name];

export interface Row {
	name: string;
	tokens: number;
	/** Share of the window, 0–100 (one decimal). */
	pct: number;
	kind: 'used' | 'deferred' | 'buffer' | 'free';
	/** Position among the used rows (its colour); -1 for the others. */
	hue: number;
}

export interface Breakdown {
	used: Row[];
	deferred: Row[];
	/** Buffer, then free space. */
	room: Row[];
	max: number;
}

export function breakdownRows(b: Extract<ContextBreakdown, { total: number }>): Breakdown {
	const max = b.max || b.categories.reduce((n, c) => n + (c.kind === 'deferred' ? 0 : c.tokens), 0);
	const pct = (tokens: number) => (max > 0 ? Math.round((tokens / max) * 1000) / 10 : 0);
	const out: Breakdown = { used: [], deferred: [], room: [], max };
	for (const c of b.categories) {
		if (c.tokens <= 0) continue;
		const kind = c.kind === 'deferred' || c.kind === 'buffer' || c.kind === 'free' ? c.kind : 'used';
		const row: Row = { name: c.name, tokens: c.tokens, pct: pct(c.tokens), kind, hue: kind === 'used' ? out.used.length : -1 };
		if (kind === 'used') out.used.push(row);
		else if (kind === 'deferred') out.deferred.push(row);
		else out.room.push(row);
	}
	out.room.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'buffer' ? -1 : 1));
	return out;
}
