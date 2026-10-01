import { describe, expect, it } from 'vitest';
import { buildModelRows } from './modelRows';

const groups = { codex: 'Codex', claude: 'Claude', jucode: 'JuCode', byok: 'BYOK', system: 'System' };

const base = {
	provider: 'jucode',
	providersList: [],
	configured: ['jucode'],
	groups
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
			detail: '200K'
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
			configured: ['byo2', 'byo', 'jucode'],
			models: [{ model: 'active-model', active: true }],
			providersList
		});
		const byo = rows.find((r) => r.id === 'byo::my-model');
		expect(byo).toMatchObject({
			command: '@switch byo my-model',
			detail: 'byo'
		});
		expect(rows.find((r) => r.id === 'jucode::gpt-5.5')?.command).toBe('@switch jucode gpt-5.5');
	});

	it('lists every jucode model the user chose to show', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'byo',
			configured: ['jucode'],
			models: [],
			providersList: [
				{
					id: 'jucode',
					models: [{ name: 'gpt-5.5' }, { name: 'claude-sonnet' }, { name: 'gemini-3-pro' }]
				}
			]
		});
		expect(rows.map((r) => r.label)).toEqual(['gpt-5.5', 'claude-sonnet', 'gemini-3-pro']);
	});

	it('lists only providers with credentials', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'deepseek',
			// deepseek is the running provider (possibly env-keyed): its engine
			// rows stay even though it has no stored key.
			configured: ['openrouter'],
			models: [{ model: 'deepseek-chat', active: true }],
			providersList: [
				{ id: 'jucode', models: [{ name: 'gpt-5.5' }] },
				{ id: 'openrouter', models: [{ name: 'or-model' }] },
				{ id: 'anthropic', models: [{ name: 'claude-opus' }] },
				{ id: 'deepseek', models: [{ name: 'deepseek-chat' }] }
			]
		});
		expect(rows.map((r) => r.id)).toEqual(['deepseek::deepseek-chat', 'openrouter::or-model']);
	});

	it('drops jucode catalog rows when not logged in', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'byo',
			configured: ['byo'],
			models: [{ model: 'm', active: true }],
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-5.5' }] }]
		});
		expect(rows.every((r) => !r.command.startsWith('@switch jucode'))).toBe(true);
	});

	it('sorts rows into the fixed group order', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'jucode',
			provider: 'custom',
			configured: ['custom', 'jucode'],
			models: [{ model: 'byok-model', active: true }],
			providersList: [{ id: 'jucode', models: [{ name: 'gpt-5.5' }] }]
		});
		// JuCode built-in group comes before Custom/BYOK.
		expect(rows.map((r) => r.group)).toEqual(['JuCode', 'BYOK']);
	});

	// Claude Code / Codex: one list of this machine's catalog and the gateway's.
	const claude = {
		...base,
		backendId: 'claude',
		provider: 'anthropic',
		localLabel: 'Local',
		models: [
			{ model: 'opus', label: 'Opus 5.5', vendor: 'claude-opus-5-5', active: true },
			{ model: 'claude-fable-5[1m]', label: 'Fable 5 (1M)', vendor: 'claude-fable-5[1m]', active: false }
		],
		providersList: [{ id: 'jucode', models: [{ name: 'claude-opus-5-5', context_window: 200_000 }, { name: 'claude-fable-5-1' }] }]
	};

	it('lists a model both sides run once, and says where each runs', () => {
		const rows = buildModelRows({ ...claude, toolMode: 'system' });
		expect(rows.map((r) => [r.label, r.detail, r.active])).toEqual([
			['Opus 5.5', 'Local · JuCode · 200K', true],
			['Fable 5 (1M)', 'Local', false],
			['Fable 5.1', 'JuCode', false]
		]);
		expect(rows.every((r) => r.group === undefined)).toBe(true);
	});

	it('picks on the current side, and switches sides for a model only the other has', () => {
		const local = buildModelRows({ ...claude, toolMode: 'system' });
		expect(local.map((r) => r.command)).toEqual(['/model opus', '/model claude-fable-5[1m]', '@tool jucode claude-fable-5-1']);
		const gateway = buildModelRows({
			...claude,
			toolMode: 'jucode',
			models: [{ model: 'claude-opus-5-5', active: true, listed: false }, ...claude.models.map((m) => ({ ...m, active: false }))]
		});
		expect(gateway.map((r) => r.command)).toEqual([
			'/model claude-opus-5-5',
			'@tool system claude-fable-5[1m]',
			'/model claude-fable-5-1'
		]);
		expect(gateway[0].active).toBe(true);
	});

	it('a model the engine only marks as running is the gateway\'s while on it', () => {
		const rows = buildModelRows({
			...claude,
			toolMode: 'jucode',
			models: [{ model: 'glm-5.3', active: true, listed: false }, ...claude.models.map((m) => ({ ...m, active: false }))],
			providersList: [{ id: 'jucode', models: [{ name: 'glm-5.3' }] }]
		});
		expect(rows.find((r) => r.active)).toMatchObject({ command: '/model glm-5.3', detail: 'JuCode' });
	});

	it('lists only this machine when not logged in to JuCode', () => {
		const rows = buildModelRows({ ...claude, configured: [], toolMode: 'system' });
		expect(rows.map((r) => r.command)).toEqual(['/model opus', '/model claude-fable-5[1m]']);
	});
});
