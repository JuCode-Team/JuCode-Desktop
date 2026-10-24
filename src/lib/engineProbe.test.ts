import { describe, expect, it, vi } from 'vitest';

vi.mock('./protocol', () => ({ acpAgentsList: vi.fn(), daemon: { request: vi.fn() } }));

import { profileFromEvents } from './engineProbe';

describe('profileFromEvents', () => {
	it('makes a draft profile of what the engine said of itself', () => {
		const profile = profileFromEvents([
			{ type: 'model_status', provider: 'anthropic', model: 'opus', model_label: 'Opus', reasoning_effort: 'high', reasoning_efforts: ['low', 'high'], default_effort: 'high', context_window: 200000 },
			{ type: 'model_view', models: [{ model: 'opus', label: 'Opus', active: true }], active_effort: 'high' },
			{ type: 'command_list', commands: [{ name: '/compact' }] },
			{ type: 'engine_caps', caps: { modelPicker: true } }
		]);
		expect(profile).toMatchObject({
			provider: 'anthropic',
			model: 'opus',
			efforts: ['low', 'high'],
			contextWindow: 200000,
			catalog: [{ model: 'opus', label: 'Opus', active: true }],
			commands: [{ name: '/compact' }],
			caps: { modelPicker: true }
		});
	});

	it('is empty for an engine that said nothing useful', () => {
		expect(profileFromEvents([{ type: 'status', message: 'ready' }])).toEqual({});
	});
});
