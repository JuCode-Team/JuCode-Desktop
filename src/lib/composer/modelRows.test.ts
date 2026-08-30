import { describe, expect, it } from 'vitest';
import { buildModelRows } from './modelRows';

const groups = { codex: 'Codex', claude: 'Claude', jucode: 'JuCode', byok: 'BYOK' };

const base = {
	provider: 'jucode',
	providersList: [],
	configured: ['jucode'],
	groups,
	notConfigured: 'not configured'
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
		expect(rows[0]).toMatchObject({
			active: true,
			group: 'JuCode',
			detail: 'jucode · 200.0k'
		});
	});

	it('appends other providers as @switch rows (jucode only)', () => {
		const providersList = [
			{ id: 'jucode', models: [{ name: 'gpt-5.5', context_window: 1000 }] },
			{ id: 'byo', models: [{ name: 'my-model' }] }
		];
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'byo2',
			configured: ['byo2'],
			models: [{ model: 'active-model', active: true }],
			providersList
		});
		const byo = rows.find((r) => r.id === 'byo::my-model');
		expect(byo).toMatchObject({
			command: '@switch byo my-model',
			detail: 'byo · not configured · 0'
		});
		expect(rows.find((r) => r.id === 'jucode::gpt-5.5')?.command).toBe('@switch jucode gpt-5.5');

		// Non-jucode backends never list cross-provider rows.
		const codexRows = buildModelRows({
			...base,
			backendId: 'codex',
			models: [{ model: 'gpt-5.3-codex', active: true }],
			providersList
		});
		expect(codexRows).toHaveLength(1);
		expect(codexRows[0].group).toBe('Codex');
	});

	it('filters jucode catalog entries through the engine allow-list', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'byo',
			configured: [],
			models: [],
			providersList: [
				{
					id: 'jucode',
					models: [{ name: 'gpt-5.5' }, { name: 'claude-sonnet' }, { name: 'unsupported-model' }]
				}
			]
		});
		expect(rows.map((r) => r.label)).toEqual(['gpt-5.5', 'claude-sonnet']);
	});

	it('sorts rows into the fixed group order', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'custom',
			configured: ['custom'],
			models: [{ model: 'byok-model', active: true }],
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-5.5' }] }]
		});
		// JuCode built-in group comes before Custom/BYOK.
		expect(rows.map((r) => r.group)).toEqual(['JuCode', 'BYOK']);
	});
});
