// Pure packing of the in-chat model picker rows: the models of the provider
// the session runs on (picked above the list, in the menu's provider row),
// the gateway's grouped by the company behind them. Kept free of Svelte so
// the row shape stays unit-testable.

export interface ModelRow {
	id: string;
	label: string;
	vendor?: string;
	detail: string;
	active: boolean;
	command: string;
	depth: number | undefined;
	group?: string;
	/** An older version of a family the list also has newer: folded away. */
	legacy?: boolean;
}

export interface EngineModel {
	model: string;
	label?: string;
	vendor?: string;
	active: boolean;
	context_window?: number;
	/** false: not in the engine's catalog, only marking what runs. */
	listed?: boolean;
}

export interface CatalogProvider {
	id: string;
	models: {
		name: string;
		display_name?: string | null;
		context_window?: number;
		reasoning_efforts?: string[];
		/** The gateway keeps it callable but out of model pickers. */
		hidden?: boolean;
	}[];
}

/** A provider's models as a picker offers them. */
export const pickable = <M extends { hidden?: boolean }>(models: M[]) => models.filter((m) => !m.hidden);

/** Context window as shown beside a model: 272K, 1M; empty when unknown. */
export const fmtContext = (n?: number) =>
	!n ? '' : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;
/** A JuCode gateway model whose window nobody configured says so (the user can
 *  set one in the model settings) instead of showing nothing. */
const jucodeDetail = (ctx: number | undefined, unsetWindow: string) => fmtContext(ctx) || unsetWindow;

/**
 * A Claude Code / Codex model and where it runs: `local` is the engine's own
 * id for it (its catalog, on this machine's login or config), `jucode` the
 * gateway's name. A model both offer is one entry (the engine's catalog
 * resolves aliases: "opus" is `claude-opus-5-5`).
 */
export interface ToolModel {
	key: string;
	label: string;
	vendor: string;
	context_window?: number;
	local?: string;
	jucode?: string;
	active: boolean;
}

/** "claude-opus-4-8" → "Opus 4.8", as the daemon names Claude Code's models
 *  ("claude-haiku-4-5-20251001" → "Haiku 4.5": a date suffix is dropped). */
function claudeLabel(id: string): string {
	const [family = '', ...rest] = id.replace(/^claude-/, '').split('-');
	const version: string[] = [];
	for (const part of rest) {
		if (!/^\d+$/.test(part) || part.length === 8) break;
		version.push(part);
	}
	const name = family.charAt(0).toUpperCase() + family.slice(1);
	return version.length ? `${name} ${version.join('.')}` : name;
}

export function toolModels(
	models: EngineModel[],
	served: { name: string; display_name?: string | null; context_window?: number }[],
	onJucode: boolean
): ToolModel[] {
	const keyOf = (m: EngineModel) => m.vendor || m.model;
	const running = models.find((m) => m.active);
	const byKey = new Map<string, ToolModel>();
	for (const m of models) {
		// A model the engine only marks as running runs here when the session
		// is on this machine; on the gateway it is the gateway's.
		if (m.listed === false && onJucode) continue;
		const key = keyOf(m);
		if (byKey.has(key)) continue;
		byKey.set(key, {
			key,
			label: m.label || m.model,
			vendor: key,
			context_window: m.context_window,
			local: m.model,
			active: false
		});
	}
	for (const g of served) {
		const known = byKey.get(g.name);
		if (known) {
			known.jucode = g.name;
			known.context_window ||= g.context_window;
			continue;
		}
		byKey.set(g.name, {
			key: g.name,
			label: g.display_name || (g.name.startsWith('claude-') ? claudeLabel(g.name) : g.name),
			vendor: g.name,
			context_window: g.context_window,
			jucode: g.name,
			active: false
		});
	}
	const list = [...byKey.values()];
	if (running) {
		const key = keyOf(running);
		const known = byKey.get(key);
		if (known) known.active = true;
		else
			list.unshift({
				key,
				label: running.label || running.model,
				vendor: key,
				context_window: running.context_window,
				...(onJucode ? { jucode: running.model } : { local: running.model }),
				active: true
			});
	}
	return list;
}

/**
 * What a draft lists when its backend never sent a model list here (the
 * cache fills only from a model menu opened in a running session): the
 * models the provider's catalog names, the draft's model marked.
 */
export function providerModels(
	provider: CatalogProvider | undefined,
	current: string
): (EngineModel & { label: string; max_output_tokens: number; reasoning_efforts: string[]; context_window: number })[] {
	return pickable(provider?.models ?? []).map((m) => ({
		model: m.name,
		label: m.display_name || '',
		active: m.name === current,
		context_window: m.context_window ?? 0,
		max_output_tokens: 0,
		reasoning_efforts: m.reasoning_efforts ?? []
	}));
}

/** A model id's family and version: `claude-opus-5-5` → `claude-opus-#`,
 *  [5, 5]; `gpt-6.1-sol` → `gpt-#-sol`, [6, 1]. A date suffix and a variant
 *  tag (`[1m]`) are no part of either. */
