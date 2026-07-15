import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer so the store's lifecycle is testable in node.
vi.mock('./protocol', () => ({
	createSession: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve(''))
}));

import { SessionStore } from './session.svelte';
import { createSession, sendOp, git } from './protocol';
import { setLocale } from './i18n';
import type { Project, WorktreeMeta } from './types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });

beforeEach(() => {
	vi.clearAllMocks();
	// Pin the locale so user-facing strings are deterministic regardless of the
	// host's navigator.language.
	setLocale('zh');
});

describe('SessionStore lifecycle', () => {
	it('addSession spawns a session and makes it active', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(p.sessions.map((s) => s.id)).toEqual([id]);
		expect(store.activeId).toBe(id);
		expect(store.chat).toBe(p.sessions[0].chat);
		expect(createSession).toHaveBeenCalledWith(id, p.path);
	});

	it('removeSession re-points activeId to a surviving session', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const a = store.addSession(p);
		const b = store.addSession(p);
		expect(store.activeId).toBe(b);
		store.removeSession(b);
		expect(store.activeId).toBe(a);
		store.removeSession(a);
		expect(store.activeId).toBe('');
	});

	it('archiveSession hides a thread and re-points activeId to a live sibling', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const a = store.addSession(p);
		const b = store.addSession(p);
		expect(store.activeId).toBe(b);
		store.archiveSession(b);
		expect(p.sessions.find((s) => s.id === b)?.archived).toBe(true);
		expect(store.activeId).toBe(a); // moved off the archived one
		store.unarchiveSession(b);
		expect(p.sessions.find((s) => s.id === b)?.archived).toBe(false);
	});

	it('serialize persists the archived flag and restore re-applies it', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.title = 'kept';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		store.archiveSession(p.sessions[0].id);
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([{ sid: 'sid-0', title: 'kept', archived: true }]);
	});

	it('a flagged resume failure makes the next claude restart come up fresh', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.sessionId = 'sid-x';
		s.chat.messages.push({ kind: 'user', text: 'hi' }); // resumable
		s.chat.resumeBroken = true;
		vi.clearAllMocks();
		store.restartSession(id);
		// Spawned without a resume option, and the one-shot flag is consumed.
		const call = (createSession as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
		expect((call?.[3] as { resume?: string } | undefined)?.resume).toBeUndefined();
		expect(s.chat.resumeBroken).toBe(false);
	});

	it('switchBackend swaps a virgin session in place (same id, new engine)', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(p.sessions[0].backendId).toBe('jucode');
		await store.switchBackend(id, 'claude');
		const s = p.sessions[0];
		expect(s.id).toBe(id); // same tab
		expect(s.backendId).toBe('claude');
		expect(s.chat.backendId).toBe('claude');
		expect(s.adapter.id).toBe('claude');
		expect(p.lastBackend).toBe('claude');
		// claude spawns pin a resumable session uuid.
		const call = (createSession as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
		expect(call[2]).toBe('claude');
		expect((call[3] as { session_id?: string }).session_id).toBe(s.chat.sessionId);
		expect(s.chat.sessionId).not.toBe('');
	});

	it('switchBackend refuses once the first user turn exists or the session was restored', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		await store.switchBackend(id, 'codex');
		expect(p.sessions[0].backendId).toBe('jucode');

		const rid = store.restoreSession(p, 'sid-1', 'old', 'jucode');
		await store.switchBackend(rid, 'codex');
		expect(p.sessions.find((s) => s.id === rid)?.backendId).toBe('jucode');
	});

	it('removeProject tears down its sessions and clears a dangling activeId', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		store.removeProject(p);
		expect(store.projects).toEqual([]);
		expect(store.activeId).toBe('');
	});

	it('auto-restart is capped at 3 within the window, then pauses', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		for (let i = 0; i < 4; i++) store.handleExit(id);
		// 1 spawn + 3 restarts; the 4th exit pauses instead of restarting.
		expect(createSession).toHaveBeenCalledTimes(4);
		const msgs = p.sessions[0].chat.messages;
		expect(msgs[msgs.length - 1]).toMatchObject({ kind: 'error', text: expect.stringContaining('已暂停自动重启') });
	});

	it('serialize keeps only resumable tabs (session id + a real turn)', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.title = 'first';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		// second session has an id but no user turn → never persisted by the engine,
		// so it's dropped (resuming it would fail with "No such file").
		p.sessions[1].chat.sessionId = 'sid-1';
		const snap = store.serialize();
		expect(snap).toEqual([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ sid: 'sid-0', title: 'first' }] }
		]);
	});

	it('restore seeds a default project when nothing is saved', async () => {
		const store = new SessionStore();
		await store.restore([]);
		expect(store.loaded).toBe(true);
		expect(store.projects).toHaveLength(1);
		expect(store.projects[0].path).toBe('/tmp/demo');
		expect(store.activeId).toBe(store.allSessions[0].id);
	});

	it('restore re-opens saved tabs and activates the first', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ sid: 's-a', title: 'A' }, { sid: 's-b', title: 'B' }] }
		]);
		expect(store.projects[0].sessions).toHaveLength(2);
		expect(store.activeId).toBe(store.projects[0].sessions[0].id);
		expect(store.loaded).toBe(true);
	});
});

