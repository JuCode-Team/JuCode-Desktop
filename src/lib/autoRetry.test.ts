import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./protocol', () => ({
	hostSession: vi.fn(() => Promise.resolve()),
	acpAgentsList: vi.fn(() => Promise.resolve([])),
	daemon: { sessionOf: vi.fn((id: string) => `conv-${id}`) },
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	sessionMeta: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	chatsDir: vi.fn(() => Promise.resolve('/home/u/.jucode/chats')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve('')),
	sessionHistory: vi.fn(() => Promise.resolve([]))
}));

import { SessionStore } from './session.svelte';
import { AUTO_CONTINUE } from './chat.svelte';
import { AutoRetry, retryable } from './autoRetry.svelte';
import { dispatch } from './backends/router';
import { closeSession, sendLine } from './protocol';
import { setLocale } from './i18n';
import type { BackendId } from './backends';

const flush = () => vi.advanceTimersByTimeAsync(1);

async function started(backend: BackendId) {
	const store = new SessionStore();
	const p = { id: 'p1', name: 'p1', path: '/tmp/p1', sessions: [] };
	store.projects.push(p);
	const id = store.addSession(p, undefined, backend);
	const s = store.projects[0].sessions[0];
	s.chat.optimisticUser('fix the bug');
	dispatch(id, { op: 'user_message', content: 'fix the bug' });
	await flush();
	s.chat.handle({ type: 'status', message: 'ready' });
	s.chat.handle({ type: 'user_message', content: 'fix the bug' });
	s.chat.handle({ type: 'connecting' });
	const retry = new AutoRetry();
	retry.store = store;
	vi.mocked(sendLine).mockClear();
	return { store, id, s, chat: s.chat, retry };
}
const sent = (id: string) => vi.mocked(sendLine).mock.calls.filter(([sid]) => sid === id).map(([, line]) => JSON.parse(line));

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	setLocale('zh');
});
afterEach(() => vi.useRealTimers());

