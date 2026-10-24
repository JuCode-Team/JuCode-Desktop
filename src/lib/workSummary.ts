// A finished run of tool calls in one sentence, counted the way t3code
// counts a work group: its two weightiest kinds of work (edits and
// commands before reads and searches, before anything else; ties by which
// came first), shown in the order they came, and the calls left over as
// "other actions": "Changed 4 files, ran 5 commands, and performed 3 other
// actions".
import type { Msg } from './chat.svelte';
import { getLocale, t } from './i18n';
import { editedPaths, parseToolOutput, toolKind } from './toolSummary';

type Tool = Extract<Msg, { kind: 'tool' }>;
export type WorkKey = 'files' | 'commands' | 'reads' | 'searches' | 'web' | 'tools';
export interface WorkSummary {
	parts: { key: WorkKey; n: number }[];
	/** Calls in no part. */
	others: number;
}

const KEY = { edit: 'files', command: 'commands', read: 'reads', search: 'searches', web: 'web', other: 'tools' } as const;
const RANK: Record<WorkKey, number> = { files: 0, commands: 0, reads: 1, searches: 1, web: 1, tools: 2 };

export function workSummary(tools: Tool[]): WorkSummary {
	const groups = new Map<WorkKey, { first: number; calls: number }>();
	const files = new Set<string>();
	let pathless = 0;
	tools.forEach((x, i) => {
		const parsed = parseToolOutput(x.output);
		let key: WorkKey = KEY[toolKind(x.name, parsed)];
		// A failed edit changed nothing: it is a call like any other.
		if (key === 'files' && (x.isError || typeof parsed?.error === 'string')) key = 'tools';
		if (key === 'files') {
			const paths = editedPaths(parsed);
			for (const p of paths) files.add(p);
			if (!paths.length) pathless++;
		}
		const g = groups.get(key);
		if (g) g.calls++;
		else groups.set(key, { first: i, calls: 1 });
	});
	const kept = [...groups]
		.sort(([a, ga], [b, gb]) => RANK[a] - RANK[b] || ga.first - gb.first)
		.slice(0, 2)
		.sort(([, ga], [, gb]) => ga.first - gb.first);
	return {
		parts: kept.map(([key, g]) => ({ key, n: key === 'files' ? files.size + pathless : g.calls })),
		others: tools.length - kept.reduce((sum, [, g]) => sum + g.calls, 0)
	};
}

export function workLine(s: WorkSummary): string {
	const count = (key: string, n: number) => t(`chat.work.${key}.${n === 1 ? 'one' : 'other'}`, { n });
	const parts = s.parts.map((p) => count(p.key, p.n));
	if (s.others) parts.push(count('others', s.others));
	const line = new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(parts);
	return line.charAt(0).toUpperCase() + line.slice(1);
}
