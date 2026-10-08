import { describe, it, expect } from 'vitest';
import {
	byProject,
	bySource,
	defaultPicks,
	folderName,
	importedFolders,
	mcpKey,
	planMcp,
	sessionKey,
	skillKey,
	summarize
} from './agentImport';
import type { ImportMcp, ImportOutcome, ImportSession, ImportSkill } from './protocol';

const session = (over: Partial<ImportSession> = {}): ImportSession => ({
	source: 'zcode',
	id: 's1',
	title: 'Fix it',
	cwd: '/p/a',
	updated_at_ms: 1000,
	messages: 3,
	imported: false,
	...over
});
const skill = (over: Partial<ImportSkill> = {}): ImportSkill => ({
	source: 'codex',
	name: 'review',
	description: '',
	path: '/h/.codex/skills/review',
	plugin: null,
	present: false,
	...over
});
const server = (over: Partial<ImportMcp> = {}): ImportMcp => ({
	source: 'claude',
	from: '',
	name: 'files',
	transport: 'stdio',
	command: 'npx',
	args: [],
	url: null,
	present: false,
	entry: { name: 'files', transport: 'stdio', command: 'npx', enabled: true },
	...over
});
const outcome = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({
	kind: 'session',
	source: 'zcode',
	key: 's1',
	status: 'imported',
	target: 'sabc',
	title: 'Fix it',
	cwd: '/p/a',
	engine: 'jucode',
	cwd_exists: true,
	error: null,
	...over
});

describe('grouping', () => {
	it('orders tools as listed and drops empty ones', () => {
		const groups = bySource([session({ source: 'omp' }), session({ source: 'claude' }), session({ source: 'omp', id: 's2' })]);
		expect(groups.map((g) => [g.source, g.items.length])).toEqual([
			['claude', 1],
			['omp', 2]
		]);
	});

	it('puts the most recently used folder first, newest conversation first', () => {
		const groups = byProject([
			session({ id: 'old', cwd: '/p/a', updated_at_ms: 1 }),
			session({ id: 'b', cwd: '/p/b', updated_at_ms: 5 }),
			session({ id: 'new', cwd: '/p/a', updated_at_ms: 9 })
		]);
		expect(groups.map((g) => [g.cwd, g.sessions.map((s) => s.id)])).toEqual([
			['/p/a', ['new', 'old']],
			['/p/b', ['b']]
		]);
	});

	it('names a folder by its last component', () => {
		expect(folderName('/Users/me/proj/')).toBe('proj');
		expect(folderName('C:\\work\\app')).toBe('app');
	});
});

describe('defaultPicks', () => {
	it('skips what was imported, what JuCode has, and what comes with a plugin', () => {
		const picks = defaultPicks({
			sessions: [session(), session({ id: 'done', imported: true })],
			skills: [skill(), skill({ name: 'had', path: '/x', present: true }), skill({ name: 'pdf', path: '/y', plugin: 'pdf' })],
			mcp: [server(), server({ name: 'had', present: true }), server({ name: 'notion', from: 'notion' })]
		});
		expect(Object.keys(picks).sort()).toEqual(
			[sessionKey(session()), skillKey(skill()), mcpKey(server())].sort()
		);
	});
});

describe('planMcp', () => {
	it('skips names already configured and the second pick of a name', () => {
		const a = server();
		const b = server({ source: 'codex', name: 'files' });
		const c = server({ name: 'search' });
		const d = server({ name: 'mine' });
		const plan = planMcp([a, b, c, d], ['mine']);
		expect(plan.add).toEqual([a, c]);
		expect(plan.skip).toEqual([b, d]);
	});
});

describe('summarize', () => {
	it('counts per kind and lists failures', () => {
		const summary = summarize(
			[
				outcome(),
				outcome({ key: 's2', status: 'existing' }),
				outcome({ key: 's3', status: 'failed', title: null, error: 'gone' }),
				outcome({ kind: 'skill', key: '/h/skills/review', status: 'imported', cwd: null }),
				outcome({ kind: 'skill', key: '/h/skills/pdf', status: 'failed', title: null, error: 'denied' })
			],
			[
				{ server: server(), status: 'imported' },
				{ server: server({ name: 'x' }), status: 'failed', error: 'no daemon' }
			]
		);
		expect(summary.sessions).toEqual({ imported: 1, existing: 1, failed: 1 });
		expect(summary.skills).toEqual({ imported: 1, existing: 0, failed: 1 });
		expect(summary.mcp).toEqual({ imported: 1, existing: 0, failed: 1 });
		expect(summary.failures).toEqual([
			{ label: 's3', error: 'gone' },
			{ label: 'pdf', error: 'denied' },
			{ label: 'x', error: 'no daemon' }
		]);
	});

	it('lists the folders of imported conversations that still exist, once each', () => {
		expect(
			importedFolders([
				outcome(),
				outcome({ key: 's2', status: 'existing' }),
				outcome({ key: 's3', cwd: '/p/gone', cwd_exists: false }),
				outcome({ key: 's4', status: 'failed', cwd: '/p/c' }),
				outcome({ key: 's5', cwd: '/p/b' }),
				outcome({ kind: 'skill', cwd: null })
			])
		).toEqual(['/p/a', '/p/b']);
	});
});
