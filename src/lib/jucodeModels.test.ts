import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchJucodeModels = vi.fn();
const readConfig = vi.fn();
const writeConfig = vi.fn((_patch: Record<string, unknown>) => Promise.resolve());
vi.mock('./protocol', () => ({
	fetchJucodeModels: () => fetchJucodeModels(),
	readConfig: () => readConfig(),
	writeConfig: (patch: Record<string, unknown>) => writeConfig(patch)
}));

import { refreshJucodeModels, savedModel } from './jucodeModels';

beforeEach(() => vi.clearAllMocks());

describe('refreshJucodeModels', () => {
	it('brings the picked models up to the gateway, keeping the pick and its order', async () => {
		const old = savedModel({ id: 'b' });
		readConfig.mockResolvedValue({ provider: 'jucode', jucode_models: [old, { name: 'gone', context_window: 1 }] });
		fetchJucodeModels.mockResolvedValue([
			{ id: 'a', context_window: 100 },
			{ id: 'b', context_window: 200, display_name: 'Bee', group_context_windows: { g: { context_window: 300, max_context_window: 300 } } }
		]);
		expect(await refreshJucodeModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { jucode_models: Record<string, unknown>[]; models: unknown };
		expect(patch.jucode_models.map((m) => [m.name, m.display_name, m.context_window])).toEqual([
			['b', 'Bee', 200],
			['gone', undefined, 1]
		]);
		expect(patch.models).toBe(patch.jucode_models);
	});

	it('writes nothing when the gateway says the same', async () => {
		readConfig.mockResolvedValue({ provider: 'deepseek', jucode_models: [savedModel({ id: 'b', context_window: 200 })] });
		fetchJucodeModels.mockResolvedValue([{ id: 'b', context_window: 200 }]);
		expect(await refreshJucodeModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('initializes first-login defaults instead of leaving the bootstrap gpt-5.5 model', async () => {
		readConfig.mockResolvedValue({ provider: 'jucode', model: 'gpt-5.5', models: [{ name: 'gpt-5.5' }], jucode_models: [] });
		fetchJucodeModels.mockResolvedValue([{ id: 'gpt-5.5' }, { id: 'claude-sonnet-5-5' }, { id: 'gpt-6.1-sol' }]);
		expect(await refreshJucodeModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { model: string; models: { name: string }[]; jucode_models: unknown };
		expect(patch.models.map((m) => m.name)).toEqual(['gpt-6.1-sol', 'claude-sonnet-5-5']);
		expect(patch.models).toBe(patch.jucode_models);
		expect(patch.model).toBe('gpt-6.1-sol');
	});

	it('repairs the active bootstrap list when saved account models already exist', async () => {
		const saved = [savedModel({ id: 'gpt-6.1-sol' })];
		readConfig.mockResolvedValue({ provider: 'jucode', model: 'gpt-5.5', models: [{ name: 'gpt-5.5' }], jucode_models: saved });
		fetchJucodeModels.mockResolvedValue([{ id: 'gpt-6.1-sol' }]);
		expect(await refreshJucodeModels()).toBe(true);
		expect(writeConfig.mock.calls[0][0]).toMatchObject({ models: saved, model: 'gpt-6.1-sol' });
	});

	it('initializes account defaults without switching a BYOK provider', async () => {
		readConfig.mockResolvedValue({ provider: 'deepseek', model: 'my-model', models: [{ name: 'my-model' }], jucode_models: [] });
		fetchJucodeModels.mockResolvedValue([{ id: 'gpt-6.1-sol' }]);
		expect(await refreshJucodeModels()).toBe(true);
		expect(writeConfig.mock.calls[0][0]).toEqual({ jucode_models: [savedModel({ id: 'gpt-6.1-sol' })] });
	});

	it('does not overwrite an existing single-model user selection', async () => {
		const saved = [savedModel({ id: 'gpt-5.5' })];
		readConfig.mockResolvedValue({ provider: 'jucode', model: 'gpt-5.5', models: saved, jucode_models: saved });
		fetchJucodeModels.mockResolvedValue([{ id: 'gpt-5.5' }, { id: 'gpt-6.1-sol' }]);
		expect(await refreshJucodeModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('keeps the current bootstrap config when the account catalog is empty', async () => {
		readConfig.mockResolvedValue({ provider: 'jucode', model: 'gpt-5.5', models: [{ name: 'gpt-5.5' }], jucode_models: [] });
		fetchJucodeModels.mockResolvedValue([]);
		expect(await refreshJucodeModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('uses available account models when none of the recommendations are served', async () => {
		readConfig.mockResolvedValue({ provider: 'jucode', model: 'gpt-5.5', jucode_models: [] });
		fetchJucodeModels.mockResolvedValue([{ id: 'private-model', reasoning_efforts: ['low', 'high'] }]);
		expect(await refreshJucodeModels()).toBe(true);
		expect(writeConfig.mock.calls[0][0]).toMatchObject({ model: 'private-model', reasoning_effort: 'low' });
	});
});
