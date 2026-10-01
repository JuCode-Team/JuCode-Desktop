import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer so the store's lifecycle is testable in node.
vi.mock('./protocol', () => ({
	hostSession: vi.fn(() => Promise.resolve()),
	acpAgentsList: vi.fn(() => Promise.resolve([{ id: 'gemini', name: 'Gemini', command: 'gemini', args: ['--experimental-acp'], env: {} }])),
	// The daemon names a new session after its desktop id.
	daemon: { sessionOf: vi.fn((id: string) => `conv-${id}`) },
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	sessionMeta: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	chatsDir: vi.fn(() => Promise.resolve('/home/u/.jucode/chats')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve('')),
	sessionHistory: vi.fn(() =>
		Promise.resolve([
			{ session: 's6old', title: 'old chat', updated_at: 1_700_000_000_000, entries: 4, archived: false, agent: null, open: false, engine: 'jucode' },
			{ session: 'claude-old', title: 'claude chat', updated_at: 1_700_000_000_000, entries: 2, archived: false, agent: null, open: false, engine: 'claude' }
		])
	)
}));

import { SessionStore } from './session.svelte';
import { dispatch } from './backends/router';
import { hostSession, closeSession, sendLine, git, writeConfig, sessionHistory } from './protocol';
import type { EngineSpec } from './daemon';
import { setLocale } from './i18n';
import type { Project, WorktreeMeta } from './types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });
/** A new session is a draft; its first message starts the engine. */
const begin = (id: string) => dispatch(id, { op: 'user_message', content: 'hi' });
/** Lets a spawn's promise chain (spec → hostSession → onStart) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The engine spec of the last hostSession call. */
const lastSpec = () => vi.mocked(hostSession).mock.calls.at(-1)![5] as EngineSpec | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	// Pin the locale so user-facing strings are deterministic regardless of the
	// host's navigator.language.
	setLocale('zh');
});