describe('auto retry', () => {
	it('retries connection and upstream failures, not limits or credentials', () => {
		expect(retryable('API Error: Connection error.', 'claude')).toBe(true);
		expect(retryable('io error: Software caused connection abort (os error 53)', 'jucode')).toBe(true);
		expect(retryable('stream disconnected before completion: error sending request', 'codex')).toBe(true);
		expect(retryable('LLM API returned HTTP 503: {"error":"no_available_provider"}', 'jucode')).toBe(true);
		expect(retryable('LLM API returned HTTP 429: rate limit', 'jucode')).toBe(false);
		expect(retryable('LLM API returned HTTP 401: invalid api key', 'jucode')).toBe(false);
	});

	it('JuCode picks the failed turn up with no new message, after the wait, at most three times', async () => {
		const { chat, id, retry } = await started('jucode');
		const fail = () => {
			chat.handle({ type: 'connecting' });
			chat.handle({ type: 'error', message: 'io error: connection reset by peer' });
		chat.handle({ type: 'status', message: 'ready' });
			retry.failed(chat, 'io error: connection reset by peer', true);
		};
		fail();
		expect(chat.autoRetry).toMatchObject({ attempt: 1, max: 3 });
		expect(sent(id)).toEqual([]);
		vi.advanceTimersByTime(10_000);
		await flush();
		expect(sent(id)).toEqual([{ op: 'continue' }]);
		expect(chat.messages.some((m) => m.kind === 'error')).toBe(false);
		expect(chat.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
		chat.handle({ type: 'status', message: 'ready' });
		fail();
		expect(chat.autoRetry).toMatchObject({ attempt: 2 });
		retry.now(chat);
		fail();
		retry.now(chat);
		fail();
		expect(chat.autoRetry).toBeNull();
	});

	it('a new message from the user calls the waiting retry off', async () => {
		const { chat, id, retry } = await started('jucode');
		chat.handle({ type: 'error', message: 'API Error: Connection error.' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'API Error: Connection error.', true);
		chat.optimisticUser('something else');
		vi.advanceTimersByTime(60_000);
		await flush();
		expect(sent(id)).toEqual([]);
	});

	it('Codex: a turn that produced nothing is rolled back and its message sent again', async () => {
		const { chat, id, retry } = await started('codex');
		chat.handle({ type: 'error', message: 'stream disconnected before completion' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'stream disconnected before completion', true);
		retry.now(chat);
		await flush();
		expect(sent(id)).toEqual([
			{ op: 'command', input: '/rewind 1' },
			{ op: 'user_message', content: 'fix the bug' }
		]);
		expect(chat.messages.filter((m) => m.kind === 'user').map((m) => m.kind === 'user' && m.text)).toEqual(['fix the bug']);
	});

	it('Codex: a turn that did work is kept and continued, the continue shown as a note', async () => {
		const { chat, id, retry } = await started('codex');
		chat.handle({ type: 'tool_start', call_id: 'c1', name: 'shell' });
		chat.handle({ type: 'tool_output', call_id: 'c1', output: 'ok' });
		chat.handle({ type: 'error', message: 'stream disconnected before completion' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'stream disconnected before completion', true);
		retry.now(chat);
		await flush();
		expect(sent(id)).toEqual([{ op: 'user_message', content: AUTO_CONTINUE }]);
		chat.handle({ type: 'user_message', content: AUTO_CONTINUE });
		expect(chat.messages.filter((m) => m.kind === 'user')).toHaveLength(1);
		// Failing again with nothing new: that "continue" is rolled back and sent again.
		chat.handle({ type: 'connecting' });
		chat.handle({ type: 'error', message: 'stream disconnected before completion' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'stream disconnected before completion', true);
		vi.mocked(sendLine).mockClear();
		retry.now(chat);
		await flush();
		expect(sent(id)).toEqual([
			{ op: 'command', input: '/rewind 1' },
			{ op: 'user_message', content: AUTO_CONTINUE }
		]);
		expect(chat.messages.some((m) => m.kind === 'tool')).toBe(true);
	});

	it('a message sent from elsewhere calls the retry off and is what a later retry resends', async () => {
		const { chat, id, retry } = await started('codex');
		chat.handle({ type: 'tool_start', call_id: 'c1', name: 'shell' });
		chat.handle({ type: 'error', message: 'stream disconnected before completion' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'stream disconnected before completion', true);
		retry.now(chat);
		await flush();
		chat.handle({ type: 'status', message: 'ready' });
		// The phone sends the next message; it fails before any output.
		chat.handle({ type: 'user_message', content: 'from the phone' });
		expect(chat.autoRetry).toBeNull();
		chat.handle({ type: 'connecting' });
		chat.handle({ type: 'error', message: 'stream disconnected before completion' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'stream disconnected before completion', true);
		vi.mocked(sendLine).mockClear();
		retry.now(chat);
		await flush();
		expect(sent(id)).toEqual([
			{ op: 'command', input: '/rewind 1' },
			{ op: 'user_message', content: 'from the phone' }
		]);
	});

	it('Claude Code: a failed "continue" is not undone (a resume could cut a tool result off)', async () => {
		const { chat, id, retry } = await started('claude');
		chat.handle({ type: 'tool_start', call_id: 'c1', name: 'Bash' });
		chat.handle({ type: 'error', message: 'API Error: Connection error.' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'API Error: Connection error.', true);
		retry.now(chat);
		await flush();
		chat.handle({ type: 'connecting' });
		chat.handle({ type: 'error', message: 'API Error: Connection error.' });
		chat.handle({ type: 'status', message: 'ready' });
		retry.failed(chat, 'API Error: Connection error.', true);
		vi.mocked(sendLine).mockClear();
		retry.now(chat);
		await flush();
		expect(closeSession).not.toHaveBeenCalled();
		expect(sent(id)).toEqual([{ op: 'user_message', content: AUTO_CONTINUE }]);
	});
});
