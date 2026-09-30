import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer so the store's lifecycle is testable in node.
vi.mock('./protocol', () => ({
	createSession: vi.fn(() => Promise.resolve()),
	hostSession: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	chatsDir: vi.fn(() => Promise.resolve('/home/u/.jucode/chats')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve('')),
	claudeSessionTranscript: vi.fn(() => Promise.resolve([])),
	jucodeSessions: vi.fn(() => Promise.resolve([{ id: 's6old', label: 'old chat', updated_at: 1, entries: 4 }]))
}));

import { SessionStore } from './session.svelte';
import { dispatch } from './backends/router';
import { createSession, hostSession, closeSession, sendOp, sendLine, git, writeConfig } from './protocol';
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
		const id = store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.title = 'kept';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		store.archiveSession(id);
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([{ id, sid: 'sid-0', title: 'kept', archived: true }]);
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
		// A second restart before the fresh engine reports its id must not go
		// back to the failed one.
		s.chat.engineState = 'exited';
		store.restartSession(id);
		const again = (createSession as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
		expect((again?.[3] as { resume?: string } | undefined)?.resume).toBeUndefined();
	});

	it('restored jucode tabs keep their saved id before the engine reports one', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p', name: 'p', path: '/tmp/p', tabs: [
				{ id: 't1', sid: 's6abc86b2069f0d98', title: 'hosted', hosted: true },
				{ id: 't2', sid: 's6abc77400cc77818', title: 'local' }
			] }
		] as never);
		const tabs = store.serialize()[0]?.tabs ?? [];
		expect(tabs.map((t) => t.sid)).toEqual(['s6abc86b2069f0d98', 's6abc77400cc77818']);
	});

	it('history opens as a picker in the project chat without a new session', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		await store.openHistory(p);
		expect(p.sessions.length).toBe(1);
		const chat = p.sessions[0]!.chat;
		expect(store.activeId).toBe(id);
		expect(chat.picker).toMatchObject({ kind: 'resume', backend: 'jucode', items: [{ id: 's6old', label: 'old chat' }] });
	});

	it('a picked jucode conversation opens once, through the daemon when hosting', () => {
		vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ daemon: true }), setItem: () => {} });
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.openSaved(p, 's6old', 'old chat', 'jucode');
		expect(hostSession).toHaveBeenCalledWith(store.activeId, p.path, 's6old', undefined, false);
		const first = store.activeId;
		store.openSaved(p, 's6old', 'old chat', 'jucode');
		expect(store.activeId).toBe(first);
		expect(p.sessions.length).toBe(1);
		vi.unstubAllGlobals();
	});

	it('a message sent while the engine restarts is delivered once it is up', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		await Promise.resolve();
		await Promise.resolve();
		const s = p.sessions[0]!;
		s.chat.engineState = 'exited';
		store.restartSession(id);
		vi.mocked(sendLine).mockClear();
		expect(dispatch(id, { op: 'user_message', content: 'still there?' })).toBe(true);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('still there?'));
		await Promise.resolve();
		await Promise.resolve();
		expect(sendLine).toHaveBeenCalledWith(id, expect.stringContaining('still there?'));
	});

	it('after auto-restart gives up, messages wait for the manual restart', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		await Promise.resolve();
		await Promise.resolve();
		const s = p.sessions[0]!;
		s.chat.restarts = 3;
		store.handleExit(id);
		vi.mocked(sendLine).mockClear();
		dispatch(id, { op: 'user_message', content: 'later' });
		expect(sendLine).not.toHaveBeenCalled();
		store.restartSession(id, true);
		await Promise.resolve();
		await Promise.resolve();
		expect(sendLine).toHaveBeenCalledWith(id, expect.stringContaining('later'));
	});

	it('a hosted tab keeps retrying an unreachable daemon without spending its crash budget', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ daemon: true }), setItem: () => {} });
		vi.mocked(hostSession).mockRejectedValue(new Error('cannot reach jucode daemon'));
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		const s = p.sessions[0]!;
		await vi.advanceTimersByTimeAsync(0);
		expect(s.chat.daemonRetries).toBe(1);
		await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
		expect(vi.mocked(hostSession).mock.calls.length).toBe(4);
		expect(s.chat.restarts).toBe(0);
		expect(s.chat.messages.filter((m) => m.kind === 'error')).toHaveLength(0);
		vi.mocked(hostSession).mockReset();
		vi.mocked(hostSession).mockResolvedValue(undefined);
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('an engine switch awaiting its config write does not spawn for a closed tab', async () => {
		let release!: () => void;
		vi.mocked(writeConfig).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		await Promise.resolve();
		vi.mocked(createSession).mockClear();
		const switching = store.switchProvider(id, { id: 'x', base_url: 'u', format: 'openai', models: [{ name: 'm' }] }, 'm');
		store.removeSession(id);
		release();
		await switching;
		expect(createSession).not.toHaveBeenCalled();
	});

	it('a new claude session is spawned in the desktop approval mode', () => {
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'jucode-approval-mode' ? 'all' : null),
			setItem: () => {}
		});
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		vi.clearAllMocks();
		store.addSession(p, undefined, 'claude');
		// Spawned yolo up front: no mid-turn respawn when claude's init reports it.
		const call = (createSession as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
		expect((call?.[3] as { permission_mode?: string }).permission_mode).toBe('bypassPermissions');
		vi.unstubAllGlobals();
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

	it('switchProvider honors a valid effort override and falls back otherwise', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		const provider = {
			id: 'byo',
			base_url: 'https://api.example.com',
			format: 'openai',
			models: [{ name: 'm1', reasoning_efforts: ['low', 'high'] }]
		};
		// A chip pick carries an explicit effort — written verbatim when valid.
		await store.switchProvider(id, provider, 'm1', 'high');
		expect(writeConfig).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'byo', model: 'm1', reasoning_effort: 'high' })
		);
		// An unknown effort falls back to the default (no medium → first listed).
		await store.switchProvider(id, provider, 'm1', 'bogus');
		expect(writeConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({ reasoning_effort: 'low' })
		);
		// No effort argument keeps the medium-first default.
		await store.switchProvider(
			id,
			{ ...provider, models: [{ name: 'm1', reasoning_efforts: ['low', 'medium', 'high'] }] },
			'm1'
		);
		expect(writeConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({ reasoning_effort: 'medium' })
		);
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

	it('serialize writes every tab with its desktop id; sid only when resumable', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		store.addSession(p);
		const [a, b] = p.sessions;
		a.chat.sessionId = 'sid-0';
		a.chat.title = 'first';
		a.chat.messages.push({ kind: 'user', text: 'hi' });
		// second session has an engine id but no user turn → never persisted by
		// the engine, so no sid is written (resuming it would fail); the tab
		// still survives as an empty window under its desktop id.
		b.chat.sessionId = 'sid-1';
		const snap = store.serialize();
		expect(snap).toEqual([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: a.id, sid: 'sid-0', title: 'first' },
					{ id: b.id, title: 'New session' }
				]
			}
		]);
	});

	it('a restored session serializes its sid even before the replay lands', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		// claude restore pins chat.sessionId immediately; the transcript replay is
		// async (and may fail), so messages are still empty here.
		const id = store.restoreSession(p, 'sid-r', 'old', 'claude');
		const s = p.sessions[0];
		expect(s.restored).toBe(true);
		expect(s.chat.sessionId).toBe('sid-r');
		expect(s.chat.messages.some((m) => m.kind === 'user')).toBe(false);
		expect(s.chat.resumable).toBe(false);
		const tab = store.serialize()[0].tabs![0];
		expect(tab).toEqual({ id, sid: 'sid-r', title: 'old', backend: 'claude' });
	});

	it('serialize includes the acp agent and restore reapplies it on the session', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const agent = { id: 'gemini', name: 'Gemini CLI' };
		const id = store.addSession(p, undefined, 'acp', agent);
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([{ id, title: 'New session', backend: 'acp', acpAgent: agent }]);

		const store2 = new SessionStore();
		await store2.restore(snap);
		const s = store2.projects[0].sessions[0];
		expect(s.backendId).toBe('acp');
		expect(s.acpAgent).toEqual(agent);
		expect(s.chat.acpAgentId).toBe('gemini');
		expect(s.chat.acpAgentName).toBe('Gemini CLI');
		// The spawn carried the agent option so create_session can look it up.
		const call = (createSession as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
		expect(call[2]).toBe('acp');
		expect((call[3] as { agent?: string }).agent).toBe('gemini');
	});

	it('acp tabs without a saved agent fall back to the project lastAcpAgent', async () => {
		const agent = { id: 'g', name: 'G' };
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				lastBackend: 'acp',
				lastAcpAgent: agent,
				tabs: [{ id: 't1', title: 'A', backend: 'acp' }]
			}
		]);
		expect(store.projects[0].sessions[0].acpAgent).toEqual(agent);
		expect(store.projects[0].sessions[0].backendId).toBe('acp');
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

	it('restore reuses persisted desktop ids so a saved chat split still matches', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 'live-a', sid: 's-a', title: 'A' },
					{ id: 'live-b', title: 'B' } // empty window — nothing to resume
				]
			}
		]);
		expect(store.projects[0].sessions.map((s) => s.id)).toEqual(['live-a', 'live-b']);
		expect(store.activeId).toBe('live-a');
		await Promise.resolve(); // let the spawn continuations run
		// The resumable tab resumes; the empty one spawns fresh with no /resume.
		expect(sendLine).toHaveBeenCalledWith('live-a', JSON.stringify({ op: 'command', input: '/resume s-a' }));
		expect(sendLine).not.toHaveBeenCalledWith('live-b', expect.anything());
		expect(store.projects[0].sessions[1].chat.title).toBe('B');
	});

	it('restore mints a fresh id when the persisted one is already live', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 'dup', sid: 's-a', title: 'A' },
					{ id: 'dup', sid: 's-b', title: 'B' }
				]
			}
		]);
		const ids = store.projects[0].sessions.map((s) => s.id);
		expect(ids[0]).toBe('dup');
		expect(ids[1]).not.toBe('dup');
	});

	it('serialize includes tab chrome only when set, and restore re-applies it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		store.renameSession(id, ' Release train ');
		store.setSessionChrome(id, { color: '#DB2777', icon: { kind: 'slug', value: '🚀' } });
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([
			{
				id,
				sid: 'sid-0',
				title: 'Release train',
				color: '#db2777',
				icon: { kind: 'slug', value: '🚀' },
				titleLocked: true
			}
		]);

		const store2 = new SessionStore();
		await store2.restore(snap);
		const s = store2.projects[0].sessions[0];
		expect(s.color).toBe('#db2777');
		expect(s.icon).toEqual({ kind: 'slug', value: '🚀' });
		expect(s.chat.titleLocked).toBe(true);
		expect(s.chat.title).toBe('Release train');
	});

	it('setSessionChrome null clears and invalid values are dropped', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		store.setSessionChrome(id, { color: '#abc', icon: { kind: 'builtin', id: 'star' } });
		expect(p.sessions[0].color).toBe('#abc');
		store.setSessionChrome(id, { color: null, icon: { kind: 'builtin', id: 'bogus' } });
		expect(p.sessions[0].color).toBeUndefined();
		expect(p.sessions[0].icon).toBeUndefined();
		// chrome never set → serialize omits the keys entirely
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		const tab = store.serialize()[0].tabs![0];
		expect('color' in tab).toBe(false);
		expect('icon' in tab).toBe(false);
		expect('titleLocked' in tab).toBe(false);
	});
});

