import { describe, it, expect } from 'vitest';
import {
	createWorkspace,
	defaultWorkspacesFile,
	inWorkspace,
	migrateLegacy,
	parseLegacyDockTabs,
	parseWorkspacesFile,
	sanitizeProjects,
	serializeWorkspaces,
	workspaceSessions,
	activityOf,
	type ActivityKind,
	LEGACY_DOCK_ACTIVE_KEY,
	LEGACY_DOCK_TABS_KEY,
	LEGACY_PROJECTS_KEY,
	WORKSPACES_VERSION
} from './workspaces';

const proj = (id: string) => ({ id, name: id, path: `/tmp/${id}` });

describe('workspaces file', () => {
	it('round-trips through serialize/parse', () => {
		const ws = createWorkspace('工作台', [proj('p1'), proj('p2')]);
		const file = defaultWorkspacesFile(ws);
		const parsed = parseWorkspacesFile(serializeWorkspaces(file));
		expect(parsed).toEqual(file);
	});

	it('keeps a workspace\'s sessions of no project, their chrome checked', () => {
		const ws = { ...createWorkspace('a'), loose: [{ id: 's1', sid: 'x', title: 't', cwd: '/w', color: 'red' }, null] };
		const parsed = parseWorkspacesFile(JSON.stringify(defaultWorkspacesFile(ws as never)));
		expect(parsed?.workspaces[0].loose).toEqual([{ id: 's1', sid: 'x', title: 't', cwd: '/w' }]);
		expect(inWorkspace(parsed!.workspaces[0], 'x')).toBe(true);
		expect(inWorkspace(parsed!.workspaces[0], 'y')).toBe(false);
	});

	it('rejects unknown versions so a newer file is never clobbered', () => {
		const file = defaultWorkspacesFile(createWorkspace('a'));
		const newer = JSON.stringify({ ...file, version: WORKSPACES_VERSION + 1 });
		expect(parseWorkspacesFile(newer)).toBeNull();
	});

	it('rejects garbage and files without a usable workspace', () => {
		expect(parseWorkspacesFile('not json {')).toBeNull();
		expect(parseWorkspacesFile('{"version":1,"active":"x","workspaces":[]}')).toBeNull();
		expect(parseWorkspacesFile('{"version":1,"workspaces":[{"nope":true}]}')).toBeNull();
	});

	it('falls back to the first workspace when active points nowhere', () => {
		const file = defaultWorkspacesFile(createWorkspace('a'));
		const parsed = parseWorkspacesFile(JSON.stringify({ ...file, active: 'missing' }));
		expect(parsed?.active).toBe(file.workspaces[0].id);
	});

	it('drops structurally invalid projects but keeps optional fields', () => {
		const good = { ...proj('p1'), lastBackend: 'codex', tabs: [{ sid: 's', title: 'T' }] };
		const projects = sanitizeProjects([good, { id: 'x' }, null, 'junk']);
		expect(projects).toEqual([good]);
	});

	it('drops dirty chrome on nested session tabs (an inactive workspace must not carry it back)', () => {
		const dirty = JSON.stringify({
			version: 1,
			active: 'a',
			workspaces: [
				{
					id: 'a',
					name: 'A',
					layout: null,
					projects: [
						{
							...proj('p1'),
							tabs: [
								{
									id: 't1',
									sid: 's',
									title: 'T',
									color: 'red',
									icon: { kind: 'svg', markup: '<svg><script>alert(1)</script></svg>' },
									extra: 'kept'
								}
							]
						}
					]
				}
			]
		});
		const tab = parseWorkspacesFile(dirty)?.workspaces[0].projects[0].tabs?.[0] as unknown as Record<string, unknown>;
		expect(tab.icon).toBeUndefined();
		expect(tab.color).toBeUndefined();
		expect(tab).toMatchObject({ id: 't1', sid: 's', title: 'T', extra: 'kept' });
	});

	it('keeps version 1 and parses an old file without chrome, promoting the first workspace to default', () => {
		expect(WORKSPACES_VERSION).toBe(1);
		const old = JSON.stringify({
			version: 1,
			active: 'b',
			workspaces: [
				{ id: 'a', name: 'A', projects: [], layout: null },
				{ id: 'b', name: 'B', projects: [], layout: null }
			]
		});
		const parsed = parseWorkspacesFile(old);
		expect(parsed?.workspaces.map((w) => !!w.isDefault)).toEqual([true, false]);
		expect(parsed?.active).toBe('b');
		expect(parsed?.workspaces[0].color).toBeUndefined();
		expect(parsed?.workspaces[0].icon).toBeUndefined();
	});

	it('round-trips workspace chrome (color + icon) and drops invalid values', () => {
		const ws = createWorkspace('tagged', [], null, {
			color: '#2563eb',
			icon: { kind: 'builtin', id: 'rocket' }
		});
		const file = defaultWorkspacesFile(ws);
		const parsed = parseWorkspacesFile(serializeWorkspaces(file));
		expect(parsed?.workspaces[0].color).toBe('#2563eb');
		expect(parsed?.workspaces[0].icon).toEqual({ kind: 'builtin', id: 'rocket' });
		expect(parsed?.workspaces[0].isDefault).toBe(true);
		expect(parsed?.version).toBe(WORKSPACES_VERSION);

		const dirty = JSON.stringify({
			version: 1,
			active: 'a',
			workspaces: [{ id: 'a', name: 'A', color: 'red', icon: { kind: 'builtin', id: 'nope' }, extra: 1 }]
		});
		const p2 = parseWorkspacesFile(dirty);
		expect(p2?.workspaces[0].color).toBeUndefined();
		expect(p2?.workspaces[0].icon).toBeUndefined();
		expect('extra' in (p2?.workspaces[0] ?? {})).toBe(false);
	});

	it('user-created workspaces are not default', () => {
		expect(createWorkspace('mine').isDefault).toBeUndefined();
	});
});

