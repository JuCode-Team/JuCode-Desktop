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
});
