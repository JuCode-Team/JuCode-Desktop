import { describe, expect, it } from 'vitest';
import { buildModelRows, foldLegacy, modelFamily, providerModels, type ModelRow } from './modelRows';

// Stands in for brandIcons' modelVendor.
const vendorOf = (m: string) => (/claude/.test(m) ? 'Anthropic' : /gpt/.test(m) ? 'OpenAI' : /glm/.test(m) ? 'Zhipu' : '');

const base = {
	provider: 'jucode',
	providersList: [],
	vendorOf
};

describe('buildModelRows', () => {
	it('packs engine rows with /model commands and active flag', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			models: [
				{ model: 'gpt-5.5', active: true, context_window: 200_000 },
				{ model: 'claude-x', active: false }
			]
		});
		expect(rows.map((r) => r.command)).toEqual(['/model gpt-5.5', '/model claude-x']);
		expect(rows[0]).toMatchObject({ active: true, group: 'OpenAI', detail: '200K' });
	});

	it('lists an ACP agent\'s models with /model and their provider as the detail', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'acp',
			provider: 'acp',
			models: [
				{ model: 'anthropic/claude-x', label: 'Claude X', active: true, context_window: 0 },
				{ model: 'openai/gpt-y', label: 'GPT Y', active: false, context_window: 0 },
				{ model: 'plain', label: 'Plain', active: false, context_window: 0 }
			]
		});
		expect(rows.map((r) => [r.command, r.detail, r.group])).toEqual([
			['/model anthropic/claude-x', 'anthropic', undefined],
			['/model openai/gpt-y', 'openai', undefined],
			['/model plain', '', undefined]
		]);
	});

	it('lists only the provider the session runs on', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'deepseek',
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-6.1-sol' }] }],
			models: [{ model: 'deepseek-v4', label: 'DeepSeek V4', active: true, context_window: 128_000 }]
		});
		// A key's own provider: no company groups, the window as the detail.
		expect(rows.map((r) => [r.label, r.command, r.detail, r.group])).toEqual([['DeepSeek V4', '/model deepseek-v4', '128K', undefined]]);
	});

	it('groups the gateway\'s models by company, unknown ones last', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			unsetWindow: 'unset',
			models: [
				{ model: 'mystery', active: false },
				{ model: 'gpt-5.5', active: true, context_window: 272_000 },
				{ model: 'claude-sonnet', active: false },
				{ model: 'gpt-6', active: false }
			]
		});
		expect(rows.map((r) => [r.label, r.group, r.detail])).toEqual([
			['gpt-5.5', 'OpenAI', '272K'],
			['gpt-6', 'OpenAI', 'unset'],
			['claude-sonnet', 'Anthropic', 'unset'],
			['mystery', '', 'unset']
		]);
	});

	// Claude Code / Codex: the side the session is on, this machine or the gateway.
	const claude = {
		...base,
		backendId: 'claude',
		provider: 'anthropic',
		models: [
			{ model: 'opus', label: 'Opus 5.5', vendor: 'claude-opus-5-5', active: true },
			{ model: 'claude-opus-5-5', label: 'Opus 5.5', vendor: 'claude-opus-5-5', active: false },
			{ model: 'claude-fable-5[1m]', label: 'Fable 5 (1M)', vendor: 'claude-fable-5[1m]', active: false, context_window: 1_000_000 }
		],
		providersList: [
			{
				id: 'jucode',
				models: [
					{ name: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol' },
					{ name: 'claude-opus-5-5', context_window: 200_000 },
					{ name: 'codex-auto-review', hidden: true },
					{ name: 'claude-fable-5-1' }
				]
			}
		]
	};

	it('on this machine lists its catalog once per model, no source tags', () => {
		const rows = buildModelRows({ ...claude, toolMode: 'system' });
		expect(rows.map((r) => [r.label, r.command, r.detail, r.active])).toEqual([
			['Opus 5.5', '/model opus', '', true],
			['Fable 5 (1M)', '/model claude-fable-5[1m]', '1M', false]
		]);
	});

	it('on the gateway lists its models, the tool\'s own company first, hidden ones left out', () => {
		const rows = buildModelRows({
			...claude,
			toolMode: 'jucode',
			unsetWindow: 'unset',
			models: [{ model: 'claude-opus-5-5', active: true, listed: false }, ...claude.models.map((m) => ({ ...m, active: false }))]
		});
		expect(rows.map((r) => [r.label, r.command, r.group, r.detail, r.active])).toEqual([
			['Opus 5.5', '/model claude-opus-5-5', 'Anthropic', '200K', true],
			['Fable 5.1', '/model claude-fable-5-1', 'Anthropic', 'unset', false],
			['GPT-6.1 Sol', '/model gpt-6.1-sol', 'OpenAI', 'unset', false]
		]);
	});

	it('keeps a running model the gateway list lacks, marked', () => {
		const rows = buildModelRows({
			...claude,
			toolMode: 'jucode',
			models: [{ model: 'glm-5.3', active: true, listed: false }],
			providersList: [{ id: 'jucode', models: [{ name: 'claude-opus-5-5' }] }]
		});
		expect(rows.find((r) => r.active)).toMatchObject({ command: '/model glm-5.3', group: 'Zhipu' });
	});

	it('lists a provider catalog for a draft that never had a model list, its model marked', () => {
		const models = providerModels(
			{
				id: 'jucode',
				models: [
					{ name: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', context_window: 1_050_000, reasoning_efforts: ['low', 'high'] },
					{ name: 'codex-auto-review', hidden: true },
					{ name: 'glm-5' }
				]
			},
			'glm-5'
		);
		expect(models.map((m) => [m.model, m.label, m.active, m.reasoning_efforts])).toEqual([
			['gpt-6.1-sol', 'GPT-6.1 Sol', false, ['low', 'high']],
			['glm-5', '', true, []]
		]);
		const rows = buildModelRows({ ...base, backendId: 'jucode', provider: 'jucode', models });
		expect(rows.map((r) => [r.label, r.command, r.active])).toEqual([
			['GPT-6.1 Sol', '/model gpt-6.1-sol', false],
			['glm-5', '/model glm-5', true]
		]);
		expect(providerModels(undefined, 'x')).toEqual([]);
	});

	it('folds the older versions of a family away, the running one kept', () => {
		const rows = buildModelRows({
			...claude,
			toolMode: 'system',
			models: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-sonnet-4-6', 'claude-fable-5'].map(
				(id) => ({ model: id, vendor: id, active: id === 'claude-opus-4-8' })
			)
		});
		expect(rows.map((r) => [r.id, !!r.legacy])).toEqual([
			['claude-opus-5-5', false],
			['claude-fable-5-1', false],
			['claude-opus-4-8', false],
			['claude-haiku-5-5', false],
			['claude-sonnet-4-6', false],
			['claude-opus-5', true],
			['claude-haiku-4-5-20251001', true],
			['claude-fable-5', true]
		]);
	});
});

