import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer (same pattern as session.test.ts).
vi.mock('$lib/protocol', () => ({
	createSession: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve('')),
	claudeSessionTranscript: vi.fn(() => Promise.resolve([]))
}));

import { SessionStore } from '$lib/session.svelte';
import { createSession, sendOp, sendLine, claudeSessionTranscript } from '$lib/protocol';
import { adapterFor } from './router';
import { setLocale } from '$lib/i18n';
import type { Project } from '$lib/types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });

beforeEach(() => {
	vi.clearAllMocks();
	setLocale('zh');
});

describe('SessionStore × backends', () => {
	it('default sessions stay pure jucode: two-arg createSession, jucode adapter', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(createSession).toHaveBeenCalledWith(id, p.path);
		expect(p.sessions[0].backendId).toBe('jucode');
		expect(p.sessions[0].chat.backendId).toBe('jucode');
		expect(adapterFor(id)?.id).toBe('jucode');
		expect(p.lastBackend).toBe('jucode');
	});

	it('explicit backend flows through createSession and becomes the project default', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		// claude sessions pin a --session-id (uuid) so the conversation is resumable.
		expect(createSession).toHaveBeenCalledWith(id, p.path, 'claude', { session_id: expect.any(String) });
		expect(p.sessions[0].backendId).toBe('claude');
		expect(adapterFor(id)?.id).toBe('claude');
		expect(p.lastBackend).toBe('claude');
		// The next plain addSession inherits the project's last-used backend.
		const id2 = store.addSession(p);
		expect(p.sessions[1].backendId).toBe('claude');
		expect(createSession).toHaveBeenCalledWith(id2, p.path, 'claude', { session_id: expect.any(String) });
	});

	it('non-jucode ops route through the adapter as raw lines', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		// A claude session with a first message: onStart pushes the approval mode
		// and prefetches the model catalog, then the message goes out as a
		// stream-json user frame — never send_op.
		store.addSession(p, '你好', 'claude');
		await Promise.resolve();
		expect(sendOp).not.toHaveBeenCalled();
		const lines = vi.mocked(sendLine).mock.calls.map(([, l]) => JSON.parse(l));
		expect(lines[0]).toMatchObject({ type: 'control_request', request: { subtype: 'set_permission_mode' } });
		expect(lines[1]).toMatchObject({ type: 'control_request', request: { subtype: 'list_models' } });
		expect(lines[2]).toEqual({
			type: 'user',
			message: { role: 'user', content: [{ type: 'text', text: '你好' }] }
		});
		// The optimistic echo still renders.
		expect(p.sessions[0].chat.messages.some((m) => m.kind === 'user' && m.text === '你好')).toBe(true);
	});

	it('serialize records the backend only for non-jucode tabs and lastBackend', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p, undefined, 'jucode');
		store.addSession(p, undefined, 'codex');
		for (const [i, s] of p.sessions.entries()) {
			s.chat.sessionId = `sid-${i}`;
			s.chat.title = `t${i}`;
			s.chat.messages.push({ kind: 'user', text: 'hi' });
		}
		const snap = store.serialize();
		expect(snap[0].lastBackend).toBe('codex');
		expect(snap[0].tabs).toEqual([
			{ sid: 'sid-0', title: 't0' },
			{ sid: 'sid-1', title: 't1', backend: 'codex' }
		]);
	});

	it('restore maps saved backends (missing / unknown → jucode)', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				lastBackend: 'claude',
				tabs: [
					{ sid: 's-a', title: 'A' }, // pre-multi-backend tab
					{ sid: 's-b', title: 'B', backend: 'claude' },
					{ sid: 's-c', title: 'C', backend: 'not-a-backend' }
				]
			}
		]);
		const sessions = store.projects[0].sessions;
		expect(sessions.map((s) => s.backendId)).toEqual(['jucode', 'claude', 'jucode']);
		expect(store.projects[0].lastBackend).toBe('claude');
		// jucode tabs resume via /resume; claude tabs resume via the allowlisted
		// --resume spawn option instead of a command.
		expect(sendOp).toHaveBeenCalledWith(sessions[0].id, { op: 'command', input: '/resume s-a' });
		expect(sendOp).not.toHaveBeenCalledWith(sessions[1].id, expect.anything());
		expect(createSession).toHaveBeenCalledWith(sessions[1].id, '/tmp/p1', 'claude', { resume: 's-b' });
		expect(sessions[1].chat.sessionId).toBe('s-b');
		// The transcript is replayed from the session file (best-effort).
		expect(claudeSessionTranscript).toHaveBeenCalledWith('/tmp/p1', 's-b');
	});

	it('claude restores replay the persisted transcript into the message list', async () => {
		vi.mocked(claudeSessionTranscript).mockResolvedValueOnce([
			{ role: 'user', content: 'earlier question' },
			{ role: 'assistant', content: 'earlier answer' }
		]);
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ sid: 's-b', title: '', backend: 'claude' }] }
		]);
		await Promise.resolve(); // flush the transcript promise
		const s = store.projects[0].sessions[0];
		expect(s.chat.messages).toEqual([
			{ kind: 'user', text: 'earlier question' },
			{ kind: 'assistant', text: 'earlier answer' }
		]);
		// The transcript seeds the tab title too (ChatState transcript handler).
		expect(s.chat.title).toBe('earlier question');
	});

	it('claude transcript replay failures are silent (context is engine-side)', async () => {
		vi.mocked(claudeSessionTranscript).mockRejectedValueOnce(new Error('no such file'));
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ sid: 's-x', title: 'T', backend: 'claude' }] }
		]);
		await Promise.resolve();
		await Promise.resolve();
		const s = store.projects[0].sessions[0];
		expect(s.chat.messages.filter((m) => m.kind === 'error')).toEqual([]);
		expect(s.chat.title).toBe('T');
	});

	it('codex tabs restore via the thread/resume RPC (SessionCtx.resume), not argv', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ sid: 'thread-9', title: 'T', backend: 'codex' }] }
		]);
		const s = store.projects[0].sessions[0];
		// No resume anything in backend_opts (codex allowlist stays {bin_override?})…
		expect(createSession).toHaveBeenCalledWith(s.id, '/tmp/p1', 'codex', {});
		expect(sendOp).not.toHaveBeenCalled();
		expect(s.chat.sessionId).toBe('thread-9');
		// …instead the adapter answers the initialize ack with thread/resume.
		adapterFor(s.id)!.translate({ id: 1, result: { userAgent: 'x' } });
		const lines = vi.mocked(sendLine).mock.calls.filter(([sid]) => sid === s.id).map(([, l]) => JSON.parse(l));
		expect(lines.find((l) => l.method === 'thread/resume')?.params).toMatchObject({
			threadId: 'thread-9',
			cwd: '/tmp/p1'
		});
	});

	it('codex crash restarts resume the conversation thread in the new child', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		await Promise.resolve();
		const s = p.sessions[0];
		s.chat.sessionId = 'thread-1';
		s.chat.messages.push({ kind: 'user', text: 'hi' }); // resumable
		vi.clearAllMocks();
		store.restartSession(id, true);
		await Promise.resolve();
		expect(sendOp).not.toHaveBeenCalled(); // no /resume command for codex
		adapterFor(id)!.translate({ id: 1, result: { userAgent: 'x' } });
		const lines = vi.mocked(sendLine).mock.calls.map(([, l]) => JSON.parse(l));
		expect(lines.find((l) => l.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thread-1' });
	});

	it('removeSession unregisters the adapter', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		expect(adapterFor(id)).toBeDefined();
		store.removeSession(id);
		expect(adapterFor(id)).toBeUndefined();
	});
});