describe('legacy migration', () => {
	const store = (data: Record<string, string>) => (key: string) => data[key] ?? null;

	it('wraps old projects and dock tabs into one default workspace', () => {
		const legacy = store({
			[LEGACY_PROJECTS_KEY]: JSON.stringify([proj('p1')]),
			[LEGACY_DOCK_TABS_KEY]: JSON.stringify([
				{ id: 't1', panel: 'goal' },
				{ id: 't2', panel: 'term' }
			]),
			[LEGACY_DOCK_ACTIVE_KEY]: 't2'
		});
		const file = migrateLegacy(legacy, '默认工作区');
		expect(file?.workspaces).toHaveLength(1);
		const ws = file!.workspaces[0];
		expect(ws.name).toBe('默认工作区');
		expect(ws.isDefault).toBe(true);
		expect(ws.projects).toEqual([proj('p1')]);
		expect(ws.layout).toEqual({ v: 2, view: null, side: 'term' });
	});

	it('migrates the oldest dock format (bare panel strings)', () => {
		const tabs = parseLegacyDockTabs(JSON.stringify(['plan', 'git', 'bogus-panel']));
		expect(tabs.map((t) => t.panel)).toEqual(['plan', 'git']);
	});

	it('tolerates corrupt legacy values', () => {
		expect(parseLegacyDockTabs('{{{')).toEqual([]);
		const file = migrateLegacy(store({ [LEGACY_PROJECTS_KEY]: '{{{' }), 'ws');
		expect(file?.workspaces[0].projects).toEqual([]);
	});

	it('returns null on a fresh install with no legacy keys', () => {
		expect(migrateLegacy(store({}), 'ws')).toBeNull();
	});
});

describe('workspace activity', () => {
	const tabs = (...t: { sid?: string; title: string; archived?: boolean }[]) => [{ ...proj('p'), tabs: t }];
	const b = createWorkspace('b', tabs({ sid: 's2', title: 'two' }, { sid: 's3', title: 'three' }, { sid: 's4', title: 'old', archived: true }, { title: 'draft' }));

	it('lists the saved sessions of a workspace, archived ones and drafts left out', () => {
		const c = { ...b, loose: [{ sid: 's9', title: 'loose' }] };
		expect(workspaceSessions(c).map((s) => s.sid)).toEqual(['s2', 's3', 's9']);
	});

	it('puts what wants the user first, then failures, unseen replies and work going', () => {
		const kinds: Record<string, ActivityKind> = { a: 'running', b: 'done', c: 'input', d: 'failed' };
		const all = ['a', 'b', 'c', 'd', 'e'].map((sid) => ({ sid, title: sid }));
		const activity = activityOf(all, (sid) => kinds[sid] ?? null);
		expect(activity.sessions).toBe(5);
		expect(activity.items.map((i) => [i.sid, i.kind])).toEqual([
			['c', 'input'],
			['d', 'failed'],
			['b', 'done'],
			['a', 'running']
		]);
	});
});
