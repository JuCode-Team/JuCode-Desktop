import { describe, expect, it, vi, beforeEach } from 'vitest';

const request = vi.fn((_op: Record<string, unknown>) => Promise.resolve({}));
const desktopOf = vi.fn((_sid: string): string | undefined => undefined);
vi.mock('./protocol', () => ({
	daemon: { request: (op: Record<string, unknown>) => request(op), desktopOf: (sid: string) => desktopOf(sid), post: vi.fn(() => Promise.resolve()), sessionOf: vi.fn() },
	hostSession: vi.fn(() => Promise.resolve()),
	sessionMeta: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	acpAgentsList: vi.fn(() => Promise.resolve([])),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	chatsDir: vi.fn(() => Promise.resolve('/h/.jucode/chats')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve('')),
	sessionHistory: vi.fn(() => Promise.resolve([])),
	appDataRead: vi.fn(() => Promise.resolve(null)),
	appDataWrite: vi.fn(() => Promise.resolve())
}));

const { DaemonSync } = await import('./daemonSync.svelte');
const { SessionStore, listedSessions } = await import('./session.svelte');
const { WorkspaceStore } = await import('./workbench/workspaceStore.svelte');
const { sessionMeta, git } = await import('./protocol');

async function setup() {
	const store = new SessionStore();
	const workspaces = new WorkspaceStore();
	await workspaces.load('默认工作区');
	store.projects.push({ id: 'p1', name: 'app', path: '/w/app', sessions: [] });
	store.loaded = true;
	return { store, workspaces, sync: new DaemonSync(store, workspaces) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A project added on the desktop (through the sync's own store). */
function addProject(sync: InstanceType<typeof DaemonSync>, _ws: unknown, id = 'p2') {
	(sync as unknown as { store: InstanceType<typeof SessionStore> }).store.projects.push({ id, name: id, path: `/w/${id}`, sessions: [] });
}

beforeEach(() => {
	vi.clearAllMocks();
	desktopOf.mockReturnValue(undefined);
});

describe('DaemonSync', () => {
	it('asks for the daemon\'s list when it has none (a page made anew on a live connection)', async () => {
		const { sync, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		request.mockImplementation((op) =>
			Promise.resolve(op.op === 'workspaces' ? { type: 'workspaces', rev: 7, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects: [] }] } : {})
		);
		await sync.push();
		expect(request.mock.calls.map((c) => c[0].op)).toEqual(['workspaces', 'workspaces_set']);
		const sent = request.mock.calls[1][0] as { rev: number; workspaces: { projects: { id: string }[] }[] };
		expect(sent.rev).toBe(7);
		expect(sent.workspaces[0].projects.map((p) => p.id)).toEqual(['p1']);
		request.mockImplementation(() => Promise.resolve({}));
	});

	it('merges and sends again when another client saved first, and passes on other refusals', async () => {
		const { sync, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		const list = (rev: number) => ({ type: 'workspaces', rev, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects: [] }] });
		sync.handle(list(1));
		await flush();
		request.mockReset();
		let refused = false;
		request.mockImplementation((op) => {
			if (op.op === 'workspaces') return Promise.resolve(list(2));
			if (!refused) {
				refused = true;
				return Promise.reject(new Error('stale workspaces (rev 1, current 2)'));
			}
			return Promise.resolve({});
		});
		addProject(sync, workspaces);
		await sync.push();
		const sets = request.mock.calls.filter((c) => c[0].op === 'workspaces_set').map((c) => c[0].rev);
		expect(sets).toEqual([1, 2]);

		request.mockImplementation((op) => (op.op === 'workspaces_set' ? Promise.reject(new Error('project paths must be absolute')) : Promise.resolve({})));
		addProject(sync, workspaces, 'p3');
		await expect(sync.push()).rejects.toThrow('project paths must be absolute');
		request.mockImplementation(() => Promise.resolve({}));
	});

	it('gives an empty daemon the desktop list, then stays quiet while they agree', async () => {
		const { sync, workspaces } = await setup();
		sync.handle({ type: 'workspaces', rev: 0, workspaces: [] });
		expect(request).toHaveBeenCalledOnce();
		const sent = request.mock.calls[0][0] as { rev: number; workspaces: { projects: { path: string }[] }[] };
		expect(sent.rev).toBe(0);
		expect(sent.workspaces[0].projects.map((p) => p.path)).toEqual(['/w/app']);

		// The daemon echoes it back with its keys in another order: no new save.
		request.mockClear();
		const ws = workspaces.workspaces[0];
		sync.handle({
			type: 'workspaces',
			rev: 1,
			workspaces: [{ projects: [{ path: '/w/app', name: 'app', id: 'p1' }], name: ws.name, is_default: true, id: ws.id }]
		});
		expect(request).not.toHaveBeenCalled();
	});

	it('keeps projects only the desktop has on the first list, and sends them', async () => {
		const { sync, store, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		sync.handle({
			type: 'workspaces',
			rev: 3,
			workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects: [{ id: 'p9', name: 'phone-made', path: '/w/new' }] }]
		});
		expect(store.projects.map((p) => p.path)).toEqual(['/w/app', '/w/new']);
		const sent = request.mock.calls[0][0] as { workspaces: { projects: { path: string }[] }[] };
		expect(sent.workspaces[0].projects.map((p) => p.path)).toEqual(['/w/app', '/w/new']);
	});

	it('follows projects added, renamed or removed on another client', async () => {
		const { sync, store, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		const frame = (rev: number, projects: { id: string; name: string; path: string }[]) =>
			sync.handle({ type: 'workspaces', rev, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects }] });
		frame(3, [{ id: 'p1', name: 'app', path: '/w/app' }]);
		expect(request).not.toHaveBeenCalled();
		frame(4, [{ id: 'p9', name: 'phone-made', path: '/w/new' }]);
		expect(store.projects.map((p) => p.path)).toEqual(['/w/new']);
		expect(store.projects[0].id).toBe('p9');
		expect(request).not.toHaveBeenCalled();
	});

	it('sends a folder icon and color, follows other clients, and drops a dirty icon', async () => {
		const { sync, store, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		const frame = (rev: number, project: Record<string, unknown>) =>
			sync.handle({ type: 'workspaces', rev, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects: [project] }] });
		const base = { id: 'p1', name: 'app', path: '/w/app' };
		frame(3, base);
		store.setProjectChrome(store.projects[0], { color: '#2563eb', icon: { kind: 'builtin', id: 'rocket' } });
		sync.push();
		const sent = request.mock.calls[0][0] as { workspaces: { projects: Record<string, unknown>[] }[] };
		expect(sent.workspaces[0].projects[0]).toMatchObject({ color: '#2563eb', icon: { kind: 'builtin', id: 'rocket' } });

		request.mockClear();
		frame(5, { ...base, color: '#dc2626', icon: { kind: 'svg', markup: '<svg><script>x</script></svg>' } });
		expect(store.projects[0].color).toBe('#dc2626');
		expect(store.projects[0].icon).toBeUndefined();
		expect(request).not.toHaveBeenCalled();
	});

	it('sends a project\'s extra directories, follows other clients, and saves them', async () => {
		const { sync, store, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		const frame = (rev: number, project: Record<string, unknown>) =>
			sync.handle({ type: 'workspaces', rev, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects: [project] }] });
		const base = { id: 'p1', name: 'app', path: '/w/app' };
		frame(3, base);
		store.setProjectDirs(store.projects[0], ['/w/lib', 'relative', '/w/lib']);
		expect(store.projects[0].dirs).toEqual(['/w/lib']);
		sync.push();
		const sent = request.mock.calls[0][0] as { workspaces: { projects: Record<string, unknown>[] }[] };
		expect(sent.workspaces[0].projects[0]).toMatchObject({ dirs: ['/w/lib'] });
		expect(store.serialize()[0].dirs).toEqual(['/w/lib']);

		request.mockClear();
		frame(5, { ...base, dirs: ['/w/docs'] });
		expect(store.projects[0].dirs).toEqual(['/w/docs']);
		frame(6, base);
		expect(store.projects[0].dirs).toBeUndefined();
		expect(request).not.toHaveBeenCalled();
	});

	it('holds a list that comes before the restore and merges it once restored, without a second copy', async () => {
		const store = new SessionStore();
		const workspaces = new WorkspaceStore();
		await workspaces.load('默认工作区');
		const sync = new DaemonSync(store, workspaces, () => store.loaded);
		const ws = workspaces.workspaces[0];
		sync.handle({
			type: 'workspaces',
			rev: 2,
			workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects: [{ id: 'p1', name: 'app', path: '/w/app' }, { id: 'p9', name: 'new', path: '/w/new' }] }]
		});
		expect(store.projects).toHaveLength(0);
		await store.restore([{ id: 'p1', name: 'app', path: '/w/app', tabs: [{ id: 't1', sid: 's-1', title: 'one' }] }]);
		sync.flush();
		expect(store.projects.map((p) => p.path)).toEqual(['/w/app', '/w/new']);
		expect(store.projects[0].sessions.map((s) => s.chat.sessionId)).toEqual(['s-1']);
	});

	it('keeps a project added here when a list without it arrives before the echo', async () => {
		const { sync, store, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		const frame = (rev: number, projects: { id: string; name: string; path: string }[]) =>
			sync.handle({ type: 'workspaces', rev, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects }] });
		frame(3, [{ id: 'p1', name: 'app', path: '/w/app' }]);
		store.addProjectShell({ id: 'p2', name: 'two', path: '/w/two' });
		frame(4, [{ id: 'p1', name: 'app renamed', path: '/w/app' }]);
		expect(store.projects.map((p) => [p.path, p.name])).toEqual([
			['/w/app', 'app renamed'],
			['/w/two', 'two']
		]);
		const sent = request.mock.calls.at(-1)![0] as { workspaces: { projects: { path: string }[] }[] };
		expect(sent.workspaces[0].projects.map((p) => p.path)).toEqual(['/w/app', '/w/two']);
	});

	it('after a reconnect, a daemon that knows fewer projects or sessions closes nothing', async () => {
		const { sync, store, workspaces } = await setup();
		const ws = workspaces.workspaces[0];
		const frame = (rev: number, projects: { id: string; name: string; path: string }[]) =>
			sync.handle({ type: 'workspaces', rev, workspaces: [{ id: ws.id, name: ws.name, is_default: true, projects }] });
		frame(3, [{ id: 'p1', name: 'app', path: '/w/app' }, { id: 'p9', name: 'new', path: '/w/new' }]);
		sync.reconcile([{ session: 's-1', cwd: '/w/app', created_at: 0, open: false, engine: 'jucode', project: 'p1' }]);
		sync.reset();
		frame(1, [{ id: 'p1', name: 'app', path: '/w/app' }]);
		sync.reconcile([]);
		expect(store.workspaceProjects.map((p) => p.path)).toEqual(['/w/app', '/w/new']);
		expect(store.projects[0].sessions.map((s) => s.chat.sessionId)).toEqual(['s-1']);
	});

	it('restores a project saved twice once, with the tabs of both', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'app', path: '/w/app', tabs: [{ id: 't1', sid: 's-1', title: 'one' }] },
			{ id: 'p1', name: 'app', path: '/w/app/', tabs: [{ id: 't1', sid: 's-1', title: 'one' }, { id: 't2', sid: 's-2', title: 'two' }] }
		]);
		expect(store.projects).toHaveLength(1);
		expect(store.projects[0].sessions.map((s) => s.chat.sessionId)).toEqual(['s-1', 's-2']);
	});

	it('restores a workspace\'s sessions of no project under their saved ids, and saves them back', async () => {
		const store = new SessionStore();
		const loose = [{ id: 't9', sid: 's-9', title: 'nine', backend: 'claude', cwd: '/w/else' }];
		await store.restore([], loose);
		expect(store.loose!.sessions.map((s) => s.id)).toEqual(['t9']);
		expect(store.activeId).toBe('t9');
		expect(store.serialize()).toEqual([]);
		expect(store.serializeLoose()).toEqual(loose);
	});

	it('saves a stale worktree project with the tabs it was restored with', async () => {
		vi.mocked(git).mockRejectedValueOnce(new Error('not a git repository'));
		const store = new SessionStore();
		const tabs = [{ id: 't1', sid: 's-1', title: 'one' }];
		await store.restore([
			{ id: 'p1', name: 'task', path: '/w/gone', worktree: { isWorktree: true, mainRepoPath: '/w/app', branch: 'b', baseBranch: 'main', slug: 'b' }, tabs },
			{ id: 'p2', name: 'app', path: '/w/app', tabs: [] }
		]);
		expect(store.projects[0].stale).toBe(true);
		expect(store.serialize()[0].tabs).toEqual(tabs);
	});

	it('lists daemon sessions dormant, follows their titles and archive state, and drops removed ones', async () => {
		const { sync, store } = await setup();
		const session = (over: Record<string, unknown> = {}) => ({
			session: 's-1', cwd: '/w/app/', created_at: 0, open: false, title: 'fix login', archived: false, engine: 'claude', project: 'p1', ...over
		});
		sync.reconcile([session(), session({ session: 's-other', cwd: '/elsewhere', project: null })]);
		const listed = store.projects[0].sessions;
		expect(listed).toHaveLength(1);
		// Of no project: in the loose group, in its own folder.
		expect(store.loose!.sessions.map((s) => [s.chat.sessionId, s.cwd])).toEqual([['s-other', '/elsewhere']]);
		expect(listed[0]).toMatchObject({ dormant: true, backendId: 'claude' });
		expect(listed[0].chat.sessionId).toBe('s-1');
		expect(listed[0].chat.title).toBe('fix login');

		sync.reconcile([session({ title: 'Fix login flow', archived: true })]);
		expect(listed[0].chat.title).toBe('Fix login flow');
		expect(listed[0].archived).toBe(true);

		sync.reconcile([]);
		expect(store.projects[0].sessions).toHaveLength(0);
		expect(store.loose!.sessions).toHaveLength(0);
	});

	it('lists a scheduled run in its worktree under the project, with the worktree it works in', async () => {
		const { sync, store } = await setup();
		const tree = { repo: '/w/app', path: '/w/.jucode-worktrees/app/sch-1-1023', branch: 'jucode/sch-1-1023', base: 'main', slug: 'sch-1-1023' };
		sync.reconcile([{ session: 's-run', cwd: tree.path, created_at: 0, open: false, engine: 'jucode', project: 'p1', schedule: 'sch-1', worktree: tree }]);
		const [run] = store.projects[0].sessions;
		expect(run.cwd).toBe(tree.path);
		expect(run.worktree).toEqual({ isWorktree: true, mainRepoPath: '/w/app', branch: 'jucode/sch-1-1023', baseBranch: 'main', slug: 'sch-1-1023' });
		// Removed by the daemon once the run was archived: forgotten here too.
		sync.reconcile([{ session: 's-run', cwd: tree.path, created_at: 0, open: false, engine: 'jucode', project: 'p1', schedule: 'sch-1', archived: true, worktree: { ...tree, gone: true } }]);
		expect(run.worktree).toBeUndefined();
	});

	it('with a daemon that names no project, sessions stay where they are and new ones go by folder', async () => {
		const { sync, store } = await setup();
		const p = store.projects[0];
		const id = store.addSession(p);
		const s = p.sessions[0];
		s.draft = false;
		s.chat.sessionId = 's-1';
		sync.reconcile([
			{ session: 's-1', cwd: '/elsewhere', created_at: 0, open: true, engine: 'jucode' },
			{ session: 's-2', cwd: '/w/app', created_at: 0, open: false, engine: 'jucode' }
		]);
		expect(store.ownerOf(id)).toBe(p);
		expect(p.sessions.map((x) => x.chat.sessionId)).toEqual(['s-2', 's-1']);
		expect(store.loose).toBeUndefined();
	});

	it('places a session by its project, follows a move, and lets one go to another workspace', async () => {
		const { sync, store } = await setup();
		store.projects.push({ id: 'p2', name: 'web', path: '/w/web', sessions: [] });
		const session = (project: string | null, cwd = '/w/web') => ({ session: 's-1', cwd, created_at: 0, open: false, engine: 'jucode', project });
		// In p1 although it works in p2's folder.
		sync.reconcile([session('p1')]);
		const s = store.projects[0].sessions[0];
		expect(s.cwd).toBe('/w/web');
		sync.reconcile([session('p2')]);
		expect(store.projects[1].sessions).toEqual([s]);
		expect(s.cwd).toBeUndefined();
		sync.reconcile([session(null)]);
		expect(store.loose!.sessions).toEqual([s]);
		expect(s.cwd).toBe('/w/web');
		// A project this window does not have: not listed here.
		sync.reconcile([session('p-elsewhere')]);
		expect(store.allSessions).toHaveLength(0);
	});

	it('shows a session of no project in the workspace it is saved in; one saved nowhere goes to the default', async () => {
		const { sync, store, workspaces } = await setup();
		const def = workspaces.active!;
		const other = workspaces.create('其他')!;
		const loose = (session: string) => ({ session, cwd: '/w/x', created_at: 0, open: false, engine: 'claude', project: null, title: 't-' + session });
		workspaces.setLoose(other.id, [{ sid: 's-there', title: 't' }]);
		// The default is open: one saved nowhere shows here, one saved in the other does not.
		sync.reconcile([loose('s-new'), loose('s-there')]);
		expect(store.loose!.sessions.map((s) => s.chat.sessionId)).toEqual(['s-new']);

		// Another workspace is open: one saved nowhere is saved in the default, not shown.
		workspaces.updateProjects(store.serialize(), store.serializeLoose());
		store.projects = store.projects.filter((p) => !p.loose);
		workspaces.setActive(other.id);
		sync.reconcile([loose('s-new'), loose('s-there'), loose('s-phone')]);
		expect(store.loose!.sessions.map((s) => s.chat.sessionId)).toEqual(['s-there']);
		expect(def.loose!.map((t) => t.sid)).toEqual(['s-phone', 's-new']);
		expect(def.loose![0]).toEqual({ sid: 's-phone', title: 't-s-phone', backend: 'claude', cwd: '/w/x' });
		// Saved there now: the next list does not save it twice.
		sync.reconcile([loose('s-new'), loose('s-there'), loose('s-phone')]);
		expect(def.loose).toHaveLength(2);
	});

	it('lists a built-in ACP agent\'s session (a scheduled run, a phone\'s), never a registered agent\'s', async () => {
		const { sync, store } = await setup();
		sync.reconcile([
			{ session: 's-omp', cwd: '/w/app', created_at: 0, open: false, engine: 'acp', agent: 'omp', project: 'p1' },
			{ session: 's-custom', cwd: '/w/app', created_at: 0, open: false, engine: 'acp', agent: null, project: 'p1' }
		]);
		const listed = store.projects[0].sessions;
		expect(listed.map((s) => s.chat.sessionId)).toEqual(['s-omp']);
		expect(listed[0]).toMatchObject({ dormant: true, backendId: 'acp', acpAgent: { id: 'omp', preset: true } });
	});

	it('never lists a session a tab here is opening', async () => {
		const { sync, store } = await setup();
		desktopOf.mockReturnValue('tab-1');
		sync.reconcile([{ session: 's-2', cwd: '/w/app', created_at: 0, open: true, engine: 'jucode' }]);
		expect(store.projects[0].sessions).toHaveLength(0);
	});

	it('skips a just-created session while a tab here waits for its id, not while only drafts are open', async () => {
		const { sync, store } = await setup();
		const p = store.projects[0];
		const fresh = (session: string) => ({ session, cwd: '/w/app', created_at: Date.now(), open: true, engine: 'jucode', project: 'p1' });
		// A draft has no daemon session yet: nothing is on its way to it.
		store.addSession(p);
		sync.reconcile([fresh('s-new')]);
		expect(p.sessions.map((s) => s.chat.sessionId)).toEqual(['s-new', '']);

		// A started tab whose daemon id has not arrived yet may be the owner.
		const opening = p.sessions.find((s) => !s.chat.sessionId)!;
		opening.draft = false;
		sync.reconcile([fresh('s-new'), fresh('s-mine')]);
		expect(p.sessions.map((s) => s.chat.sessionId)).toEqual(['s-new', '']);
		// Older sessions are listed either way.
		sync.reconcile([fresh('s-new'), { ...fresh('s-old'), created_at: Date.now() - 60_000 }]);
		expect(p.sessions.map((s) => s.chat.sessionId)).toEqual(['s-old', 's-new', '']);
	});

	it('keeps the sidebar order and pins over a reconcile; new daemon sessions join at the start', async () => {
		const { sync, store } = await setup();
		const p = store.projects[0];
		const session = (id: string) => ({ session: id, cwd: '/w/app', created_at: 0, open: false, engine: 'jucode', title: id, project: 'p1' });
		sync.reconcile([session('s-1'), session('s-2'), session('s-3')]);
		const id = (sid: string) => p.sessions.find((s) => s.chat.sessionId === sid)!.id;
		store.setPinned(id('s-2'), true);
		sync.reconcile([session('s-1'), session('s-2'), session('s-3'), session('s-4')]);
		expect(listedSessions(p).map((s) => s.chat.sessionId)).toEqual(['s-2', 's-4', 's-3', 's-1']);

		// After a restart the saved order comes back and the daemon list keeps it.
		const again = new SessionStore();
		await again.restore(store.serialize());
		again.loaded = true;
		new DaemonSync(again, new WorkspaceStore()).reconcile([session('s-1'), session('s-2'), session('s-3'), session('s-4')]);
		expect(listedSessions(again.projects[0]).map((s) => s.chat.sessionId)).toEqual(['s-2', 's-4', 's-3', 's-1']);
	});

	it('shares renames, archiving and closing of daemon sessions', async () => {
		const { store, sync } = await setup();
		sync.reconcile([{ session: 's-3', cwd: '/w/app', created_at: 0, open: false, engine: 'jucode', title: 'x', project: 'p1' }]);
		const id = store.projects[0].sessions[0].id;
		store.renameSession(id, 'Nice name');
		store.archiveSession(id);
		store.removeSession(id);
		expect(vi.mocked(sessionMeta).mock.calls).toEqual([
			['s-3', { title: 'Nice name' }],
			['s-3', { archived: true }],
			['s-3', { hidden: true }]
		]);
		await flush();
	});
});
