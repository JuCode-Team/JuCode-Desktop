// Prompt-cache miss detection over the engines' per-request `usage` events
// (input_tokens counts the whole prompt, cached_input_tokens the part read
// from the provider's prompt cache). A request misses when it reads back less
// than half of the previous request's prompt, which it extends.

/** Prompts shorter than this are not cached by any provider. */
const MIN_CACHEABLE = 1024;
/** Anthropic's default cache lifetime: a request after a longer pause misses
 *  by design, not by fault. */
const CACHE_TTL_MS = 5 * 60_000;

export class CacheWatch {
	#prevInput = 0;
	#prevAt = 0;

	/** Forget the previous request: after a compaction, a model switch or a new
	 *  engine the next prompt shares no cached prefix. */
	reset() {
		this.#prevInput = 0;
	}

	/** Records one request and reports whether it missed the cache. */
	check(input: number, cached: number, now = Date.now()): boolean {
		const prev = now - this.#prevAt > CACHE_TTL_MS ? 0 : this.#prevInput;
		this.#prevInput = input;
		this.#prevAt = now;
		return prev > 0 && input >= MIN_CACHEABLE && cached < prev / 2;
	}
}
