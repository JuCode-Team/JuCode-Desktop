// Pure packing of the in-chat model picker rows: the current engine's
// model_view catalog plus (for jucode sessions) every other configured
// provider's models, grouped for display. Framework-free so the row shape
// stays unit-testable.

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
}

export interface CatalogProvider {
	id: string;
	models: { name: string; context_window?: number }[];
}

export interface ModelGroupLabels {
	codex: string;
	claude: string;
	jucode: string;
	byok: string;
	system: string;
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

// Mirror the engine's jucode allow-list so we don't offer a model it rejects.
const jucodeOk = (n: string) =>
	['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'].includes(n) ||
	n.startsWith('claude-');

/**
 * The active provider's rows come from the engine's model_view (already
 * filtered and flagged with the active model); other providers come from the
 * client-side catalog so a jucode session can switch to any of them.
 * Same-provider picks use /model (instant); cross-provider picks switch via
 * @switch (config rewrite + engine restart).
 */
export function buildModelRows(input: {
	models: EngineModel[];
	backendId: string;
	provider: string;
	providersList: CatalogProvider[];
	/** Provider ids with configured auth (others get a "not configured" hint). */
	configured: string[];
	groups: ModelGroupLabels;
	notConfigured: string;
	/** Claude/Codex live overlay. Ignored for the jucode backend. */
	toolMode?: 'system' | 'jucode';
	/** Shown as a switch-back row when the overlay is on. */
	systemLabel?: string;
}): ModelRow[] {
	const {
		models,
		backendId,
		provider: cur,
		providersList,
		configured,
		groups,
		notConfigured,
		toolMode,
		systemLabel
	} = input;
	const overlay = backendId === 'claude' || backendId === 'codex';
	const onJucode = overlay && toolMode === 'jucode';
	const activeGroup = onJucode
		? groups.jucode
		: backendId === 'codex'
			? groups.codex
			: backendId === 'claude'
				? groups.claude
				: cur === 'jucode'
					? groups.jucode
					: groups.byok;
	const activeRows: ModelRow[] = models.map((m) => ({
		id: `${cur}::${m.model}`,
		label: m.label || m.model,
		vendor: m.vendor || m.model,
		detail: m.context_window ? `${cur} · ${fmtTokens(m.context_window)}` : cur,
		active: m.active,
		command: `/model ${m.model}`,
		depth: undefined,
		group: activeGroup
	}));
	const otherRows: ModelRow[] = (backendId !== 'jucode' ? [] : providersList)
		.filter((pv) => pv.id !== cur)
		.flatMap((pv) =>
			pv.models
				.filter((m) => pv.id !== 'jucode' || jucodeOk(m.name))
				.map((m) => ({
					id: `${pv.id}::${m.name}`,
					label: m.name,
					vendor: m.name,
					detail: `${pv.id}${configured.includes(pv.id) ? '' : ` · ${notConfigured}`} · ${fmtTokens(m.context_window ?? 0)}`,
					active: false,
					command: `@switch ${pv.id} ${m.name}`,
					depth: undefined,
					group: pv.id === 'jucode' ? groups.jucode : groups.byok
				}))
		);
	const toolRows: ModelRow[] = [];
	if (overlay && configured.includes('jucode')) {
		if (onJucode && systemLabel) {
			toolRows.push({
				id: 'tool::system',
				label: systemLabel,
				detail: groups.system,
				active: false,
				command: '@tool system',
				depth: undefined,
				group: groups.system
			});
		}
		if (!onJucode) {
			const catalog = providersList.find((p) => p.id === 'jucode')?.models ?? [];
			for (const m of catalog.filter((m) => jucodeOk(m.name))) {
				toolRows.push({
					id: `tool::jucode::${m.name}`,
					label: m.name,
					vendor: m.name,
					detail: groups.jucode,
					active: false,
					command: `@tool jucode ${m.name}`,
					depth: undefined,
					group: groups.jucode
				});
			}
		}
	}
	const order = [groups.system, groups.codex, groups.claude, groups.jucode, groups.byok];
	return [...toolRows, ...activeRows, ...otherRows].sort(
		(a, b) => order.indexOf(a.group ?? '') - order.indexOf(b.group ?? '')
	);
}
