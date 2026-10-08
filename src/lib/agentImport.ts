// Pure logic for Settings → 导入 (one-click import from the other coding
// agents): grouping what the scan found, what is picked by default, which
// MCP servers still need adding, and the summary of a run. Framework-free so
// it is unit-testable.

import type { ImportMcp, ImportOutcome, ImportScan, ImportSession, ImportSkill, ImportSource } from './protocol';

export const SOURCES: ImportSource[] = ['claude', 'codex', 'opencode', 'zcode', 'omp'];

export const SOURCE_LABELS: Record<ImportSource, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
	opencode: 'opencode',
	zcode: 'zcode',
	omp: 'omp'
};

export const sessionKey = (s: ImportSession) => `session:${s.source}:${s.id}`;
export const skillKey = (s: ImportSkill) => `skill:${s.source}:${s.path}`;
export const mcpKey = (m: ImportMcp) => `mcp:${m.source}:${m.from}:${m.name}`;

/** Last path component (either separator). */
export function folderName(path: string): string {
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

export interface ProjectGroup {
	cwd: string;
	sessions: ImportSession[];
}
export interface SourceGroup<T> {
	source: ImportSource;
	items: T[];
}

/** Items per tool, in SOURCES order; tools with nothing are left out. */
export function bySource<T extends { source: ImportSource }>(items: T[]): SourceGroup<T>[] {
	return SOURCES.map((source) => ({ source, items: items.filter((x) => x.source === source) })).filter(
		(g) => g.items.length > 0
	);
}

/** A tool's conversations per folder: the most recently used folder first,
 *  newest conversation first within it. */
export function byProject(sessions: ImportSession[]): ProjectGroup[] {
	const groups = new Map<string, ImportSession[]>();
	for (const s of [...sessions].sort((a, b) => b.updated_at_ms - a.updated_at_ms)) {
		const list = groups.get(s.cwd);
		if (list) list.push(s);
		else groups.set(s.cwd, [s]);
	}
	return [...groups].map(([cwd, list]) => ({ cwd, sessions: list }));
}

/** What a scan picks by default: conversations not imported yet, skills and
 *  servers JuCode does not have. Ones that come with a plugin are left for
 *  the user to choose: they often rely on the tool they came with. */
export function defaultPicks(scan: ImportScan): Record<string, boolean> {
	const picks: Record<string, boolean> = {};
	for (const s of scan.sessions) if (!s.imported) picks[sessionKey(s)] = true;
	for (const s of scan.skills) if (!s.present && !s.plugin) picks[skillKey(s)] = true;
	for (const m of scan.mcp) if (!m.present && !m.from) picks[mcpKey(m)] = true;
	return picks;
}

export interface McpPlan {
	add: ImportMcp[];
	/** A server of that name is already configured (or picked twice). */
	skip: ImportMcp[];
}

/** Splits the picked servers into ones to add and ones whose name JuCode
 *  already has; the first of two picks with one name wins. */
export function planMcp(picked: ImportMcp[], configured: Iterable<string>): McpPlan {
	const taken = new Set(configured);
	const plan: McpPlan = { add: [], skip: [] };
	for (const m of picked) {
		if (taken.has(m.name)) plan.skip.push(m);
		else {
			taken.add(m.name);
			plan.add.push(m);
		}
	}
	return plan;
}

export interface Tally {
	imported: number;
	existing: number;
	failed: number;
}
export interface McpResult {
	server: ImportMcp;
	status: 'imported' | 'existing' | 'failed';
	error?: string;
}
export interface RunSummary {
	sessions: Tally;
	skills: Tally;
	mcp: Tally;
	/** What failed, with why. */
	failures: { label: string; error: string }[];
}

function tally(statuses: string[]): Tally {
	return {
		imported: statuses.filter((s) => s === 'imported').length,
		existing: statuses.filter((s) => s === 'existing').length,
		failed: statuses.filter((s) => s === 'failed').length
	};
}

export function summarize(outcomes: ImportOutcome[], mcp: McpResult[]): RunSummary {
	const of = (kind: ImportOutcome['kind']) => outcomes.filter((o) => o.kind === kind).map((o) => o.status);
	return {
		sessions: tally(of('session')),
		skills: tally(of('skill')),
		mcp: tally(mcp.map((r) => r.status)),
		failures: [
			...outcomes
				.filter((o) => o.status === 'failed')
				.map((o) => ({ label: o.title || (o.kind === 'skill' ? folderName(o.key) : o.key), error: o.error ?? '' })),
			...mcp.filter((r) => r.status === 'failed').map((r) => ({ label: r.server.name, error: r.error ?? '' }))
		]
	};
}

/** Folders of the conversations a run brought over that still exist: the
 *  projects to show them under. */
export function importedFolders(outcomes: ImportOutcome[]): string[] {
	const out: string[] = [];
	for (const o of outcomes) {
		if (o.kind !== 'session' || o.status === 'failed' || !o.cwd || !o.cwd_exists) continue;
		if (!out.includes(o.cwd)) out.push(o.cwd);
	}
	return out;
}
