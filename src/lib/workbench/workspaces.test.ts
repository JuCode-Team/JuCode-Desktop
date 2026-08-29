import { describe, it, expect } from 'vitest';
import {
	createWorkspace,
	defaultWorkspacesFile,
	migrateLegacy,
	parseLegacyDockTabs,
	parseWorkspacesFile,
	sanitizeProjects,
	serializeWorkspaces,
	LEGACY_DOCK_ACTIVE_KEY,
	LEGACY_DOCK_TABS_KEY,
	LEGACY_PROJECTS_KEY,
	WORKSPACES_VERSION
} from './workspaces';
import { deserializeLayout, leavesOf } from './tiles';

const proj = (id: string) => ({ id, name: id, path: `/tmp/${id}` });

describe('workspaces file', () => {
	it('round-trips through serialize/parse', () => {
		const ws = createWorkspace('工作台', [proj('p1'), proj('p2')]);
		const file = defaultWorkspacesFile(ws);
		const parsed = parseWorkspacesFile(serializeWorkspaces(file));
		expect(parsed).toEqual(file);
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
		const layout = deserializeLayout(ws.layout);
		const leaf = leavesOf(layout!.root)[0];
		expect(leaf.tabs.map((t) => t.panel)).toEqual(['goal', 'term']);
		expect(leaf.active).toBe('t2');
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