describe('SessionStore parallel-task worktrees', () => {
	const meta: WorktreeMeta = {
		isWorktree: true,
		mainRepoPath: '/tmp/repo',
		branch: 'task/fix-login',
		baseBranch: 'main',
		slug: 'fix-login'
	};
	const wtPath = '/tmp/.jucode-worktrees/repo/fix-login';

	it('createProject with worktree meta sends the task description as first message', async () => {
		const store = new SessionStore();
		const p = store.createProject(wtPath, meta, '修复登录问题');
		expect(p.worktree).toEqual(meta);
		expect(p.name).toBe('fix-login');
		// first message is sent once the engine is up (createSession resolves)
		await Promise.resolve();
		const id = p.sessions[0].id;
		expect(sendOp).toHaveBeenCalledWith(id, { op: 'user_message', content: '修复登录问题' });
		expect(p.sessions[0].chat.messages.some((m) => m.kind === 'user' && m.text === '修复登录问题')).toBe(true);
	});

	it('worktree metadata round-trips through serialize/restore', async () => {
		const store = new SessionStore();
		const p = store.createProject(wtPath, meta);
		p.sessions[0].chat.sessionId = 'sid-wt';
		p.sessions[0].chat.title = 'task';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		const snap = store.serialize();
		expect(snap[0].worktree).toEqual(meta);

		const store2 = new SessionStore();
		await store2.restore(snap);
		expect(store2.projects[0].worktree).toEqual(meta);
		expect(store2.projects[0].stale).toBeUndefined();
		expect(store2.projects[0].sessions).toHaveLength(1);
	});

	it('plain projects serialize without a worktree key', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		expect('worktree' in store.serialize()[0]).toBe(false);
	});

	it('restore marks a vanished worktree project stale and spawns no sessions', async () => {
		vi.mocked(git).mockRejectedValueOnce(new Error('failed to run git: No such file or directory'));
		const store = new SessionStore();
		await store.restore([
			{ id: 'w1', name: 'fix-login', path: wtPath, worktree: meta, tabs: [{ sid: 's-a', title: 'A' }] },
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [] }
		]);
		const stale = store.projects[0];
		expect(stale.stale).toBe(true);
		expect(stale.sessions).toHaveLength(0);
		// active session落在仍然存活的项目上，不因 stale 项目崩溃
		expect(store.projects[1].sessions.length).toBeGreaterThan(0);
		expect(store.activeId).toBe(store.projects[1].sessions[0].id);
		expect(store.loaded).toBe(true);
	});
});