describe('SessionStore lifecycle', () => {
	it('addSession makes a draft active; its first message opens it in the daemon', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(p.sessions.map((s) => s.id)).toEqual([id]);
		expect(store.activeId).toBe(id);
		expect(store.chat).toBe(p.sessions[0].chat);
		expect(p.sessions[0].draft).toBe(true);
		expect(p.sessions[0].chat.booting).toBe(false);
		expect(hostSession).not.toHaveBeenCalled();
		begin(id);
		expect(p.sessions[0].draft).toBe(false);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false, undefined);
		// The daemon named the new session.
		expect(p.sessions[0].chat.sessionId).toBe(`conv-${id}`);
	});

	it('a draft records backend, model and effort, and applies them when it starts', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		await store.switchBackend(id, 'claude');
		expect(hostSession).not.toHaveBeenCalled();
		expect(closeSession).not.toHaveBeenCalled();
		const s = p.sessions[0];
		expect(s.backendId).toBe('claude');
		expect(s.draft).toBe(true);
		expect(p.lastBackend).toBeUndefined();
		s.draftPick = { model: 'opus', effort: 'high' };
		begin(id);
		expect(p.lastBackend).toBe('claude');
		await flush();
		const lines = vi.mocked(sendLine).mock.calls.filter(([sid]) => sid === id).map(([, l]) => l);
		expect(lines).toEqual([
			JSON.stringify({ op: 'command', input: '/model opus high' }),
			JSON.stringify({ op: 'user_message', content: 'hi' })
		]);
	});

	it('ops of every backend go out as jucode lines, approval modes in jucode names', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		begin(id);
		await flush();
		vi.mocked(sendLine).mockClear();
		dispatch(id, { op: 'set_approval_mode', mode: 'read-only' });
		dispatch(id, { op: 'set_approval_mode', mode: 'full-auto' });
		expect(vi.mocked(sendLine).mock.calls).toEqual([
			[id, JSON.stringify({ op: 'set_approval_mode', mode: 'manual' })],
			[id, JSON.stringify({ op: 'set_approval_mode', mode: 'full-access' })]
		]);
	});

	it('the JuCode gateway goes to this session\'s process only, and is kept', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.applyToolProfile(id, 'jucode', 'claude-sonnet-5-5');
		expect(closeSession).toHaveBeenCalledWith(id);
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		// The same conversation reopens, now on the gateway.
		expect(call[2]).toBe(`conv-${id}`);
		expect(call[5]).toEqual({ engine: 'claude', options: { approval_mode: 'read-only', jucode_gateway: true } });
		expect(writeConfig).not.toHaveBeenCalled();
		const tab = store.serialize()[0].tabs![0];
		expect(tab.gateway).toBe(true);
		await store.applyToolProfile(id, 'system');
		expect(lastSpec()?.options?.jucode_gateway).toBe(false);
		expect(store.serialize()[0].tabs![0].gateway).toBeUndefined();
	});

	it('a draft switched to the gateway starts on it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		void store.applyToolProfile(id, 'jucode', 'gpt-5.5');
		expect(hostSession).not.toHaveBeenCalled();
		begin(id);
		await flush();
		expect(lastSpec()).toEqual({ engine: 'codex', options: { approval_mode: 'read-only', jucode_gateway: true } });
	});

	it('removing a draft closes no engine', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		store.removeSession(id);
		expect(closeSession).not.toHaveBeenCalled();
		expect(dispatch(id, { op: 'user_message', content: 'late' })).toBe(true);
		expect(hostSession).not.toHaveBeenCalled();
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

	it('serialize persists the archived flag and restore re-applies it', async () => {
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

		const store2 = new SessionStore();
		await store2.restore(snap);
		expect(store2.projects[0].sessions[0].archived).toBe(true);
	});

	it('a flagged resume failure makes the next claude restart come up fresh', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.sessionId = 'sid-x';
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		s.chat.resumeBroken = true;
		vi.clearAllMocks();
		store.restartSession(id);
		// Opened without a session to reopen, and the one-shot flag is consumed.
		expect(s.chat.sessionId).toBe('');
		expect(s.chat.resumeBroken).toBe(false);
		await flush();
		expect(vi.mocked(hostSession).mock.calls.at(-1)![2]).toBeUndefined();
		// A later restart never goes back to the failed conversation.
		s.chat.engineState = 'exited';
		store.restartSession(id);
		await flush();
		expect(vi.mocked(hostSession).mock.calls.at(-1)![2]).not.toBe('sid-x');
	});

	it('restored jucode tabs keep their saved id before the engine reports one', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p', name: 'p', path: '/tmp/p', tabs: [
				// Files written before every session ran in the daemon still carry `hosted`.
				{ id: 't1', sid: 's6abc86b2069f0d98', title: 'legacy hosted', hosted: true },
				{ id: 't2', sid: 's6abc77400cc77818', title: 'local' }
			] }
		] as never);
		const tabs = store.serialize()[0]?.tabs ?? [];
		expect(tabs.map((t) => t.sid)).toEqual(['s6abc86b2069f0d98', 's6abc77400cc77818']);
		expect(tabs.some((t) => 'hosted' in t)).toBe(false);
	});

	it('history opens as a picker of the daemon\'s jucode conversations without a new session', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		await store.openHistory(p);
		expect(sessionHistory).toHaveBeenCalledWith(p.path);
		expect(p.sessions.length).toBe(1);
		const chat = p.sessions[0]!.chat;
		expect(store.activeId).toBe(id);
		// Other engines' conversations are left out; updated_at is in ms.
		expect(chat.picker).toEqual({
			kind: 'resume',
			backend: 'jucode',
			items: [{ id: 's6old', label: 'old chat', detail: new Date(1_700_000_000_000).toLocaleString(), active: false }]
		});
	});

	it('a picked jucode conversation opens once, reopened by the daemon', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.openSaved(p, 's6old', 'old chat', 'jucode');
		await flush();
		expect(hostSession).toHaveBeenCalledWith(store.activeId, p.path, 's6old', undefined, false, undefined);
		const first = store.activeId;
		store.openSaved(p, 's6old', 'old chat', 'jucode');
		expect(store.activeId).toBe(first);
		expect(p.sessions.length).toBe(1);
		expect(hostSession).toHaveBeenCalledTimes(1);
	});

	it('a message sent while the engine restarts is delivered once it is up', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0]!;
		s.chat.engineState = 'exited';
		store.restartSession(id);
		vi.mocked(sendLine).mockClear();
		expect(dispatch(id, { op: 'user_message', content: 'still there?' })).toBe(true);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('still there?'));
		await flush();
		expect(sendLine).toHaveBeenCalledWith(id, expect.stringContaining('still there?'));
	});

	it('after auto-restart gives up, messages wait for the manual restart', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0]!;
		s.chat.restarts = 3;
		store.handleExit(id);
		vi.mocked(sendLine).mockClear();
		dispatch(id, { op: 'user_message', content: 'later' });
		expect(sendLine).not.toHaveBeenCalled();
		store.restartSession(id, true);
		await flush();
		expect(sendLine).toHaveBeenCalledWith(id, expect.stringContaining('later'));
	});

	it.each(['jucode', 'claude'] as const)(
		'a %s session keeps retrying an unreachable daemon without spending its crash budget',
		async (backend) => {
			vi.useFakeTimers();
			vi.mocked(hostSession).mockRejectedValue(new Error('cannot reach jucode daemon'));
			const store = new SessionStore();
			const p = proj();
			store.projects.push(p);
			begin(store.addSession(p, undefined, backend));
			const s = p.sessions[0]!;
			await vi.advanceTimersByTimeAsync(0);
			expect(s.chat.daemonRetries).toBe(1);
			await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
			expect(vi.mocked(hostSession).mock.calls.length).toBe(4);
			expect(s.chat.restarts).toBe(0);
			expect(s.chat.messages.filter((m) => m.kind === 'error')).toHaveLength(0);
			vi.mocked(hostSession).mockReset();
			vi.mocked(hostSession).mockResolvedValue(undefined);
			vi.useRealTimers();
		}
	);

	it('an engine switch awaiting its config write does not spawn for a closed tab', async () => {
		let release!: () => void;
		vi.mocked(writeConfig).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		const switching = store.switchProvider(id, { id: 'x', base_url: 'u', format: 'openai', models: [{ name: 'm' }] }, 'm');
		store.removeSession(id);
		release();
		await switching;
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
	});

	it('a new claude session is spawned in the desktop approval mode', async () => {
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'jucode-approval-mode' ? 'all' : null),
			setItem: () => {}
		});
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		vi.clearAllMocks();
		begin(store.addSession(p, undefined, 'claude'));
		await flush();
		// Spawned yolo up front: no mid-turn respawn when claude's init reports it.
		expect(lastSpec()).toEqual({ engine: 'claude', options: { approval_mode: 'full-auto' } });
		expect(p.sessions[0].spawnedMode).toBe('bypassPermissions');
		vi.unstubAllGlobals();
	});

	it('switchBackend swaps a virgin session in place (same id, new engine)', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		// Started by a command, so still without a user turn.
		dispatch(id, { op: 'command', input: '/login jucode' });
		await flush();
		expect(p.sessions[0].backendId).toBe('jucode');
		vi.mocked(hostSession).mockClear();
		await store.switchBackend(id, 'claude');
		const s = p.sessions[0];
		expect(s.id).toBe(id); // same tab
		expect(s.backendId).toBe('claude');
		expect(s.chat.backendId).toBe('claude');
		// The daemon translates claude into jucode events.
		expect(s.adapter.id).toBe('jucode');
		expect(p.lastBackend).toBe('claude');
		expect(closeSession).toHaveBeenCalledWith(id);
		// A new claude conversation, not the jucode one reopened.
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		expect(call[2]).toBeUndefined();
		expect(call[5]).toMatchObject({ engine: 'claude' });
		expect(s.chat.sessionId).toBe(`conv-${id}`);
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

	it('switchProvider on a running session closes it and reopens the same conversation', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.switchProvider(id, { id: 'x', base_url: 'u', format: 'openai', models: [{ name: 'm' }] }, 'm');
		expect(closeSession).toHaveBeenCalledWith(id);
		expect(hostSession).toHaveBeenCalledWith(id, p.path, `conv-${id}`, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
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

	it('auto-restart is capped at 3 within the window, then pauses', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		for (let i = 0; i < 4; i++) store.handleExit(id);
		await flush();
		// 1 spawn + 3 restarts; the 4th exit pauses instead of restarting.
		expect(hostSession).toHaveBeenCalledTimes(4);
		const msgs = p.sessions[0].chat.messages;
		expect(msgs.findLast((m) => m.kind === 'error')).toMatchObject({ kind: 'error', text: expect.stringContaining('已暂停自动重启') });
	});

	it('serialize writes every tab with its desktop id; sid once the daemon named the session', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		store.addSession(p);
		store.addSession(p);
		const [a, b, c] = p.sessions;
		a.chat.sessionId = 'sid-0';
		a.chat.title = 'first';
		a.chat.messages.push({ kind: 'user', text: 'hi' });
		// No user turn yet, but the session exists in the daemon from its first
		// moment, so its id is kept.
		b.chat.sessionId = 'sid-1';
		// A draft has no daemon session: an empty window under its desktop id.
		const snap = store.serialize();
		expect(snap).toEqual([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: a.id, sid: 'sid-0', title: 'first' },
					{ id: b.id, sid: 'sid-1', title: 'New session' },
					{ id: c.id, title: 'New session' }
				]
			}
		]);
	});

	it('a restored session serializes its sid even before the replay lands', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		// restore pins chat.sessionId immediately; the transcript replay is async
		// (and may fail), so messages are still empty here.
		const id = store.restoreSession(p, 'sid-r', 'old', 'claude');
		const s = p.sessions[0];
		expect(s.restored).toBe(true);
		expect(s.chat.sessionId).toBe('sid-r');
		expect(s.chat.messages.some((m) => m.kind === 'user')).toBe(false);
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
		// Never started, so it comes back a draft; its start runs the agent's
		// registry command in the daemon.
		expect(s.draft).toBe(true);
		begin(s.id);
		await flush();
		expect(lastSpec()).toEqual({ engine: 'acp', options: { command: 'gemini', args: ['--experimental-acp'], env: {} } });
	});

	it('a restored acp tab with a sid reopens its conversation right away', async () => {
		const agent = { id: 'gemini', name: 'Gemini CLI' };
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ id: 't1', sid: 'acp-1', title: 'A', backend: 'acp', acpAgent: agent }] }
		]);
		const s = store.projects[0].sessions[0];
		expect(s.dormant).toBeUndefined();
		await flush();
		expect(hostSession).toHaveBeenCalledWith('t1', '/tmp/p1', 'acp-1', undefined, false, expect.objectContaining({ engine: 'acp' }));
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
		const [a, b] = store.projects[0].sessions;
		expect([a.id, b.id]).toEqual(['live-a', 'live-b']);
		expect(store.activeId).toBe('live-a');
		// The conversation waits in the daemon until shown; the empty window is a draft.
		expect(a.dormant).toBe(true);
		expect(a.chat.sessionId).toBe('s-a');
		expect(b.draft).toBe(true);
		expect(b.chat.title).toBe('B');
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
		expect(sendLine).not.toHaveBeenCalled();
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

