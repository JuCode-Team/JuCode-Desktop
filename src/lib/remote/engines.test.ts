import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale } from '$lib/i18n';
import type { AcpPreset } from '$lib/protocol';
import { engineKey, listable, pickEngines } from './engines';

const preset = (over: Partial<AcpPreset>): AcpPreset => ({
	id: 'omp',
	name: 'Oh My Pi',
	status: 'ready',
	path: '/bin/omp',
	version: '18.1.21',
	min_version: '18.0.0',
	approvals: true,
	gateway: true,
	install: 'npm i -g omp',
	tui: true,
	...over
});

describe('pickEngines', () => {
	beforeEach(() => setLocale('zh'));

	it('offers the native engines, then the presets; not-ready ones disabled, Pi without approvals', () => {
		const rows = pickEngines([
			preset({}),
			preset({ id: 'pi', name: 'Pi', approvals: false }),
			preset({ id: 'opencode', name: 'OpenCode', status: 'missing' }),
			preset({ id: 'x', name: 'X', status: 'unsupported', min_version: '2.0' })
		]);
		expect(rows.map((r) => r.key)).toEqual(['jucode', 'claude', 'codex', 'acp:omp', 'acp:pi', 'acp:opencode', 'acp:x']);
		expect(rows[3]).toMatchObject({ engine: 'acp', agent: 'omp', disabled: false, note: undefined });
		expect(rows[4]).toMatchObject({ disabled: false, note: '无审批' });
		expect(rows[5]).toMatchObject({ disabled: true, note: '未安装' });
		expect(rows[6]).toMatchObject({ disabled: true, note: '版本过低，需要 2.0' });
	});

	it('keys a preset by its id', () => {
		expect(engineKey('acp', 'pi')).toBe('acp:pi');
		expect(engineKey(undefined)).toBe('jucode');
		expect(engineKey('codex')).toBe('codex');
	});
});

describe('listable', () => {
	it('lists closed preset sessions, and hides a registered agent\'s closed ones', () => {
		expect(listable({ engine: 'acp', open: false, agent: 'omp' })).toBe(true);
		expect(listable({ engine: 'acp', open: false, agent: null })).toBe(false);
		expect(listable({ engine: 'acp', open: true })).toBe(true);
		expect(listable({ engine: 'claude', open: false })).toBe(true);
	});
});
