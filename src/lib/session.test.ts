import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer so the store's lifecycle is testable in node.
vi.mock('./protocol', () => ({
	createSession: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo'))
}));

import { SessionStore } from './session.svelte';
import { createSession } from './protocol';
import type { Project } from './types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });

beforeEach(() => vi.clearAllMocks());

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

	it('serialize keeps only tabs that have an engine session id', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.title = 'first';
		// second session has no sessionId yet → dropped
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