describe('SessionStore claude and codex in the daemon', () => {
	it('claude and codex specs carry the desktop approval mode', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const claude = store.addSession(p, undefined, 'claude');
		begin(claude);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(claude, p.path, undefined, undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
		const codex = store.addSession(p, undefined, 'codex');
		begin(codex);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(codex, p.path, undefined, undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only' }
		});
	});

	it('a restored gateway tab reopens on the gateway', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'codex-1', 'old', 'codex', false, undefined, undefined, undefined, undefined, true);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'codex-1', undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only', jucode_gateway: true }
		});
	});

	it('the yolo respawn reopens the claude conversation in full-auto', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'claude-1', 'old', 'claude');
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.respawnClaudeYolo(id);
		expect(closeSession).toHaveBeenCalledWith(id);
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'claude-1', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'full-auto' }
		});
		expect(p.sessions[0].spawnedMode).toBe('bypassPermissions');
		expect(p.sessions[0].chat.switching).toBe(false);
	});

	it('a claude rewind reopens at the turn, or starts over before the first one', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'claude-1', 'old', 'claude');
		const s = p.sessions[0];
		s.chat.messages.push({ kind: 'user', text: 'one' }, { kind: 'assistant', text: 'a' }, { kind: 'user', text: 'two' });
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.rewindClaudeSession(id, 'uuid-a', 1);
		expect(hostSession).toHaveBeenLastCalledWith(id, p.path, 'claude-1', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only', resume_at: 'uuid-a' }
		});
		expect(s.chat.userTurns).toBe(1);

		await store.rewindClaudeSession(id, null, 0);
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		expect(call[2]).toBeUndefined();
		expect(call[5]).toEqual({ engine: 'claude', options: { approval_mode: 'read-only' } });
		expect(s.chat.sessionId).toBe(`conv-${id}`);
	});

	it('a claude conversation with messages keeps them over the replay when reopened', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0];
		expect(s.chat.keepNextTranscript).toBe(false); // no message before its first start
		s.chat.messages.push({ kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'with tool cards' });
		s.chat.engineState = 'exited';
		store.restartSession(id);
		expect(s.chat.keepNextTranscript).toBe(true);
		await flush();
		const before = s.chat.messages.map((m) => m.kind);
		s.chat.handle({ type: 'transcript', items: [{ role: 'user', content: 'plain replay' }] });
		expect(s.chat.messages.map((m) => m.kind)).toEqual(before);
		expect(s.chat.keepNextTranscript).toBe(false);
		// One-shot: a later transcript replaces the messages.
		s.chat.handle({ type: 'transcript', items: [{ role: 'user', content: 'plain replay' }] });
		expect(s.chat.messages).toEqual([{ kind: 'user', text: 'plain replay' }]);
	});

	it('a jucode conversation takes the daemon replay as is', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		await flush();
		const s = p.sessions[0];
		s.chat.engineState = 'exited';
		store.restartSession(id);
		expect(s.chat.keepNextTranscript).toBe(false);
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
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, chats.path, undefined, undefined, true, undefined);
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
		vi.mocked(hostSession).mockClear();
		await again.restore(saved);
		expect(again.projects[0].chats).toBe(true);
		begin(again.projects[0].sessions[0].id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(expect.any(String), '/home/u/.jucode/chats', undefined, undefined, true, undefined);
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
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
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
		// claude session with an id but no user turn (nothing to resume yet).
		const b = store.addSession(p, undefined, 'claude');
		p.sessions.find((x) => x.id === b)!.chat.sessionId = SID;
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

	it('returnToGui reopens the claude conversation in the daemon', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		await store.openInTui(s.id);
		vi.clearAllMocks();
		await store.returnToGui(s.id);
		expect(s.surface).toBe('gui');
		await flush();
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		expect(call[2]).toBe(SID);
		expect(call[5]).toMatchObject({ engine: 'claude' });
	});

	it('returnToGui reopens a jucode conversation by id, without /resume', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'jucode');
		await store.openInTui(s.id);
		vi.clearAllMocks();
		await store.returnToGui(s.id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(s.id, p.path, SID, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(s.id, expect.stringContaining('/resume'));
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
		expect(s.dormant).toBeUndefined();
		expect(s.chat.sessionId).toBe(SID);
		await flush();
		// The TUI owns the conversation — no GUI engine beside it.
		expect(hostSession).not.toHaveBeenCalled();
		await store.returnToGui('live-a');
		expect(s.surface).toBe('gui');
		await flush();
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		expect(call[2]).toBe(SID);
		expect(call[5]).toMatchObject({ engine: 'claude' });
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
		expect(s.draft).toBe(true);
		begin('live-a');
		await flush();
		expect(hostSession).toHaveBeenCalledWith('live-a', '/tmp/p1', undefined, undefined, false, undefined);
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
		// first message is sent once the daemon opened the session
		await flush();
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

describe('sessions in the jucode daemon', () => {
	it('every backend opens in the daemon; ACP agents from their registry command', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(hostSession).not.toHaveBeenCalled(); // a draft is in no daemon yet
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false, undefined);
		const acp = store.addSession(p, undefined, 'acp', { id: 'gemini', name: 'Gemini' });
		begin(acp);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(acp, p.path, undefined, undefined, false, {
			engine: 'acp',
			options: { command: 'gemini', args: ['--experimental-acp'], env: {} }
		});
	});

	it('claude sessions are named by the daemon and translated by it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0];
		expect(s.chat.sessionId).toBe(`conv-${id}`);
		expect(s.chat.backendId).toBe('claude');
		expect(s.adapter.id).toBe('jucode');

		// A claude conversation picked from history reopens by its id.
		vi.mocked(hostSession).mockClear();
		const picked = store.restoreSession(p, 'conv-2', '', 'claude');
		await flush();
		expect(hostSession).toHaveBeenCalledWith(picked, p.path, 'conv-2', undefined, false, expect.objectContaining({ engine: 'claude' }));
		expect(p.sessions.find((x) => x.id === picked)!.chat.sessionId).toBe('conv-2');
	});

	it('a restart reopens the daemon session instead of sending /resume', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		const s = p.sessions[0];
		await flush();
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		vi.mocked(hostSession).mockClear();
		store.handleExit(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, `conv-${id}`, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
	});

	it('serialize keeps the daemon session and restore lists it until shown', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		begin(store.addSession(p));
		await flush();
		// The daemon named it; no user turn yet.
		const sid = p.sessions[0].chat.sessionId;
		const saved = store.serialize();
		expect(saved[0].tabs?.[0]).toMatchObject({ sid });
		expect('hosted' in saved[0].tabs![0]).toBe(false);

		vi.mocked(hostSession).mockClear();
		const restored = new SessionStore();
		await restored.restore(saved);
		const s = restored.projects[0].sessions[0];
		// Listed, not opened: the daemon keeps it until it is shown.
		expect(s.dormant).toBe(true);
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
		restored.wake(s.id);
		expect(s.dormant).toBe(false);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(s.id, p.path, sid, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(s.id, expect.stringContaining('/resume'));
	});

	it('restore lists claude, codex and jucode tabs with a sid dormant, with or without a legacy hosted flag', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 't-claude', sid: 'claude-1', title: 'C', backend: 'claude' },
					{ id: 't-codex', sid: 'codex-1', title: 'X', backend: 'codex', hosted: true },
					{ id: 't-jucode', sid: 'jucode-1', title: 'J' },
					{ id: 't-old', sid: 'jucode-2', title: 'O', hosted: false }
				]
			}
		] as never);
		const sessions = store.projects[0].sessions;
		expect(sessions.map((s) => [s.id, s.backendId, s.dormant, s.chat.sessionId])).toEqual([
			['t-claude', 'claude', true, 'claude-1'],
			['t-codex', 'codex', true, 'codex-1'],
			['t-jucode', 'jucode', true, 'jucode-1'],
			['t-old', 'jucode', true, 'jucode-2']
		]);
		await flush();
		expect(hostSession).not.toHaveBeenCalled();

		for (const s of sessions) store.wake(s.id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith('t-claude', '/tmp/p1', 'claude-1', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
		expect(hostSession).toHaveBeenCalledWith('t-codex', '/tmp/p1', 'codex-1', undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only' }
		});
		expect(hostSession).toHaveBeenCalledWith('t-jucode', '/tmp/p1', 'jucode-1', undefined, false, undefined);
		expect(hostSession).toHaveBeenCalledWith('t-old', '/tmp/p1', 'jucode-2', undefined, false, undefined);
		// Woken once: a second wake opens nothing.
		vi.mocked(hostSession).mockClear();
		store.wake('t-claude');
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
	});
});

describe('agent sessions', () => {
	it('opens a new session as the agent in a project for its directory', async () => {
		const store = new SessionStore();
		const id = store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' });
		expect(store.projects.map((p) => p.path)).toEqual(['/srv/ops']);
		const s = store.projects[0].sessions[0];
		expect(s.id).toBe(id);
		expect(s.chat.title).toBe('Ops');
		expect(store.activeId).toBe(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, '/srv/ops', undefined, 'ops', false, undefined);
	});

	it("reuses the open tab of the agent's session, or reopens it by id", async () => {
		const store = new SessionStore();
		const p = proj();
		p.path = '/srv/ops';
		store.projects.push(p);
		const first = store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' }, 'daemon-1');
		await flush();
		expect(hostSession).toHaveBeenCalledWith(first, '/srv/ops', 'daemon-1', undefined, false, undefined);
		// The existing project is reused, and the same session is not opened twice.
		expect(store.projects).toHaveLength(1);
		vi.mocked(hostSession).mockClear();
		expect(store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' }, 'daemon-1')).toBe(first);
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
	});
});
