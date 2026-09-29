// Accent colour per model family, for the effort slider and the model button.
// Brand colours where the vendor has a distinctive one; '' keeps the neutral
// UI colour (OpenAI, xAI and others whose marks are black and white).
const COLORS: [RegExp, string][] = [
	[/claude/i, '#d97757'],
	[/(gemini|gemma)/i, '#3186ff'],
	[/deepseek/i, '#4d6bfe'],
	[/(qwen|qwq)/i, '#615ced'],
	[/(glm|zhipu)/i, '#3859ff'],
	[/(kimi|moonshot)/i, '#1783ff'],
	[/(minimax|abab)/i, '#f23f5d'],
	[/(doubao|seed)/i, '#1e37fc'],
	[/(mistral|codestral|devstral)/i, '#fa520f']
];

export const modelColor = (model: string) => COLORS.find(([re]) => re.test(model))?.[1] ?? '';

/** The model's highest thinking effort is selected (and it has more than one). */
export const isTopEffort = (effort: string, efforts: string[]) =>
	efforts.length > 1 && effort === efforts[efforts.length - 1];