describe('SessionStore chats', () => {
	it('newChat creates the chats group first and spawns a chat session', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const id = await store.newChat();
		const chats = store.projects[0];
		expect(chats.chats).toBe(true);
		expect(chats.path).toBe('/home/u/.jucode/chats');
		expect(chats.sessions.map((s) => s.id)).toEqual([id]);
		expect(createSession).toHaveBeenCalledWith(id, chats.path, 'jucode', expect.objectContaining({ chat: true }));
		// A second chat joins the same group.
		await store.newChat();
		expect(store.projects.filter((p) => p.chats)).toHaveLength(1);
		expect(store.projects[0].sessions).toHaveLength(2);
	});

	it('chat sessions use the jucode engine and survive serialize/restore as chats', async () => {
		const store = new SessionStore();
		await store.newChat();
		const saved = store.serialize();
		expect(saved[0].chats).toBe(true);
		const again = new SessionStore();
		vi.mocked(createSession).mockClear();
		await again.restore(saved);
		expect(again.projects[0].chats).toBe(true);
		expect(createSession).toHaveBeenCalledWith(expect.any(String), '/home/u/.jucode/chats', 'jucode', expect.objectContaining({ chat: true }));
	});
});

describe('SessionStore GUI ⇄ TUI handoff', () => {
	const SID = '0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f';

	/** A session whose engine conversation is resumable (sid + one user turn). */
	function readySession(store: SessionStore, p: Project, backend: 'jucode' | 'claude' | 'codex') {
		const id = store.addSession(p, undefined, backend);
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.sessionId = SID;
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		return s;
	}

	it('openInTui closes the GUI engine before flipping the surface', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		let surfaceAtClose: string | undefined = 'not-called';
		vi.mocked(closeSession).mockImplementationOnce(async () => {
			surfaceAtClose = s.surface;
		});
		await store.openInTui(s.id);
		expect(closeSession).toHaveBeenCalledWith(s.id);
		expect(surfaceAtClose).toBeUndefined(); // still on the GUI when the engine died
		expect(s.surface).toBe('tui');
		// Once the TUI owns the conversation the flag must not stay latched —
		// handleExit's `surface === 'tui'` branch already suppresses auto-restart.
		expect(s.chat.switching).toBe(false);
	});

	it('openInTui serializes concurrent requests behind the GUI close', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		let releaseClose!: () => void;
		vi.mocked(closeSession).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseClose = resolve;
				})
		);

		const first = store.openInTui(s.id);
		const second = store.openInTui(s.id);
		expect(closeSession).toHaveBeenCalledTimes(1);
		expect(s.surface).toBeUndefined();

		releaseClose();
		await Promise.all([first, second]);
		expect(s.surface).toBe('tui');
	});

	it('openInTui keeps GUI ownership when its engine cannot be closed', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		vi.mocked(closeSession).mockRejectedValueOnce(new Error('close failed'));

		await store.openInTui(s.id);
		expect(s.surface).toBeUndefined();
		expect(s.chat.switching).toBe(false);
	});

	it('an intentional GUI exit cannot auto-restart underneath the TUI', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		await store.openInTui(s.id);
		vi.clearAllMocks();

		store.handleExit(s.id);
		store.restartSession(s.id, true);
		expect(createSession).not.toHaveBeenCalled();
		expect(s.surface).toBe('tui');
		expect(s.chat.switching).toBe(false);
	});

	it('openInTui on an already-exited engine does not latch switching', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		// The GUI engine already exited (e.g. crash budget exhausted): the close
		// is a no-op and no exit event will ever arrive to clear `switching`.
		s.chat.engineState = 'exited';

		await store.openInTui(s.id);
		expect(s.surface).toBe('tui');
		expect(s.chat.switching).toBe(false);

		await store.returnToGui(s.id);
		expect(s.surface).toBe('gui');
		expect(s.chat.switching).toBe(false);

		// The switching guard must not reject a later handoff.
		vi.clearAllMocks();
		await store.openInTui(s.id);
		expect(closeSession).toHaveBeenCalledWith(s.id);
		expect(s.surface).toBe('tui');
		expect(s.chat.switching).toBe(false);
	});

	it('openInTui refuses acp sessions', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'acp', { id: 'gemini', name: 'Gemini CLI' });
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.sessionId = SID;
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		vi.clearAllMocks();
		await store.openInTui(id);
		expect(closeSession).not.toHaveBeenCalled();
		expect(s.surface).toBeUndefined();
	});

	it('openInTui without a usable engine session id is a no-op', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		// jucode session with no engine session id at all.
		const a = store.addSession(p, undefined, 'jucode');
		// claude session with a pinned id but no user turn (never persisted).
		const b = store.addSession(p, undefined, 'claude');
		// resumable, but the id would fail the rust validator.
		const c = store.addSession(p, undefined, 'jucode');
		const sc = p.sessions.find((x) => x.id === c)!;
		sc.chat.sessionId = 'a b';
		sc.chat.messages.push({ kind: 'user', text: 'hi' });
		vi.clearAllMocks();
		for (const id of [a, b, c]) await store.openInTui(id);
		expect(closeSession).not.toHaveBeenCalled();
		for (const s of p.sessions) expect(s.surface).toBeUndefined();
	});

	it('returnToGui respawns the engine resuming the conversation', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		await store.openInTui(s.id);
		vi.clearAllMocks();
		await store.returnToGui(s.id);
		expect(s.surface).toBe('gui');
		const call = vi.mocked(createSession).mock.calls.at(-1)!;
		expect(call[2]).toBe('claude');
		expect((call[3] as { resume?: string }).resume).toBe(SID);
	});

	it('returnToGui resumes a jucode conversation via /resume', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'jucode');
		await store.openInTui(s.id);
		vi.clearAllMocks();
		await store.returnToGui(s.id);
		await Promise.resolve(); // let the spawn continuation run
		expect(createSession).toHaveBeenCalled();
		expect(sendLine).toHaveBeenCalledWith(s.id, JSON.stringify({ op: 'command', input: `/resume ${SID}` }));
	});

	it('serialize writes surface only for tui tabs', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const tui = readySession(store, p, 'claude');
		const gui = readySession(store, p, 'jucode');
		await store.openInTui(tui.id);
		const tabs = store.serialize()[0].tabs!;
		expect(tabs.find((t) => t.id === tui.id)?.surface).toBe('tui');
		expect('surface' in tabs.find((t) => t.id === gui.id)!).toBe(false);
	});

	it('a restored tui tab spawns no engine until returnToGui resumes it', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [{ id: 'live-a', sid: SID, title: 'A', backend: 'claude', surface: 'tui' }]
			}
		]);
		const s = store.projects[0].sessions[0];
		expect(s.surface).toBe('tui');
		expect(s.chat.sessionId).toBe(SID);
		// The TUI owns the conversation — no GUI engine beside it.
		expect(createSession).not.toHaveBeenCalled();
		await store.returnToGui('live-a');
		expect(s.surface).toBe('gui');
		const call = vi.mocked(createSession).mock.calls.at(-1)!;
		expect(call[2]).toBe('claude');
		expect((call[3] as { resume?: string }).resume).toBe(SID);
	});

	it('an invalid persisted sid never restores a TUI owner', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [{ id: 'live-a', sid: 'a b', title: 'A', surface: 'tui' }]
			}
		]);
		const s = store.projects[0].sessions[0];
		expect(s.surface).toBeUndefined();
		expect(s.restored).toBeUndefined();
		expect(sendLine).not.toHaveBeenCalledWith('live-a', expect.stringContaining('/resume'));
		expect(createSession).toHaveBeenCalledWith('live-a', '/tmp/p1');
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
		expect(sendLine).toHaveBeenCalledWith(id, JSON.stringify({ op: 'user_message', content: '修复登录问题' }));
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

