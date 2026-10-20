import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer (same pattern as session.test.ts).
vi.mock('$lib/protocol', () => ({
	hostSession: vi.fn(() => Promise.resolve()),
	acpAgentsList: vi.fn(() => Promise.resolve([{ id: 'gemini', name: 'Gemini', command: 'gemini', args: ['--experimental-acp'], env: {} }])),
	daemon: { sessionOf: vi.fn(() => 'conv-1') },
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve(''))
}));

import { SessionStore } from '$lib/session.svelte';
import { hostSession, sendOp, sendLine } from '$lib/protocol';
import { adapterFor, dispatch } from './router';
import { setLocale } from '$lib/i18n';
import type { Project } from '$lib/types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });
/** A new session is a draft; its first message starts the engine. */
const begin = (id: string) => dispatch(id, { op: 'user_message', content: 'hi' });
/** The engine spec resolves before the daemon is asked. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	setLocale('zh');
});

describe('SessionStore × backends', () => {
	it('every backend runs in the daemon behind the jucode adapter', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(hostSession).not.toHaveBeenCalled();
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, false, undefined, expect.any(String));
		expect(adapterFor(id)?.id).toBe('jucode');
		expect(p.lastBackend).toBe('jucode');
		const cl = store.addSession(p, undefined, 'claude');
		expect(adapterFor(cl)?.id).toBe('jucode');
	});

	it('an explicit backend becomes the engine spec and the project default', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		expect(p.lastBackend).toBeUndefined(); // a draft belongs to no backend yet
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		}, expect.any(String));
		expect(p.lastBackend).toBe('claude');
		// The daemon names the conversation.
		expect(p.sessions[0].chat.sessionId).toBe('conv-1');
		// The next plain addSession inherits the project's last-used backend.
		const id2 = store.addSession(p);
		expect(p.sessions[1].backendId).toBe('claude');
		begin(id2);
		await flush();
		expect(hostSession).toHaveBeenLastCalledWith(id2, p.path, undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		}, expect.any(String));
	});

	it('ops of any backend go out as jucode lines', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p, '你好', 'codex');
		await flush();
		expect(sendOp).not.toHaveBeenCalled();
		const lines = vi.mocked(sendLine).mock.calls.map(([, l]) => JSON.parse(l));
		expect(lines).toContainEqual({ op: 'user_message', content: '你好' });
	});

	it('serialize records the backend only for non-jucode tabs and lastBackend', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		begin(store.addSession(p, undefined, 'jucode'));
		begin(store.addSession(p, undefined, 'codex'));
		for (const [i, s] of p.sessions.entries()) {
			s.chat.sessionId = `sid-${i}`;
			s.chat.title = `t${i}`;
		}
		const snap = store.serialize();
		expect(snap[0].lastBackend).toBe('codex');
		expect(snap[0].tabs).toEqual([
			{ id: p.sessions[0].id, sid: 'sid-0', title: 't0', backend: 'codex' },
			{ id: p.sessions[1].id, sid: 'sid-1', title: 't1' }
		]);
	});

	it('restore maps saved backends (missing / unknown → jucode) and reopens them by id when shown', async () => {
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
		// Listed, not started: each opens when it is first shown.
		expect(sessions.every((s) => s.dormant)).toBe(true);
		expect(hostSession).not.toHaveBeenCalled();
		store.wake(sessions[1].id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(sessions[1].id, '/tmp/p1', 's-b', false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		}, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(sessions[1].id, expect.stringContaining('/resume'));
	});

	it('a crash restart reopens the conversation by id', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		begin(id);
		await flush();
		const s = p.sessions[0];
		s.chat.sessionId = 'thread-1';
		vi.clearAllMocks();
		store.restartSession(id, true);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'thread-1', false, {
			engine: 'codex',
			options: { approval_mode: 'read-only' }
		}, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
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

	it('a built-in ACP agent starts by id: approval mode and gateway, no command', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const agent = { id: 'omp', name: 'oh-my-pi', preset: true };
		const id = store.addSession(p, undefined, 'acp', agent);
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, false, {
			engine: 'acp',
			options: { agent: 'omp', approval_mode: 'read-only' }
		}, expect.any(String));
		expect(p.lastAcpAgent).toEqual(agent);
		// An agent with a gateway mode switches like Claude Code / Codex.
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.agentGateway = true;
		await store.applyToolProfile(id, 'jucode');
		expect(hostSession).toHaveBeenLastCalledWith(id, p.path, 'conv-1', false, {
			engine: 'acp',
			options: { agent: 'omp', approval_mode: 'read-only', jucode_gateway: true }
		}, undefined);
	});

	it('an ACP agent without a gateway mode keeps its process on a profile switch', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'acp', { id: 'opencode', name: 'OpenCode', preset: true });
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.applyToolProfile(id, 'jucode');
		expect(hostSession).not.toHaveBeenCalled();
	});

	it('a custom ACP agent still runs its registry command', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'acp', { id: 'gemini', name: 'Gemini' });
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, false, {
			engine: 'acp',
			options: { command: 'gemini', args: ['--experimental-acp'], env: {} }
		}, expect.any(String));
	});

	it('a restored ACP tab keeps its built-in agent', async () => {
		const agent = { id: 'pi', name: 'Pi', preset: true };
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				lastBackend: 'acp',
				lastAcpAgent: agent,
				tabs: [{ id: 't1', sid: 'acp-1', title: 'A', backend: 'acp', acpAgent: agent }]
			}
		]);
		const s = store.projects[0].sessions[0];
		expect(s.acpAgent).toEqual(agent);
		expect(store.projects[0].lastAcpAgent).toEqual(agent);
		await flush();
		expect(hostSession).toHaveBeenCalledWith('t1', '/tmp/p1', 'acp-1', false, {
			engine: 'acp',
			options: { agent: 'pi', approval_mode: 'read-only' }
		}, undefined);
		expect(store.serialize()[0]).toMatchObject({ lastAcpAgent: agent, tabs: [{ acpAgent: agent }] });
	});
});
