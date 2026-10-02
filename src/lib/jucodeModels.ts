// The JuCode models the user chose to show, as config.json keeps them
// (`jucode_models`, read by the engines). The gateway's metadata for them
// (display names, windows, per-group windows) can change after the pick, so
// the saved entries are refreshed from /v1/models at startup.

import { fetchJucodeModels, readConfig, writeConfig, type JucodeModel } from './protocol';

/** One saved entry. Explicit unknowns (0 / ["none"]), as the engine's own
 *  login writes them: a missing field would read back as a default. */
export function savedModel(m: JucodeModel): Record<string, unknown> {
	return {
		name: m.id,
		context_window: m.context_window ?? 0,
		max_context_window: m.max_context_window ?? m.context_window ?? 0,
		max_output_tokens: m.max_output_tokens ?? 0,
		reasoning_efforts: m.reasoning_efforts ?? ['none'],
		...(m.display_name ? { display_name: m.display_name } : {}),
		...(m.group_context_windows ? { group_context_windows: m.group_context_windows } : {})
	};
}

/** Brings the saved entries up to the gateway's metadata, keeping the user's
 *  picks and their order. True when config.json changed. */
export async function refreshJucodeModels(): Promise<boolean> {
	const [live, cfg] = await Promise.all([fetchJucodeModels(), readConfig()]);
	const saved = Array.isArray(cfg.jucode_models) ? (cfg.jucode_models as Record<string, unknown>[]) : [];
	if (!live.length || !saved.length) return false;
	const byId = new Map(live.map((m) => [m.id, m]));
	const next = saved.map((s) => {
		const m = byId.get(String(s.name));
		return m ? savedModel(m) : s;
	});
	if (JSON.stringify(next) === JSON.stringify(saved)) return false;
	const patch: Record<string, unknown> = { jucode_models: next };
	// On JuCode the active list is the same one (as ModelSetup saves it).
	if (cfg.provider === 'jucode') patch.models = next;
	await writeConfig(patch);
	return true;
}
