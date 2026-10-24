// Claude Code's and Codex's custom providers as the daemon last said, shared
// by Settings (which changes them) and the composer's provider menu (which
// offers them to a draft). The daemon keeps them and their keys.
import { toolProviders, type ToolApiProvider, type ToolProviderConfig, type ToolProviderOp } from '$lib/protocol';

export type ProviderTool = 'claude' | 'codex';

export const toolProviderConfigs = $state<Partial<Record<ProviderTool, ToolProviderConfig>>>({});

const loads = new Map<ProviderTool, Promise<ToolProviderConfig>>();

/** Reads `tool`'s providers once per app run (again after a failure, or
 *  with `fresh`). */
export function loadToolProviders(tool: ProviderTool, fresh = false): Promise<ToolProviderConfig> {
	let load = fresh ? undefined : loads.get(tool);
	if (!load) {
		load = toolProviders(tool).then(
			(config) => (toolProviderConfigs[tool] = config),
			(e) => {
				loads.delete(tool);
				throw e;
			}
		);
		loads.set(tool, load);
	}
	return load;
}

/** Saves, removes or selects; the daemon answers with the whole config. */
export async function changeToolProviders(
	tool: ProviderTool,
	op: Exclude<ToolProviderOp, 'tool_providers'>,
	fields: Record<string, unknown>
): Promise<ToolProviderConfig> {
	const config = await toolProviders(tool, op, fields);
	toolProviderConfigs[tool] = config;
	loads.set(tool, Promise.resolve(config));
	return config;
}

/** The provider a draft of `tool` starts on: its own pick ('' is the tool's
 *  own configuration), else the tool's default. */
export function draftProvider(tool: string, pick: string | undefined): ToolApiProvider | undefined {
	if (tool !== 'claude' && tool !== 'codex') return undefined;
	const config = toolProviderConfigs[tool];
	const id = pick ?? config?.selected ?? '';
	return id ? config?.providers.find((p) => p.id === id) : undefined;
}
