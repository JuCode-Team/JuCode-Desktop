// The model a one-shot completion (generateText) runs on: the session's
// provider and model; else the JuCode gateway's or the first configured
// provider's first model. A `[1m]`-style alias suffix is dropped.
interface Provider {
	id: string;
	base_url: string;
	format: string;
	models: { name: string }[];
}

export interface LlmTarget {
	provider: string;
	baseUrl: string;
	format: string;
	model: string;
}

export function llmTarget(providers: Provider[], chat?: { provider?: string; model?: string } | null): LlmTarget | null {
	const pick = providers.find((p) => p.id === chat?.provider) ?? providers.find((p) => p.id === 'jucode') ?? providers[0];
	if (!pick) return null;
	const model = chat?.provider === pick.id && chat?.model ? chat.model.replace(/\[.*?\]$/, '') : (pick.models[0]?.name ?? '');
	return model ? { provider: pick.id, baseUrl: pick.base_url, format: pick.format, model } : null;
}
