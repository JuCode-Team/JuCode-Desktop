import { describe, expect, it } from 'vitest';
import { buildModelRows } from './modelRows';

const groups = { codex: 'Codex', claude: 'Claude', jucode: 'JuCode', byok: 'BYOK', system: 'System' };

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

		// Non-jucode backends never list cross-provider @switch rows.
		const codexRows = buildModelRows({
			...base,
			backendId: 'codex',
			models: [{ model: 'gpt-5.3-codex', active: true }],
			providersList
		});
		expect(codexRows.filter((r) => r.command.startsWith('/model'))).toHaveLength(1);
		expect(codexRows.every((r) => !r.command.startsWith('@switch'))).toBe(true);
		expect(codexRows.find((r) => r.command.startsWith('/model'))?.group).toBe('Codex');
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

	it('offers JuCode overlay rows on claude/codex when logged in', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'claude',
			provider: 'anthropic',
			models: [{ model: 'claude-sonnet', active: true }],
			toolMode: 'system',
			systemLabel: 'Use system config',
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-5.5' }, { name: 'claude-opus' }] }]
		});
		expect(rows.find((r) => r.command === '@tool jucode gpt-5.5')).toMatchObject({
			group: 'JuCode'
		});
		expect(rows.find((r) => r.command === '/model claude-sonnet')?.group).toBe('Claude');
	});

	it('offers a system restore row when the overlay is on', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'codex',
			provider: 'openai',
			models: [{ model: 'gpt-5.5', active: true }],
			toolMode: 'jucode',
			systemLabel: 'Use system config',
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-5.5' }] }]
		});
		expect(rows.find((r) => r.command === '@tool system')).toMatchObject({ group: 'System' });
		expect(rows.find((r) => r.command === '/model gpt-5.5')?.group).toBe('JuCode');
		expect(rows.some((r) => r.command.startsWith('@tool jucode'))).toBe(false);
	});

	it('hides overlay rows when JuCode is not logged in', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'claude',
			configured: [],
			models: [{ model: 'claude-sonnet', active: true }],
			toolMode: 'system',
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-5.5' }] }]
		});
		expect(rows.every((r) => !r.command.startsWith('@tool'))).toBe(true);
	});
});
