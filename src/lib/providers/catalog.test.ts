import { describe, expect, it } from 'vitest';
import snapshot from './catalog.json';
import {
	PROVIDER_CATALOG,
	parseProviderCatalog,
	providerFormPrefill
} from './catalog';

describe('provider catalog snapshot', () => {
	it('parses the vendored snapshot with its license attribution', () => {
		const catalog = parseProviderCatalog(snapshot);
		expect(catalog.attribution).toMatchObject({
			source: 'https://models.dev/api.json',
			license: 'MIT',
			copyright: 'Copyright (c) 2025 models.dev',
			license_file: 'models.dev.LICENSE'
		});
		expect(catalog.providers.length).toBeGreaterThan(1);
		expect(new Set(catalog.providers.map((provider) => provider.id)).size).toBe(
			catalog.providers.length
		);
	});

	it('keeps OpenRouter first and featured with models from several vendors', () => {
		const openRouter = PROVIDER_CATALOG.providers[0];
		expect(openRouter).toMatchObject({
			id: 'openrouter',
			featured: true,
			base_url: 'https://openrouter.ai/api/v1',
			protocol: 'chat'
		});
		expect(openRouter.models.map((model) => model.name)).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^openai\//),
				expect.stringMatching(/^anthropic\//),
				expect.stringMatching(/^google\//)
			])
		);
	});

	it('rejects protocols the desktop does not understand', () => {
		const invalid = structuredClone(snapshot) as Record<string, any>;
		invalid.providers[0].protocol = 'litellm';
		expect(() => parseProviderCatalog(invalid)).toThrow('Invalid protocol');
	});
});

describe('catalog provider form prefill', () => {
	it('copies the endpoint, protocol and full model list while leaving the key blank', () => {
		const anthropic = PROVIDER_CATALOG.providers.find((provider) => provider.id === 'anthropic')!;
		const form = providerFormPrefill(anthropic);
		expect(form).toMatchObject({
			id: 'anthropic',
			base_url: 'https://api.anthropic.com/v1',
			format: 'anthropic',
			key: ''
		});
		expect(form.models).toEqual(anthropic.models);
	});

	it('returns model copies that can be edited without changing the catalog', () => {
		const provider = PROVIDER_CATALOG.providers[0];
		const form = providerFormPrefill(provider);
		form.models[0].name = 'changed';
		form.models[0].reasoning_efforts?.push('custom');
		expect(provider.models[0].name).not.toBe('changed');
		expect(provider.models[0].reasoning_efforts).not.toContain('custom');
	});
});