export function modelFamily(id: string): { family: string; version: number[] } {
	const bare = id
		.toLowerCase()
		.replace(/\[[^\]]*\]$/, '')
		.replace(/-\d{8}$/, '')
		// Claude writes versions with dashes: claude-opus-4-8.
		.replace(/(\d)-(?=\d)/g, '$1.');
	const version = (bare.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number);
	return { family: bare.replace(/\d+(?:\.\d+)*/, '#'), version };
}

const newer = (a: number[], b: number[]) => {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
};

/** Marks the older versions of each family (by the row's id, `vendor`) as
 *  legacy and moves them last, when there are enough to be worth folding.
 *  The running model is never folded. */
export function foldLegacy(rows: ModelRow[], min = 3): ModelRow[] {
	const newest = new Map<string, number[]>();
	const parsed = rows.map((r) => modelFamily(r.vendor ?? r.label));
	for (const { family, version } of parsed) {
		const best = newest.get(family);
		if (!best || newer(version, best)) newest.set(family, version);
	}
	const old = rows.filter((r, i) => !r.active && newer(newest.get(parsed[i].family)!, parsed[i].version));
	if (old.length < min) return rows;
	for (const r of old) r.legacy = true;
	return [...rows.filter((r) => !r.legacy), ...old];
}

/** Rows grouped by the company behind each model, in the order the list
 *  names them (the gateway's sort order), `first` ahead; unknown companies
 *  ('') last. */
function byVendor(rows: ModelRow[], vendorOf: (model: string) => string, first = ''): ModelRow[] {
	const groups = new Map<string, ModelRow[]>(first ? [[first, []]] : []);
	for (const row of rows) {
		row.group = vendorOf(row.vendor ?? row.label);
		if (!groups.has(row.group)) groups.set(row.group, []);
		groups.get(row.group)!.push(row);
	}
	const other = groups.get('') ?? [];
	groups.delete('');
	return [...[...groups.values()].flat(), ...other];
}

/**
 * The rows of the provider the session runs on. The jucode engine lists its
 * engine's model_view (already filtered and flagged with the active model —
 * the running engine resolved its credentials, possibly from an env var); a
 * pick is /model. Claude Code / Codex list this machine's catalog or the
 * gateway's, whichever side the session is on; another provider is picked in
 * the menu's provider row, not here.
 */
export function buildModelRows(input: {
	models: EngineModel[];
	backendId: string;
	provider: string;
	providersList: CatalogProvider[];
	/** Claude/Codex: on this machine's config or the JuCode gateway. */
	toolMode?: 'system' | 'jucode';
	/** Shown beside a JuCode model with no context window configured. */
	unsetWindow?: string;
	/** The company behind a model, the gateway list's group header ('' unknown). */
	vendorOf?: (model: string) => string;
}): ModelRow[] {
	const { models, backendId, provider: cur, providersList, toolMode, unsetWindow = '', vendorOf = () => '' } = input;
	if (backendId === 'claude' || backendId === 'codex') {
		const running = models.find((m) => m.active);
		const own = vendorOf(backendId === 'claude' ? 'claude' : 'gpt');
		if (toolMode === 'jucode') {
			const served = pickable(providersList.find((p) => p.id === 'jucode')?.models ?? []);
			const rows: ModelRow[] = served.map((g) => ({
				id: g.name,
				label: g.display_name || (g.name.startsWith('claude-') ? claudeLabel(g.name) : g.name),
				vendor: g.name,
				detail: jucodeDetail(g.context_window, unsetWindow),
				active: !!running && (running.model === g.name || running.vendor === g.name),
				command: `/model ${g.name}`,
				depth: undefined
			}));
			if (running && !rows.some((r) => r.active))
				rows.unshift({
					id: running.model,
					label: running.label || running.model,
					vendor: running.vendor || running.model,
					detail: fmtContext(running.context_window),
					active: true,
					command: `/model ${running.model}`,
					depth: undefined
				});
			return foldLegacy(byVendor(rows, vendorOf, own));
		}
		// This machine: the engine's catalog, one row per model (the catalog
		// resolves aliases: "opus" is `claude-opus-5-5`).
		const byKey = new Map<string, ModelRow>();
		for (const m of models) {
			if (m.listed === false && !m.active) continue;
			const key = m.vendor || m.model;
			const known = byKey.get(key);
			if (known) {
				known.active ||= m.active;
				continue;
			}
			byKey.set(key, {
				id: key,
				label: m.label || m.model,
				vendor: key,
				detail: fmtContext(m.context_window),
				active: m.active,
				command: `/model ${m.model}`,
				depth: undefined
			});
		}
		return foldLegacy([...byKey.values()]);
	}
	const rows: ModelRow[] = models.map((m) => ({
		id: `${cur}::${m.model}`,
		label: m.label || m.model,
		vendor: m.vendor || m.model,
		// An ACP agent reports no context windows, and its provider id ("acp")
		// is no source: the agent's provider is the value's prefix
		// ("deepseek/deepseek-flash"), which the daemon drops from the name.
		detail:
			cur === 'jucode'
				? jucodeDetail(m.context_window, unsetWindow)
				: cur === 'acp'
					? m.model.slice(0, Math.max(0, m.model.indexOf('/')))
					: fmtContext(m.context_window),
		active: m.active,
		command: `/model ${m.model}`,
		depth: undefined
	}));
	return foldLegacy(cur === 'jucode' ? byVendor(rows, vendorOf) : rows);
}
