import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS } from './defaultModels';

describe('curated model defaults', () => {
	it('preserves the original recommendation list and order without duplicates', () => {
		expect(DEFAULT_MODELS).toEqual([
			'gpt-6.1-sol', 'codex-auto-review', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna',
			'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
			'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5',
			'claude-opus-4-8', 'claude-sonnet-5', 'deepseek-v4.1-flash', 'glm-5.3-flash', 'kimi-k3'
		]);
		expect(new Set(DEFAULT_MODELS).size).toBe(DEFAULT_MODELS.length);
	});
});
