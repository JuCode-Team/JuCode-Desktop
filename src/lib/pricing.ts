// Approximate USD pricing per 1M tokens, matched by model id. Best-effort: used
// only to estimate session cost when the engine doesn't report an authoritative
// number (jucode does, via context_usage.cost; claude/codex don't, so we price
// their token counts here). Cached-input discounts are ignored — the usage
// events don't break cached vs fresh input out — so this slightly over-estimates
// input cost on long contexts. Order matters: first match wins.
type Price = { in: number; out: number };

const TABLE: { match: RegExp; price: Price }[] = [
	// Anthropic (Claude)
	{ match: /opus/i, price: { in: 15, out: 75 } },
	{ match: /sonnet/i, price: { in: 3, out: 15 } },
	{ match: /haiku/i, price: { in: 1, out: 5 } },
	// OpenAI / codex GPT-5 family (estimates for the gpt-5.x ids in use)
	{ match: /gpt-5[.-]?\d*[-_]?mini/i, price: { in: 0.25, out: 2 } },
	{ match: /gpt-5.*codex/i, price: { in: 1.25, out: 10 } },
	{ match: /gpt-5/i, price: { in: 1.25, out: 10 } },
	{ match: /gpt-4o[-_]?mini|gpt-4\.1[-_]?mini/i, price: { in: 0.15, out: 0.6 } },
	{ match: /gpt-4o|gpt-4\.1/i, price: { in: 2.5, out: 10 } }
];

// Neutral mid-range fallback for unknown models.
const FALLBACK: Price = { in: 3, out: 15 };

/** Estimated USD cost of a turn's token usage for `model`. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
	const p = TABLE.find((t) => t.match.test(model))?.price ?? FALLBACK;
	return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}
