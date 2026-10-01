// Pure packing of the in-chat model picker rows: the current engine's
// model_view catalog plus (for jucode sessions) the models of every other
// provider that has credentials, grouped for display; for Claude Code / Codex,
// one list of what runs on this machine and on the JuCode gateway. Kept
// free of Svelte so the row shape stays unit-testable.

export interface ModelRow {
	id: string;
	label: string;
	vendor?: string;
	detail: string;
	active: boolean;
	command: string;
	depth: number | undefined;
	group?: string;
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
	models: { name: string; context_window?: number }[];
}

export interface ModelGroupLabels {
	jucode: string;
	byok: string;
}

/** Context window as shown beside a model: 272K, 1M; empty when unknown. */
export const fmtContext = (n?: number) =>
	!n ? '' : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;
/** The group header already names jucode and the agent's own catalog; BYOK rows
 *  from several providers share one group, so they keep the provider id. */
const detailOf = (provider: string | null, ctx?: number) => [provider, fmtContext(ctx)].filter(Boolean).join(' · ');
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
	served: { name: string; context_window?: number }[],
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
			label: g.name.startsWith('claude-') ? claudeLabel(g.name) : g.name,
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
 * The active provider's rows come from the engine's model_view (already
 * filtered and flagged with the active model — the running engine resolved
 * its credentials, possibly from an env var); other providers come from the
 * client-side catalog, limited to the ones with credentials, so a jucode
 * session can switch to any of them.
 * Same-provider picks use /model (instant); cross-provider picks switch via
 * @switch (config rewrite + engine restart). Claude Code / Codex list
 * toolModels: a model the current side lacks switches sides (@tool, an
 * engine restart).
 */
export function buildModelRows(input: {
	models: EngineModel[];
	backendId: string;
	provider: string;
	providersList: CatalogProvider[];
	/** Provider ids with credentials (read_auth_providers: a stored API key
	 *  under auth.json `providers`, or `jucode` when logged in). Cross-provider
	 *  rows for any other provider are dropped — the engine can't run them. */
	configured: string[];
	groups: ModelGroupLabels;
	/** Claude/Codex: on this machine's config or the JuCode gateway. */
	toolMode?: 'system' | 'jucode';
	/** Claude/Codex: what "this machine" is called beside a model. */
	localLabel?: string;
	/** Shown beside a JuCode model with no context window configured. */
	unsetWindow?: string;
}): ModelRow[] {
	const {
		models,
		backendId,
		provider: cur,
		providersList,
		configured,
		groups,
		toolMode,
		localLabel = '',
		unsetWindow = ''
	} = input;
	if (backendId === 'claude' || backendId === 'codex') {
		const onJucode = toolMode === 'jucode';
		const served = configured.includes('jucode')
			? (providersList.find((p) => p.id === 'jucode')?.models ?? [])
			: [];
		return toolModels(models, served, onJucode).map((m) => ({
			id: m.key,
			label: m.label,
			vendor: m.vendor,
			// The window first: a narrow menu truncates the detail from the end.
			detail: [fmtContext(m.context_window), m.local !== undefined && localLabel, m.jucode !== undefined && 'JuCode']
				.filter(Boolean)
				.join(' · '),
			active: m.active,
			command: onJucode
				? m.jucode !== undefined
					? `/model ${m.jucode}`
					: `@tool system ${m.local}`
				: m.local !== undefined
					? `/model ${m.local}`
					: `@tool jucode ${m.jucode}`,
			depth: undefined
		}));
	}
	const activeGroup = cur === 'jucode' ? groups.jucode : groups.byok;
	const activeRows: ModelRow[] = models.map((m) => ({
		id: `${cur}::${m.model}`,
		label: m.label || m.model,
		vendor: m.vendor || m.model,
		detail:
			cur === 'jucode'
				? jucodeDetail(m.context_window, unsetWindow)
				: detailOf(activeGroup === groups.byok ? cur : null, m.context_window),
		active: m.active,
		command: `/model ${m.model}`,
		depth: undefined,
		group: activeGroup
	}));
	const otherRows: ModelRow[] = (backendId !== 'jucode' ? [] : providersList)
		.filter((pv) => pv.id !== cur && configured.includes(pv.id))
		.flatMap((pv) =>
			pv.models.map((m) => ({
				id: `${pv.id}::${m.name}`,
				label: m.name,
				vendor: m.name,
				detail: pv.id === 'jucode' ? jucodeDetail(m.context_window, unsetWindow) : detailOf(pv.id, m.context_window),
				active: false,
				command: `@switch ${pv.id} ${m.name}`,
				depth: undefined,
				group: pv.id === 'jucode' ? groups.jucode : groups.byok
			}))
		);
	const order = [groups.jucode, groups.byok];
	return [...activeRows, ...otherRows].sort(
		(a, b) => order.indexOf(a.group ?? '') - order.indexOf(b.group ?? '')
	);
}