describe('sessions hosted by jucode daemon', () => {
	const withDaemonSetting = (on: boolean) =>
		vi.stubGlobal('localStorage', {
			getItem: () => JSON.stringify({ daemon: on }),
			setItem: () => {}
		});
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('new jucode sessions are hosted when the setting is on', async () => {
		withDaemonSetting(true);
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(p.sessions[0].hosted).toBe(true);
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false);
		expect(createSession).not.toHaveBeenCalled();
		// Other engines never go through the daemon.
		store.addSession(p, undefined, 'codex');
		expect(p.sessions[1].hosted).toBe(false);
		vi.unstubAllGlobals();
	});

	it('a restart reopens the daemon session instead of sending /resume', async () => {
		withDaemonSetting(true);
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		const s = p.sessions[0];
		s.chat.sessionId = 'daemon-sess';
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		await flush();
		vi.mocked(hostSession).mockClear();
		store.handleExit(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'daemon-sess', undefined, false);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
		vi.unstubAllGlobals();
	});

	it('serialize keeps the daemon session and restore reopens it hosted', async () => {
		withDaemonSetting(true);
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		// The engine reported its id; no user turn yet.
		p.sessions[0].chat.sessionId = 'daemon-sess';
		const saved = store.serialize();
		expect(saved[0].tabs?.[0]).toMatchObject({ sid: 'daemon-sess', hosted: true });

		withDaemonSetting(false);
		vi.mocked(hostSession).mockClear();
		const restored = new SessionStore();
		await restored.restore(saved);
		const s = restored.projects[0].sessions[0];
		expect(s.hosted).toBe(true);
		expect(hostSession).toHaveBeenCalledWith(s.id, p.path, 'daemon-sess', undefined, false);
		expect(sendLine).not.toHaveBeenCalledWith(s.id, expect.stringContaining('/resume'));
		vi.unstubAllGlobals();
	});
});

describe('agent sessions', () => {
	it('opens a new session as the agent in a project for its directory', async () => {
		const store = new SessionStore();
		const id = store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' });
		expect(store.projects.map((p) => p.path)).toEqual(['/srv/ops']);
		const s = store.projects[0].sessions[0];
		expect(s.id).toBe(id);
		expect(s.hosted).toBe(true);
		expect(s.chat.title).toBe('Ops');
		expect(store.activeId).toBe(id);
		expect(hostSession).toHaveBeenCalledWith(id, '/srv/ops', undefined, 'ops', false);
	});

	it("reuses the open tab of the agent's session, or reopens it by id", async () => {
		const store = new SessionStore();
		const p = proj();
		p.path = '/srv/ops';
		store.projects.push(p);
		const first = store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' }, 'daemon-1');
		expect(hostSession).toHaveBeenCalledWith(first, '/srv/ops', 'daemon-1', undefined, false);
		// The existing project is reused, and the same session is not opened twice.
		expect(store.projects).toHaveLength(1);
		vi.mocked(hostSession).mockClear();
		expect(store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' }, 'daemon-1')).toBe(first);
		expect(hostSession).not.toHaveBeenCalled();
	});
});