describe('modelFamily', () => {
	it('reads family and version from the common id shapes', () => {
		expect(modelFamily('claude-opus-5-5')).toEqual({ family: 'claude-opus-#', version: [5, 5] });
		expect(modelFamily('claude-opus-5')).toEqual({ family: 'claude-opus-#', version: [5] });
		expect(modelFamily('claude-haiku-4-5-20251001')).toEqual({ family: 'claude-haiku-#', version: [4, 5] });
		expect(modelFamily('claude-fable-5-1[1m]')).toEqual({ family: 'claude-fable-#', version: [5, 1] });
		expect(modelFamily('gpt-6.1-sol')).toEqual({ family: 'gpt-#-sol', version: [6, 1] });
		expect(modelFamily('deepseek-v4.1-flash')).toEqual({ family: 'deepseek-v#-flash', version: [4, 1] });
		expect(modelFamily('default')).toEqual({ family: 'default', version: [] });
	});
});

describe('foldLegacy', () => {
	const row = (id: string): ModelRow => ({ id, label: id, vendor: id, detail: '', active: false, command: '', depth: undefined });
	it('folds nothing when only a couple are older', () => {
		const rows = foldLegacy(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra'].map(row));
		expect(rows.some((r) => r.legacy)).toBe(false);
	});
	it('keeps every variant of the newest version', () => {
		const rows = foldLegacy(['claude-fable-5-1', 'claude-fable-5-1[1m]', 'claude-fable-5', 'claude-fable-4', 'claude-fable-3'].map(row));
		expect(rows.filter((r) => !r.legacy).map((r) => r.id)).toEqual(['claude-fable-5-1', 'claude-fable-5-1[1m]']);
	});
});
