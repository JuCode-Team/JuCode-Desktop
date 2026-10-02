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

beforeEach(() => {
	vi.clearAllMocks();
	desktopOf.mockReturnValue(undefined);
});

describe('DaemonSync', () => {
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
		sync.reconcile([{ session: 's-1', cwd: '/w/app', created_at: 0, open: false, engine: 'jucode' }]);
		sync.reset();
		frame(1, [{ id: 'p1', name: 'app', path: '/w/app' }]);
		sync.reconcile([]);
		expect(store.projects.map((p) => p.path)).toEqual(['/w/app', '/w/new']);
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
			session: 's-1', cwd: '/w/app/', created_at: 0, open: false, title: 'fix login', archived: false, engine: 'claude', ...over
		});
		sync.reconcile([session(), session({ session: 's-agent', agent: 'ops' }), session({ session: 's-other', cwd: '/elsewhere' })]);
		const listed = store.projects[0].sessions;
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ dormant: true, backendId: 'claude' });
		expect(listed[0].chat.sessionId).toBe('s-1');
		expect(listed[0].chat.title).toBe('fix login');

		sync.reconcile([session({ title: 'Fix login flow', archived: true })]);
		expect(listed[0].chat.title).toBe('Fix login flow');
		expect(listed[0].archived).toBe(true);

		sync.reconcile([]);
		expect(store.projects[0].sessions).toHaveLength(0);
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
		const fresh = (session: string) => ({ session, cwd: '/w/app', created_at: Date.now(), open: true, engine: 'jucode' });
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
		const session = (id: string) => ({ session: id, cwd: '/w/app', created_at: 0, open: false, engine: 'jucode', title: id });
		sync.reconcile([session('s-1'), session('s-2'), session('s-3')]);
		const id = (sid: string) => p.sessions.find((s) => s.chat.sessionId === sid)!.id;
		store.moveSession(id('s-3'), id('s-1'), false);
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
		sync.reconcile([{ session: 's-3', cwd: '/w/app', created_at: 0, open: false, engine: 'jucode', title: 'x' }]);
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
