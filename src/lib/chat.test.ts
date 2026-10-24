import { describe, it, expect, vi } from 'vitest';
import { ChatState } from './chat.svelte';
import { setLocale } from './i18n';

const userTexts = (c: ChatState) =>
	c.messages.filter((m) => m.kind === 'user').map((m) => (m.kind === 'user' ? m.text : ''));

describe('ChatState.handle', () => {
	it('gives the last user turn with its files, for a retry to send them again', () => {
		const c = new ChatState();
		c.optimisticUser('fix it', undefined, false, ['/tmp/a.pdf']);
		expect(c.lastUserTurn()).toEqual({ index: 0, text: 'fix it', files: ['/tmp/a.pdf'] });
	});

	it('keeps timing a running turn it comes back to (switching workspaces)', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(1_000_000);
			const c = new ChatState();
			c.handle({ type: 'user_message', content: 'go' });
			c.handle({ type: 'connecting' });
			const started = c.turnStartedAt;
			const call = c.call;
			expect(call?.since).toBe(1_000_000);
			// Away for a while, then back: the snapshot replays and says it runs.
			vi.setSystemTime(1_030_000);
			c.rejoining = true;
			c.handle({ type: 'transcript', items: [{ role: 'user', content: 'go' }] });
			c.handle({ type: 'connecting' });
			expect(c.turnStartedAt).toBe(started);
			expect(c.call).toEqual(call);
			// A later request of the turn is timed afresh.
			c.handle({ type: 'connecting' });
			expect(c.call?.since).toBe(1_030_000);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a just-sent message that the arriving snapshot does not have yet', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'transcript', items: [] });
		expect(userTexts(c)).toEqual(['first']);
		// Its echo arrives next and is not shown twice.
		c.handle({ type: 'user_message', content: 'first' });
		expect(userTexts(c)).toEqual(['first']);
	});

	it('takes the snapshot copy of a just-sent message when it already has it', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'first' }] });
		expect(userTexts(c)).toEqual(['first']);
		c.handle({ type: 'user_message', content: 'second' });
		expect(userTexts(c)).toEqual(['first', 'second']);
	});

	it('shows a message of images alone once, sent here or queued', () => {
		const c = new ChatState();
		const images = (c: ChatState) => c.messages.flatMap((m) => (m.kind === 'user' ? [m.images ?? []] : []));
		c.optimisticUser('', ['/u/a.png']);
		c.handle({ type: 'user_message', content: '', images: ['/u/a.png'] });
		expect(images(c)).toEqual([['/u/a.png']]);
		// Queued while busy, it shows when the engine takes it in.
		c.handle({ type: 'user_message', content: '', images: ['/u/b.png'] });
		expect(images(c)).toEqual([['/u/a.png'], ['/u/b.png']]);
	});

	it('keeps a just-sent image when the snapshot ends with an earlier one', () => {
		const c = new ChatState();
		c.optimisticUser('', ['/u/new.png']);
		c.handle({ type: 'transcript', items: [{ role: 'user', content: '', images: ['/u/old.png'] }, { role: 'assistant', content: 'red' }] });
		expect(c.messages.flatMap((m) => (m.kind === 'user' ? [m.images] : []))).toEqual([['/u/old.png'], ['/u/new.png']]);
		c.handle({ type: 'user_message', content: '', images: ['/u/new.png'] });
		expect(c.messages.filter((m) => m.kind === 'user')).toHaveLength(2);
	});

	it('names the terminal a conversation moved to, and clears it on return', () => {
		const c = new ChatState();
		c.handle({ type: 'surface', session: 's', surface: 'tui', term: 't-1', client: 3 });
		expect(c.inTerminal).toBe(true);
		expect(c.terminal).toBe('t-1');
		c.handle({ type: 'surface', session: 's', surface: 'gui' });
		expect(c.inTerminal).toBe(false);
		expect(c.terminal).toBe('');
	});

	it('notes deferred and decided actions of a hosted session in the chat', () => {
		setLocale('en');
		const c = new ChatState();
		c.handle({ type: 'action_deferred', id: 'act-1', name: 'bash', summary: 'make deploy' });
		c.handle({ type: 'action_decided', id: 'act-1', decision: 'deny' });
		const texts = c.messages.map((m) => (m.kind === 'system' ? m.text : ''));
		expect(texts[0]).toContain('bash (make deploy)');
		expect(texts[1]).toBe('Pending action act-1 denied');
	});

	it('projects a user message and streamed assistant deltas', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hello' });
		c.handle({ type: 'assistant_delta', delta: 'hi ' });
		c.handle({ type: 'assistant_delta', delta: 'there' });
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
		const a = c.messages[1];
		expect(a.kind === 'assistant' && a.text).toBe('hi there');
	});

	it('leaves the title to the daemon', () => {
		const c = new ChatState();
		c.optimisticUser('do the thing');
		c.handle({ type: 'user_message', content: 'do the thing again' });
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'earlier' }] });
		expect(c.title).toBe('New session');
	});

	it('de-duplicates the optimistic echo', () => {
		const c = new ChatState();
		c.optimisticUser('refactor foo');
		c.handle({ type: 'user_message', content: 'refactor foo' });
		expect(userTexts(c)).toEqual(['refactor foo']);
	});

	it('still appends a genuinely different message after an optimistic one', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'user_message', content: 'second' });
		expect(userTexts(c)).toEqual(['first', 'second']);
	});

	it('de-duplicates a replay echo that arrives after the assistant reply (claude)', () => {
		// claude's --replay-user-messages re-emits the user turn only after the
		// assistant has answered, so the optimistic bubble is no longer at the tail.
		const c = new ChatState();
		c.optimisticUser('你好');
		c.handle({ type: 'assistant_start' });
		c.handle({ type: 'assistant_delta', text: '你好！' });
		c.handle({ type: 'user_message', content: '你好' });
		expect(userTexts(c)).toEqual(['你好']);
	});

	it('stamps end-of-turn usage tokens onto the last assistant message (claude)', () => {
		// claude reports usage once at the end of the turn, after the assistant
		// finished — #assistantIdx is already reset, so tokens must fall back to
		// the last assistant message (same bubble the elapsed time lands on).
		const c = new ChatState();
		c.optimisticUser('q');
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		c.handle({ type: 'assistant_start' }); // resets #assistantIdx to -1
		c.handle({ type: 'usage', output_tokens: 42, input_tokens: 10 });
		const last = c.messages[c.messages.length - 1] as { kind: string; tokens?: number };
		expect(last.kind).toBe('assistant');
		expect(last.tokens).toBe(42);
	});

	it('aggregates turn timing and message stats for diagnostics', () => {
		const c = new ChatState();
		const a1 = { kind: 'assistant', text: 'x', elapsed: 1000 } as const;
		const a2 = { kind: 'assistant', text: 'y', elapsed: 3000 } as const;
		c.messages.push({ kind: 'user', text: 'q1' }, { ...a1 }, { kind: 'user', text: 'q2' }, { ...a2 });
		expect(c.turnTiming).toEqual({ turns: 2, totalMs: 4000, meanMs: 2000 });
		expect(c.messageStats).toMatchObject({ user: 2, assistant: 2 });
	});

	it('aggregates a tool card by call_id and marks it done', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: '1', name: 'read' });
		c.handle({ type: 'tool_output', call_id: '1', name: 'read', output: '{"kind":"text"}', is_error: false });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false, isError: false });
	});

	it('sweeps a still-running tool card to done when the turn ends (lost tool_output)', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 'lost', name: 'read' });
		// No tool_output arrives (e.g. a subagent frame whose tool_result never
		// mapped). The turn ending must not leave the card spinning forever.
		c.handle({ type: 'status', message: 'ready' });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false });
	});

	it("leaves a background subagent's running calls alone when the turn ends, until the subagent ends", () => {
		const c = new ChatState();
		c.handle({ type: 'subagent_lifecycle', path: 't1', label: 'Scan auth', status: 'running' });
		c.handle({ type: 'tool_start', call_id: 'bg', name: 'grep', subagent: 'Scan auth' });
		c.handle({ type: 'tool_start', call_id: 'main', name: 'read' });
		c.handle({ type: 'status', message: 'ready' });
		const tool = (id: string) => c.messages.find((m) => m.kind === 'tool' && m.callId === id);
		expect(tool('main')).toMatchObject({ running: false });
		expect(tool('bg')).toMatchObject({ running: true });
		c.handle({ type: 'subagent_lifecycle', path: 't1', label: 'Scan auth', status: 'completed' });
		expect(tool('bg')).toMatchObject({ running: false });
	});

	it("does not cut the reply where a background subagent's call starts", () => {
		const c = new ChatState();
		c.handle({ type: 'assistant_delta', delta: 'Looking ' });
		c.handle({ type: 'tool_start', call_id: 'bg', name: 'grep', subagent: 'Scan auth' });
		c.handle({ type: 'assistant_delta', delta: 'into it' });
		expect(c.messages.filter((m) => m.kind === 'assistant').map((m) => (m.kind === 'assistant' ? m.text : ''))).toEqual(['Looking into it']);
	});

	it('keeps how many queued messages the engine has, and a message taken back', () => {
		const c = new ChatState();
		c.handle({ type: 'pending_messages', messages: ['a', 'b'], fixed: 1 });
		expect(c.pendingMessages).toEqual(['a', 'b']);
		expect(c.pendingFixed).toBe(1);
		c.handle({ type: 'pending_messages', messages: ['a'] });
		expect(c.pendingFixed).toBe(0);
		c.handle({ type: 'unqueued', content: 'b', images: ['/tmp/x.png'] });
		expect(c.unqueued).toEqual({ content: 'b', images: ['/tmp/x.png'], files: [] });
	});

	it('resolves a pencil rewind intent from checkpoint_view by position', () => {
		const c = new ChatState();
		c.rewindIntent = { userIndex: 1, text: 'edit me' };
		c.handle({
			type: 'checkpoint_view',
			items: [
				{ id: 't0', label: 'a', detail: '', active: false },
				{ id: 't1', label: 'b', detail: '', active: false }
			]
		});
		expect(c.picker).toBeNull();
		expect(c.pendingRewind).toEqual({ id: 't1', text: 'edit me' });
	});

	it('opens the checkpoint picker when there is no rewind intent', () => {
		const c = new ChatState();
		c.handle({ type: 'checkpoint_view', items: [{ id: 't0', label: 'a', detail: '', active: false }] });
		expect(c.picker?.kind).toBe('checkpoint');
		expect(c.pendingRewind).toBeNull();
	});

	it('stores an ACP agent\'s engine_caps and session_options, and drops them on startup', () => {
		const c = new ChatState();
		c.backendId = 'acp';
		const options = [
			{
				id: 'mode',
				name: 'Session Mode',
				description: null,
				category: 'mode',
				type: 'select',
				value: 'build',
				choices: [
					{ value: 'build', name: 'build', description: null },
					{ value: 'plan', name: 'plan', description: null }
				]
			},
			{ id: 'x', name: 'X', description: null, category: null, type: 'boolean', value: true }
		];
		c.handle({ type: 'startup', model: 'm', cwd: '/w', session_id: '', context_window: 0 });
		c.handle({ type: 'session_options', options });
		c.handle({
			type: 'engine_caps',
			agent: { id: 'pi', name: 'Pi', version: '1.2.0' },
			approvals: false,
			gateway: true,
			caps: { interrupt: true, transcriptReplay: true }
		});
		expect(c.sessionOptions).toEqual(options);
		expect(c.engineCaps).toEqual({ interrupt: true, transcriptReplay: true });
		expect(c.agentApprovals).toBe(false);
		expect(c.agentGateway).toBe(true);
		expect(c.agentInfo).toEqual({ id: 'pi', name: 'Pi', version: '1.2.0' });
		// A custom agent: no preset id, approvals unknown.
		c.handle({ type: 'engine_caps', agent: { id: null, name: 'Gemini', version: '' }, approvals: null, gateway: false, caps: {} });
		expect(c.agentInfo?.id).toBeNull();
		expect(c.agentApprovals).toBeNull();
		// engine_caps is sent only when it changes, possibly before startup: it stays.
		c.handle({ type: 'startup', model: 'm', cwd: '/w', session_id: '', context_window: 0 });
		expect(c.agentInfo?.name).toBe('Gemini');
		expect(c.sessionOptions).toEqual(options);
		// An option type the desktop cannot render is left out.
		c.handle({ type: 'session_options', options: [...options, { id: 'n', name: 'N', type: 'number', value: 1 }] });
		expect(c.sessionOptions).toEqual(options);
	});

	it('stores the custom provider a Claude Code / Codex process runs on', () => {
		const c = new ChatState();
		c.backendId = 'claude';
		expect(c.toolProvider).toBeNull();
		// It may come before the process's startup, which leaves it.
		c.handle({ type: 'tool_provider', session: 's1', provider: { id: 'my-api', name: 'My API', model: 'glm-4.6' } });
		c.handle({ type: 'startup', model: 'glm-4.6', cwd: '/w', session_id: '', context_window: 0 });
		// An older daemon names only its one model.
		expect(c.toolProvider).toEqual({ id: 'my-api', name: 'My API', model: 'glm-4.6', models: ['glm-4.6'] });
		c.handle({ type: 'tool_provider', session: 's1', provider: { id: 'my-api', name: 'My API', model: 'a', models: ['a', 'b'] } });
		expect(c.toolProvider?.models).toEqual(['a', 'b']);
		// The next process (moved to the gateway, or the tool's own config) clears it.
		c.handle({ type: 'tool_provider', session: 's1', provider: null });
		expect(c.toolProvider).toBeNull();
		// A nameless provider shows its id.
		c.handle({ type: 'tool_provider', session: 's1', provider: { id: 'p2', name: '', model: 'm' } });
		expect(c.toolProvider?.name).toBe('p2');
	});

	it('stores the latest mcp_servers view on the state', () => {
		const c = new ChatState();
		expect(c.mcpServers).toBeNull();
		c.handle({
			type: 'mcp_servers',
			servers: [
				{
					name: 'files',
					transport: 'stdio',
					state: 'connected',
					tools: [{ name: 'read_file', description: 'Read a file' }]
				},
				{ name: 'web', transport: 'http', state: 'failed', error: 'boom', tools: [] }
			]
		});
		expect(c.mcpServers).toEqual([
			{
				name: 'files',
				transport: 'stdio',
				state: 'connected',
				tools: [{ name: 'read_file', description: 'Read a file' }]
			},
			{ name: 'web', transport: 'http', state: 'failed', error: 'boom', tools: [] }
		]);
		// A later event replaces the list wholesale.
		c.handle({ type: 'mcp_servers', servers: [] });
		expect(c.mcpServers).toEqual([]);
	});

	it('clears booting on the first engine event and caches the model catalog', () => {
		const c = new ChatState();
		expect(c.booting).toBe(true);
		c.handle({ type: 'model_status', state: 'idle' });
		expect(c.booting).toBe(false);
		c.handle({
			type: 'model_view',
			models: [{ model: 'opus', active: true, reasoning_efforts: ['high', 'max'] }],
			active_effort: 'high'
		});
		expect(c.modelCatalog).toEqual([{ model: 'opus', active: true, reasoning_efforts: ['high', 'max'] }]);
		expect(c.modelCatalogEffort).toBe('high');
	});

	it('collects engine notes into statusLog; steps of the course stay in the conversation', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'info', message: 'stderr: warn' });
		c.handle({ type: 'info', message: 'stderr: warn 2' });
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'error', message: 'boom' });
		// statusLog holds only the engine's notes…
		expect(c.statusLog).toEqual(['stderr: warn', 'stderr: warn 2']);
		// …the compaction marks the conversation, user + error stay as bubbles.
		expect(c.messages.map((m) => (m.kind === 'system' ? (m.flow?.type ?? 'note') : m.kind))).toEqual(['user', 'note', 'note', 'compacted', 'error']);
	});

	it('marks a compaction with the context before and after, and a stop once', () => {
		const c = new ChatState();
		c.handle({ type: 'context_usage', tokens: 968_000 });
		c.handle({ type: 'compaction_start' });
		const marker = () => c.messages.find((m) => m.kind === 'system' && m.flow);
		expect(marker()).toMatchObject({ flow: { type: 'compacting', before: 968_000 } });
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'context_usage', tokens: 25_900 });
		expect(marker()).toMatchObject({ flow: { type: 'compacted', before: 968_000, after: 25_900 } });
		// A later usage leaves it as it was.
		c.handle({ type: 'context_usage', tokens: 40_000 });
		expect(marker()).toMatchObject({ flow: { after: 25_900 } });

		// Stopped by the user (any engine), or reported interrupted: marked once.
		c.handle({ type: 'connecting' });
		c.stopping();
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'connecting' });
		c.handle({ type: 'status', message: 'interrupted' });
		expect(c.messages.filter((m) => m.kind === 'system' && m.flow?.type === 'interrupted')).toHaveLength(1);
	});

	it('leaves the compacting phase when a mid-turn compaction ends', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'compaction_start' });
		expect(c.phase).toBe('compacting');
		c.handle({ type: 'compaction_end' });
		expect(c.busy).toBe(true);
		expect(c.phase).not.toBe('compacting');
		c.handle({ type: 'status', message: 'ready' });
		expect(c.busy).toBe(false);
	});

	it('shows a retry as live state, not a log line, until output flows again', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'retrying', attempt: 3, max_attempts: 6, reason: 'unexpected status 503: busy', delay_ms: 2000 });
		expect(c.retry).toMatchObject({ attempt: 3, max: 6, reason: 'unexpected status 503: busy', delayMs: 2000 });
		expect(c.messages.map((m) => m.kind)).toEqual(['user']);
		c.handle({ type: 'assistant_delta', delta: 'ok' });
		expect(c.retry).toBeNull();
		c.handle({ type: 'retrying', attempt: 2, max_attempts: 3, reason: 'timeout', delay_ms: 500 });
		c.handle({ type: 'error', message: 'gave up' });
		expect(c.retry).toBeNull();
	});

	it('estimates cost from token usage when the engine reports none', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-4-8', state: 'idle' });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		// opus: $15/M in + $75/M out = $90 for 1M+1M.
		expect(c.cost).toBeCloseTo(90, 5);
	});

	it('mirrors claude ultracode from model_status; other engines leave it off', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', ultracode: true, ultracode_available: true, state: 'idle' });
		expect([c.ultracode, c.ultracodeAvailable]).toEqual([true, true]);
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		expect([c.ultracode, c.ultracodeAvailable]).toEqual([false, false]);
	});

	it("keeps an ACP agent's unset effort apart from its levels", () => {
		const c = new ChatState();
		c.handle({
			type: 'model_status',
			provider: 'acp',
			model: 'deepseek/deepseek-flash',
			reasoning_effort: 'default',
			reasoning_efforts: ['none', 'low', 'high', 'max'],
			default_effort: 'default',
			state: 'ready'
		});
		expect([c.effort, c.efforts, c.effortDefault]).toEqual(['default', ['none', 'low', 'high', 'max'], 'default']);
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', reasoning_effort: 'high', reasoning_efforts: ['low', 'high'], state: 'idle' });
		expect(c.effortDefault).toBe('');
	});

	it('asks once for a model list a draft can show, and takes the answer without opening a picker', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
		try {
			const c = new ChatState();
			c.backendId = 'jucode';
			c.handle({ type: 'model_status', provider: 'jucode', model: 'glm-5', state: 'ready' });
			expect(c.wantsCatalog).toBe(true);
			// The page sends /model and marks the answer quiet.
			c.wantsCatalog = false;
			c.catalogQuiet = true;
			c.handle({ type: 'model_status', provider: 'jucode', model: 'glm-5', state: 'ready' });
			expect(c.wantsCatalog).toBe(false);
			c.handle({ type: 'model_view', models: [{ model: 'glm-5', active: true }], active_effort: '' });
			expect(c.picker).toBeNull();
			// A draft of the backend lists it.
			const draft = new ChatState();
			draft.backendId = 'jucode';
			draft.seedFromProfile();
			expect(draft.modelCatalog.map((m) => m.model)).toEqual(['glm-5']);
			// Opened by the user later: a picker.
			c.handle({ type: 'model_view', models: [{ model: 'glm-5', active: true }], active_effort: '' });
			expect(c.picker?.kind).toBe('model');
			// Cached already: a new engine does not ask.
			const next = new ChatState();
			next.backendId = 'jucode';
			next.handle({ type: 'model_status', provider: 'jucode', model: 'glm-5', state: 'ready' });
			expect(next.wantsCatalog).toBe(false);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("a draft of an ACP agent takes the agent's caps from last time, so it can pick a model", () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
		try {
			const c = new ChatState();
			c.backendId = 'acp';
			c.acpAgentId = 'opencode';
			c.handle({ type: 'engine_caps', agent: { id: 'opencode', name: 'OpenCode', version: '2.0.20' }, caps: { modelPicker: true } });
			const draft = new ChatState();
			draft.backendId = 'acp';
			draft.acpAgentId = 'opencode';
			draft.seedFromProfile();
			expect(draft.engineCaps).toEqual({ modelPicker: true });
			const other = new ChatState();
			other.backendId = 'acp';
			other.acpAgentId = 'pi';
			other.seedFromProfile();
			expect(other.engineCaps).toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('defers to the engine cost once it reports one (no double count)', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		c.handle({ type: 'context_usage', tokens: 100, cost: 0.42 });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		expect(c.cost).toBe(0.42);
	});

	it('truncateToUserTurn drops the target turn and everything after (codex rewind)', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'first' });
		c.handle({ type: 'assistant_delta', delta: 'a1' });
		c.handle({ type: 'user_message', content: 'second' });
		c.handle({ type: 'assistant_delta', delta: 'a2' });
		c.handle({ type: 'user_message', content: 'third' });
		expect(c.userTurns).toBe(3);
		c.truncateToUserTurn(1); // rewind to the 2nd user turn
		expect(userTexts(c)).toEqual(['first']);
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
	});

	it('stamps assistant_uuid and resolves the claude rewind resume-at target', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'q1' });
		c.handle({ type: 'assistant_delta', delta: 'a1' });
		c.handle({ type: 'assistant_uuid', uuid: 'uuid-1' });
		c.handle({ type: 'assistant_start' });
		c.handle({ type: 'user_message', content: 'q2' });
		c.handle({ type: 'assistant_delta', delta: 'a2' });
		c.handle({ type: 'assistant_uuid', uuid: 'uuid-2' });
		// Rewind to turn 1 (2nd user msg) resumes at turn 0's assistant uuid.
		expect(c.claudeRewindTarget(1)).toBe('uuid-1');
		// Rewind to turn 0 has no prior assistant → fresh restart (null).
		expect(c.claudeRewindTarget(0)).toBeNull();
	});

	it('tracks busy state from engine status', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', state: 'streaming' });
		expect(c.busy).toBe(true);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.busy).toBe(false);
	});
});

describe('approval flow (engine-enforced)', () => {
	it('reduces an approval_request with hunks + subagent into state', () => {
		const c = new ChatState();
		c.handle({
			type: 'approval_request',
			call_id: 'call_1',
			name: 'apply_patch',
			summary: 'src/a.rs',
			subagent_id: 'agent-7',
			hunks: [
				{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
				{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] }
			]
		});
		expect(c.pendingApproval).toEqual({
			callId: 'call_1',
			name: 'apply_patch',
			summary: 'src/a.rs',
			subagentId: 'agent-7',
			hunks: [
				{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
				{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] }
			],
			questions: null
		});
	});

	it('shows a mode that waits for the turn, and drops an approval decided elsewhere', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_mode_pending', mode: 'full-access' } as never);
		expect(c.approvalPending).toBe('all');
		c.handle({ type: 'approval_mode_pending', mode: null } as never);
		expect(c.approvalPending).toBeNull();
		c.handle({ type: 'approval_request', call_id: 'c1', name: 'bash', summary: 'ls', hunks: null, subagent_id: null } as never);
		expect(c.pendingApproval?.callId).toBe('c1');
		c.handle({ type: 'tool_output', call_id: 'c2', output: '', is_error: false } as never);
		expect(c.pendingApproval?.callId).toBe('c1');
		c.handle({ type: 'tool_output', call_id: 'c1', output: 'ok', is_error: false } as never);
		expect(c.pendingApproval).toBeNull();
	});

	it('reduces a hunk-less approval_request with null hunks/subagent', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'c2', name: 'bash', summary: 'rm -rf /tmp/x', subagent_id: null, hunks: null });
		expect(c.pendingApproval).toEqual({
			callId: 'c2',
			name: 'bash',
			summary: 'rm -rf /tmp/x',
			subagentId: null,
			hunks: null,
			questions: null
		});
	});

	it('never auto-approves client-side: requests surface in every mode', () => {
		const c = new ChatState();
		c.approvalMode = 'all'; // engine decides now — 'all' must not swallow the card
		c.handle({ type: 'approval_request', call_id: 'c3', name: 'apply_patch', summary: 'x' });
		expect(c.pendingApproval?.callId).toBe('c3');
	});

	it("pushes the desktop's persisted mode when the startup announcement diverges", () => {
		const c = new ChatState();
		c.approvalMode = 'all'; // persisted preference
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // engine default
		// desktop mode wins at startup: local state untouched, push requested
		expect(c.approvalMode).toBe('all');
		expect(c.pendingModeSync).toBe('full-auto');
		// the ack after the page sends set_approval_mode reconciles to the same value
		c.pendingModeSync = null;
		c.handle({ type: 'approval_mode', mode: 'full-auto' });
		expect(c.approvalMode).toBe('all');
		expect(c.pendingModeSync).toBeNull();
	});

	it('requests no push when the startup announcement already matches', () => {
		const c = new ChatState();
		c.approvalMode = 'ask';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBeNull();
		expect(c.approvalMode).toBe('ask');
	});

	it('reconciles post-startup approval_mode events from the engine (e.g. /approvals)', () => {
		const c = new ChatState();
		c.approvalMode = 'ask';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // startup announcement, in sync
		c.handle({ type: 'approval_mode', mode: 'auto-edit' }); // user typed /approvals auto-edit
		expect(c.approvalMode).toBe('edits');
		expect(c.pendingModeSync).toBeNull();
		// garbage keeps the current mode
		c.handle({ type: 'approval_mode', mode: 'bogus' });
		expect(c.approvalMode).toBe('edits');
	});

	it('re-arms the startup push after a crash restart', () => {
		const c = new ChatState();
		c.approvalMode = 'edits';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBe('auto-edit');
		c.pendingModeSync = null;
		c.handle({ type: 'approval_mode', mode: 'auto-edit' }); // ack
		// engine crashes; the restarted engine announces its default again
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBe('auto-edit');
		expect(c.approvalMode).toBe('edits');
	});
});

describe('send state and turn stats', () => {
	const user = (c: ChatState) => c.messages.find((m) => m.kind === 'user') as { state?: string };

	it('walks a sent message through connecting and waiting until the reply streams', () => {
		const c = new ChatState();
		c.optimisticUser('hi');
		expect(user(c).state).toBe('sending');
		c.handle({ type: 'connecting' });
		expect(user(c).state).toBe('connecting');
		c.handle({ type: 'thinking_start' });
		expect(user(c).state).toBe('waiting');
		c.handle({ type: 'assistant_delta', delta: 'hello' });
		expect(user(c).state).toBeUndefined();
	});

	it('marks a message whose turn fails before any output', () => {
		const c = new ChatState();
		c.optimisticUser('hi');
		c.handle({ type: 'connecting' });
		c.handle({ type: 'error', message: 'HTTP 400' });
		expect(user(c).state).toBe('failed');
	});

	it('flags a cache miss during a running turn only', () => {
		const c = new ChatState();
		c.handle({ type: 'usage', input_tokens: 10_000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 12_000, cached_input_tokens: 0, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'usage', input_tokens: 14_000, cached_input_tokens: 11_990, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
		c.handle({ type: 'usage', input_tokens: 16_000, cached_input_tokens: 100, output_tokens: 10 });
		expect(c.cacheMiss).toEqual({ input: 16_000, cached: 100 });
		c.cacheMiss = null;
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'usage', input_tokens: 5_000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 6_000, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
	});

	it('stamps the turn totals on the last reply, including late usage', () => {
		const c = new ChatState();
		c.optimisticUser('fix it');
		c.handle({ type: 'connecting' });
		c.handle({ type: 'assistant_delta', delta: 'looking' });
		c.handle({ type: 'tool_start', call_id: 'c1', name: 'read_file' });
		c.handle({ type: 'tool_output', call_id: 'c1', name: 'read_file', output: 'x' });
		c.handle({ type: 'usage', input_tokens: 100, output_tokens: 20 });
		c.handle({ type: 'assistant_delta', delta: 'done' });
		c.handle({ type: 'status', message: 'ready' });
		// claude: usage for the turn arrives after it ended
		c.handle({ type: 'usage', input_tokens: 50, output_tokens: 5 });
		const last = [...c.messages].reverse().find((m) => m.kind === 'assistant') as { turn?: Record<string, number> };
		expect(last.turn).toMatchObject({ inTokens: 150, outTokens: 25, tools: 1 });
		expect(last.turn!.ttft).toBeGreaterThanOrEqual(0);
	});
});

describe('reply timing', () => {
	it('splits a reply at its tool call, times each segment and the request stages', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(0);
			const c = new ChatState();
			const at = (ms: number, ev: Record<string, unknown>) => {
				vi.setSystemTime(ms);
				c.handle(ev as never);
			};
			at(0, { type: 'user_message', content: 'q' });
			at(0, { type: 'assistant_start' });
			at(0, { type: 'connecting' });
			expect(c.call).toEqual({ phase: 'connect', since: 0 });
			at(300, { type: 'thinking_start' });
			expect(c.call).toEqual({ phase: 'ttft', since: 300 });
			at(1000, { type: 'assistant_delta', delta: 'A' });
			expect(c.call).toEqual({ phase: 'output', since: 1000 });
			at(2000, { type: 'tool_start', call_id: 't', name: 'read' });
			expect(c.call).toBeNull();
			at(2500, { type: 'tool_output', call_id: 't', name: 'read', output: 'x' });
			at(2600, { type: 'connecting' });
			at(3000, { type: 'assistant_delta', delta: 'B' });
			at(4000, { type: 'status', message: 'ready' });

			const kinds = c.messages.map((m) => [m.kind, 'text' in m ? m.text : '']);
			// Text after the tool is its own message, below the tool card.
			expect(kinds).toEqual([['user', 'q'], ['assistant', 'A'], ['tool', ''], ['assistant', 'B']]);
			const [a, b] = c.messages.filter((m) => m.kind === 'assistant') as { segMs?: number; turn?: { segments: number; elapsed: number } }[];
			expect(a.segMs).toBe(2000);
			expect(b.segMs).toBe(1400);
			// Output streamed 1000–2000 and 3000–4000: the waits and the tool run are not output time.
			expect(b.turn).toMatchObject({ segments: 2, elapsed: 4000, genMs: 2000 });
			expect(c.call).toBeNull();
			expect(c.runMs).toBe(4000);
		} finally {
			vi.useRealTimers();
		}
	});

	it('times the wait to the first token from the request on engines without a connect event', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(100);
			const c = new ChatState();
			c.backendId = 'codex';
			c.handle({ type: 'user_message', content: 'q' } as never);
			c.handle({ type: 'connecting' } as never);
			expect(c.call).toEqual({ phase: 'ttft', since: 100 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('starts the next request when the tools are back on engines that announce only the first', () => {
		vi.useFakeTimers();
		try {
			const c = new ChatState();
			c.backendId = 'codex';
			const at = (ms: number, ev: Record<string, unknown>) => {
				vi.setSystemTime(ms);
				c.handle(ev as never);
			};
			at(0, { type: 'connecting' });
			at(500, { type: 'tool_start', call_id: 'a', name: 'bash' });
			at(500, { type: 'tool_start', call_id: 'b', name: 'bash' });
			at(900, { type: 'tool_output', call_id: 'a', name: 'bash', output: '' });
			// b still runs: no request yet, and the indicator says so.
			expect(c.call).toBeNull();
			expect(c.phase).toBe('tool');
			at(1200, { type: 'tool_output', call_id: 'b', name: 'bash', output: '' });
			expect(c.call).toEqual({ phase: 'ttft', since: 1200 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a claude request generating while it writes a tool call, until its usage', () => {
		vi.useFakeTimers();
		try {
			const c = new ChatState();
			c.backendId = 'claude';
			const at = (ms: number, ev: Record<string, unknown>) => {
				vi.setSystemTime(ms);
				c.handle(ev as never);
			};
			at(0, { type: 'connecting' });
			at(200, { type: 'thinking_start' });
			at(800, { type: 'assistant_delta', delta: 'writing' });
			at(1000, { type: 'tool_start', call_id: 'w', name: 'write' });
			expect(c.call).toEqual({ phase: 'output', since: 800 });
			expect(c.phase).toBe('generating');
			at(5000, { type: 'usage', input_tokens: 10, output_tokens: 900 });
			expect(c.call).toBeNull();
			expect(c.phase).toBe('tool');
			at(5200, { type: 'tool_output', call_id: 'w', name: 'write', output: '' });
			// This daemon reports the answer: the next request connects first.
			at(5300, { type: 'connecting' });
			expect(c.call).toEqual({ phase: 'connect', since: 5300 });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('claude session extras', () => {
	it('lists background tasks with their progress and announces finished ones', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'background_tasks', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Review' }] });
		c.handle({ type: 'task_progress', task_id: 'w1', message: 'Find: bugs-0' });
		expect(c.bgTasks).toEqual([{ id: 'w1', kind: 'local_workflow', description: 'Review', message: 'Find: bugs-0' }]);
		// A new listing keeps a task's latest progress line.
		c.handle({ type: 'background_tasks', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Review' }] });
		expect(c.bgTasks[0].message).toBe('Find: bugs-0');
		c.handle({ type: 'background_tasks', tasks: [] });
		c.handle({ type: 'task_done', task_id: 'w1', kind: 'local_workflow', status: 'completed', summary: 'Review done' });
		expect(c.bgTasks).toEqual([]);
		expect(c.messages.at(-1)).toEqual({ kind: 'system', flow: { type: 'task' }, text: '多智能体编排已完成：Review done' });
		c.handle({ type: 'task_output', task_id: 'b1', output: 'ok', truncated: true });
		expect(c.taskOutputs.b1).toEqual({ output: 'ok', truncated: true, error: '' });
	});

	it('fills a pending /btw answer in place', () => {
		const c = new ChatState();
		c.sideAnswers.push({ question: 'why?', answer: '', error: '', pending: true });
		c.handle({ type: 'side_answer', question: 'why?', answer: 'Because.' });
		expect(c.sideAnswers).toEqual([{ question: 'why?', answer: 'Because.', error: '', pending: false }]);
		// The conversation is untouched.
		expect(c.messages).toEqual([]);
	});

	it('keeps a suggestion until the next turn starts', () => {
		const c = new ChatState();
		c.handle({ type: 'prompt_suggestion', text: 'run the tests' });
		expect(c.suggestion).toBe('run the tests');
		c.handle({ type: 'connecting' });
		expect(c.suggestion).toBe('');
	});

	it('names fallbacks, subagents and session switches', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'model_fallback', from: 'Opus 5.5', to: 'Sonnet 5.5', reason: 'overloaded' });
		expect(c.messages.at(-1)).toEqual({ kind: 'system', flow: { type: 'fallback' }, text: '模型已从 Opus 5.5 切换到 Sonnet 5.5（原模型过载）' });
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan auth', status: 'running', message: 'Reading' });
		expect(c.subagents.a1).toMatchObject({ status: 'running', message: 'Reading', label: 'Scan auth' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'read', subagent: 'Scan auth' });
		expect(c.messages.at(-1)).toMatchObject({ kind: 'tool', subagent: 'Scan auth' });
		expect(c.subagentLastTool['Scan auth']).toMatchObject({ callId: 't2', name: 'read' });
		// A finished subagent stays (the progress card shows it) until the next turn.
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan auth', status: 'completed', message: '' });
		expect(c.subagents.a1).toMatchObject({ status: 'completed', label: 'Scan auth' });
		expect(c.subagents.a1.endedAt).toBeGreaterThan(0);
		c.handle({ type: 'connecting' });
		expect(c.subagents.a1).toBeUndefined();
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', fast: true, fast_available: true, thinking_summaries: false, state: 'idle' });
		expect([c.fast, c.fastAvailable, c.thinkingSummaries]).toEqual([true, true, false]);
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		expect([c.fast, c.fastAvailable, c.thinkingSummaries]).toEqual([false, false, null]);
	});

	it('reads the agent trace and a subagent conversation', () => {
		const c = new ChatState();
		c.handle({
			type: 'agent_runs',
			workflows: [
				{
					id: 'w1',
					tool_use_id: 't0',
					name: 'review',
					status: 'running',
					started_at: 100,
					tokens: 900,
					phases: [{ index: 1, title: 'Find' }],
					agents: [
						{ id: 'a1', label: 'bugs-0', phase: 1, state: 'running', started_at: 120, tokens: 900, tool_calls: 2 },
						{ id: 'a2', label: 'bugs-1', phase: 1, state: 'start', started_at: 130 },
						{ label: 'bugs-2', phase: 1, state: 'start' }
					]
				}
			],
			agents: [{ id: 'a9', label: 'Read a.txt', status: 'completed', tool_use_id: 't1', tokens: 30420, duration_ms: 4529 }]
		});
		expect(c.agentRuns.workflows[0].agents[0]).toMatchObject({ id: 'a1', phase: 1, state: 'running', toolCalls: 2 });
		// A Workflow agent is `start` while queued too: it has begun once it has a start time.
		expect(c.agentRuns.workflows[0].agents.slice(1).map((a) => a.state)).toEqual(['start', 'queued']);
		expect(c.agentRuns.agents[0]).toMatchObject({ id: 'a9', state: 'completed', toolUseId: 't1', durationMs: 4529 });
		// Stopped, its agents left mid-run are not running.
		c.handle({ type: 'agent_runs', workflows: [{ id: 'w1', status: 'killed', agents: [{ id: 'a1', state: 'progress', started_at: 120 }, { id: 'a2', state: 'done' }] }], agents: [] });
		expect(c.agentRuns.workflows[0].agents.map((a) => a.state)).toEqual(['stopped', 'done']);
		// Completed, the last progress came before its last agents finished.
		c.handle({ type: 'agent_runs', workflows: [{ id: 'w1', status: 'completed', agents: [{ id: 'a1', state: 'progress', started_at: 120 }] }], agents: [] });
		expect(c.agentRuns.workflows[0].agents[0].state).toBe('completed');
		c.handle({
			type: 'subagent_transcript',
			agent_id: 'a1',
			items: [
				{ role: 'user', content: 'Find bugs' },
				{ role: 'reasoning', content: 'Look.' },
				{ role: 'tool', call_id: 't2', name: 'read', output: '{"path":"/a"}', running: false, is_error: false },
				{ role: 'assistant', content: 'None.' }
			]
		});
		const tr = c.subagentTranscripts.a1;
		expect(tr.task).toBe('Find bugs');
		expect(tr.messages.map((m) => m.kind)).toEqual(['reasoning', 'tool', 'assistant']);
		// The session's own conversation is untouched.
		expect(c.messages).toEqual([]);
	});

	it('keeps a subagent call’s arguments once its result replaces them', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 't1', name: 'Task' });
		c.handle({ type: 'tool_update', call_id: 't1', output: '{"description":"Scan auth","prompt":"Find it"}' });
		c.handle({ type: 'tool_output', call_id: 't1', name: 'Task', output: 'Found it in auth.ts', is_error: false });
		expect(c.messages.at(-1)).toMatchObject({ output: 'Found it in auth.ts', args: '{"description":"Scan auth","prompt":"Find it"}' });
	});

	it('reads a JuCode subagent from its spawn call and its lifecycle', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'tool_start', call_id: 'call_1', name: 'spawn_agent' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'pending', message: 'reserved' });
		c.handle({ type: 'tool_output', call_id: 'call_1', name: 'spawn_agent', output: '{"task_name":"scan","path":"/root/scan","status":"running"}', is_error: false });
		expect(c.subagents['/root/scan']).toMatchObject({ status: 'pending', label: 'scan', toolUseId: 'call_1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'running', message: 'started', model: 'gpt-5.5' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'message', message: 'queued message' });
		expect(c.subagents['/root/scan']).toMatchObject({ status: 'running', model: 'gpt-5.5', toolUseId: 'call_1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'errored', message: 'timeout' });
		expect(c.subagents['/root/scan'].endedAt).toBeGreaterThan(0);
	});

	it('reads the native agent trace’s activity and effort, and tool inputs in a transcript', () => {
		const c = new ChatState();
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: '/root/x', label: 'x', state: 'running', activity: 'Ran cargo test', effort: 'low', tool_use_id: 'c9' }] });
		expect(c.agentRunsSeen).toBe(true);
		expect(c.agentRuns.agents[0]).toMatchObject({ state: 'running', activity: 'Ran cargo test', effort: 'low', toolUseId: 'c9' });
		c.handle({ type: 'subagent_transcript', agent_id: '/root/x', items: [{ role: 'user', content: 'go' }, { role: 'tool', call_id: 't', name: 'bash', input: { command: 'ls' }, running: true }] });
		expect(c.subagentTranscripts['/root/x'].messages[0]).toMatchObject({ kind: 'tool', output: '{"command":"ls"}', running: true });
	});

	it('takes an older engine’s refusal of the trace ops quietly', () => {
		setLocale('zh');
		const c = new ChatState();
		c.agentFocus = '/root/x';
		c.handle({ type: 'error', message: 'unknown op: agent_runs' });
		c.handle({ type: 'error', message: 'unknown op: subagent_transcript' });
		expect(c.messages).toEqual([]);
		expect(c.lastError).toBeNull();
		expect(c.subagentTranscripts['/root/x'].error).toBeTruthy();
	});

	it('shows a proposed plan and follows its status', () => {
		const c = new ChatState();
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Fix auth', markdown: '## Steps\n1. a', status: 'pending' });
		expect(c.messages.at(-1)).toEqual({ kind: 'plan', id: 'p1', title: 'Fix auth', text: '## Steps\n1. a', status: 'pending' });
		c.planRevising = 'p1';
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Fix auth', markdown: '## Steps\n1. a', status: 'revising' });
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0]).toMatchObject({ status: 'revising' });
		expect(c.planRevising).toBeNull();
		c.handle({ type: 'proposed_plan', id: 'p2', title: 'Fix auth v2', markdown: 'x', status: 'odd' });
		expect(c.messages.at(-1)).toMatchObject({ id: 'p2', status: 'pending' });
		c.handle({ type: 'transcript', items: [{ role: 'plan', id: 'p2', title: 'T', content: 'body', status: 'approved' }] });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p2', title: 'T', text: 'body', status: 'approved' }]);
	});

	it('grows one plan while the model writes it, and completes it in place', () => {
		const c = new ChatState();
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Sna', append: '' });
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: '## Go' });
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: 'al' });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p1', title: 'Snake', text: '## Goal', status: 'drafting' }]);
		const draft = c.messages[0];
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Snake', markdown: '## Goal\n1. a', status: 'pending' });
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0]).toBe(draft);
		expect(c.messages[0]).toMatchObject({ text: '## Goal\n1. a', status: 'pending' });
	});

	it('drops a plan still being drafted when the request is retried', () => {
		const c = new ChatState();
		c.handle({ type: 'proposed_plan', id: 'p0', title: 'Old', markdown: 'x', status: 'pending' });
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: '## Go' });
		c.handle({ type: 'assistant_delta', delta: 'and' });
		c.handle({ type: 'retrying', attempt: 1, max_attempts: 3, reason: 'timeout', delay_ms: 500 });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p0', title: 'Old', text: 'x', status: 'pending' }]);
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: '## Goal' });
		expect(c.messages.at(-1)).toMatchObject({ id: 'p1', text: '## Goal', status: 'drafting' });
		expect(c.messages).toHaveLength(2);
	});

	it('remembers the mode before plan mode and when the plan changed', () => {
		const c = new ChatState();
		c.setApprovalMode('edits');
		c.setApprovalMode('plan');
		c.setApprovalMode('plan');
		expect(c.modeBeforePlan).toBe('edits');
		c.handle({ type: 'plan', plan: [{ step: 'a', status: 'pending' }] });
		const at = c.planAt;
		expect(at).toBeGreaterThan(0);
		c.handle({ type: 'connecting' });
		expect(c.turnStartedAt).toBeGreaterThan(0);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.turnEndedAt).toBeGreaterThanOrEqual(c.turnStartedAt);
	});

	it('shows the images a message was sent with, live and in a transcript', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'look', images: ['/u/a.png'] });
		expect(c.messages.at(-1)).toEqual({ kind: 'user', text: 'look', images: ['/u/a.png'], at: expect.any(Number) });
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'look', images: ['/u/a.png'] }, { role: 'user', content: 'plain' }] });
		expect(c.messages).toEqual([
			{ kind: 'user', text: 'look', images: ['/u/a.png'] },
			{ kind: 'user', text: 'plain' }
		]);
	});

	it('keeps where a replayed reply sits, for a rewind or a fork to resume at', () => {
		const c = new ChatState();
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'q', at: 1 }, { role: 'assistant', content: 'a', uuid: 'u-1', at: 2 }] });
		expect(c.messages[1]).toEqual({ kind: 'assistant', text: 'a', uuid: 'u-1', at: 2 });
		expect(c.claudeRewindTarget(1)).toBe('u-1');
	});

	it('keeps an elicitation page with its approval', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'a', name: 'mcp_elicitation', summary: 'jira: sign in', url: 'https://x.test/auth', hunks: null });
		expect(c.pendingApproval?.url).toBe('https://x.test/auth');
	});
});


describe('gateway session costs', () => {
	it('uses settled per-turn charges, including group changes, without repricing history', () => {
		const c = new ChatState();
		for (const id of ['t-first', 't-second']) {
			c.handle({ type: 'user_message', content: id });
			c.handle({ type: 'connecting' });
			c.handle({ type: 'assistant_delta', delta: 'answer' });
			c.handle({ type: 'usage', input_tokens: 1000, output_tokens: 500, billing_turn: id, billing_gateway: true });
			c.handle({ type: 'context_usage', tokens: 1500, cost: 9 });
			c.handle({ type: 'status', message: 'ready' });
		}
		const charge = (gateway_cost: number) => ({ gateway_cost, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 0, unpriced_requests: 0 });
		const snapshot = { type: 'session_usage', totals: { ...charge(0.08), gateway_requests: 2, turns: 2, input_tokens: 2000, output_tokens: 1000 }, turns: [
			{ ...charge(0.05), turn_id: 't-first' }, { ...charge(0.03), turn_id: 't-second' }
		] };
		c.handle(snapshot);
		c.handle(snapshot); // refresh replaces, never adds or multiplies again
		expect(c.billing?.gateway_cost).toBe(0.08);
		const costs = c.messages.flatMap(m => m.kind === 'assistant' && m.turn ? [m.turn.billing?.gateway_cost] : []);
		expect(costs).toEqual([0.05, 0.03]);
		c.handle({ type: 'session_usage', billing_error: 'offline' });
		expect(c.billing?.gateway_cost).toBe(0.08);
		expect(c.billingError).toBe('offline');
	});

	it('marks gateway usage pending before settlement and accepts a zero charge', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		c.handle({ type: 'status', message: 'ready' });
		// A late usage frame still belongs to the turn which just ended.
		c.handle({ type: 'usage', input_tokens: 10, output_tokens: 2, billing_turn: 't-free', billing_gateway: true });
		expect(c.billing?.pending_requests).toBeGreaterThan(0);
		const free = { gateway_cost: 0, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 0, unpriced_requests: 0 };
		c.handle({ type: 'session_usage', totals: { ...free, turns: 1, input_tokens: 10, output_tokens: 2 }, turns: [{ ...free, turn_id: 't-free' }] });
		expect(c.billing?.gateway_cost).toBe(0);
		const last = c.messages.at(-1);
		expect(last?.kind === 'assistant' && last.turn?.billing?.gateway_cost).toBe(0);
	});

	it('takes the ledger’s figures for a session off the gateway too, tokens included', () => {
		const c = new ChatState();
		const row = { gateway_cost: null, estimated_cost_usd: 0.12, gateway_requests: 0, pending_requests: 0, unpriced_requests: 0 };
		c.handle({ type: 'session_usage', totals: { ...row, turns: 2, input_tokens: 3000, output_tokens: 400 }, turns: [{ ...row, turn_id: 't-1' }] });
		expect(c.billing?.estimated_cost_usd).toBe(0.12);
		expect(c.totalIn).toBe(3000);
		expect(c.totalOut).toBe(400);
		// A session the ledger has not seen keeps what this client counted.
		const fresh = new ChatState();
		fresh.handle({ type: 'session_usage', totals: { ...row, estimated_cost_usd: null, turns: 0 }, turns: [] });
		expect(fresh.billing).toBeNull();
	});
});

import { boundedOutput } from './chat.svelte';
describe('boundedOutput', () => {
	it('keeps a short output, cuts a long one to its head and tail', () => {
		expect(boundedOutput('ok')).toBe('ok');
		const long = 'a'.repeat(50_000) + 'MIDDLE' + 'z'.repeat(50_000);
		const out = boundedOutput(long);
		expect(out.length).toBeLessThan(70_000);
		expect(out.startsWith('aaa')).toBe(true);
		expect(out.endsWith('zzz')).toBe(true);
		expect(out).toContain('characters not shown');
	});
	it('keeps JSON parseable and an image whole', () => {
		const json = JSON.stringify({ stdout: 'x'.repeat(200_000), exit_code: 0 });
		const out = JSON.parse(boundedOutput(json));
		expect(out.exit_code).toBe(0);
		expect(out.stdout.length).toBeLessThan(40_000);
		const image = JSON.stringify({ kind: 'image', base64: 'A'.repeat(300_000) });
		expect(JSON.parse(boundedOutput(image)).base64.length).toBe(300_000);
	});
});

describe('subagent ends', () => {
	it('ends a subagent the run list says ended, and starts no row for an unknown end', () => {
		const c = new ChatState();
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan', status: 'running' } as never);
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: 'a1', status: 'running' }] } as never);
		expect(c.subagents.a1.endedAt).toBeUndefined();
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: 'a1', status: 'killed' }] } as never);
		expect(c.subagents.a1).toMatchObject({ status: 'killed' });
		expect(c.subagents.a1.endedAt).toBeGreaterThan(0);
		c.handle({ type: 'subagent_lifecycle', path: 'gone', label: '', status: 'stopped' } as never);
		expect(c.subagents.gone).toBeUndefined();
	});
});

describe('usage limit', () => {
	it('keeps which limit, how much of it is used, and when it resets', () => {
		const c = new ChatState();
		c.handle({ type: 'rate_limit', level: 'warning', message: '', resets_at: 1_790_800_000_000, window: 'five_hour', used: 83, overage: false } as never);
		expect(c.rateLimit).toEqual({ level: 'warning', message: '', resetsAt: 1_790_800_000_000, window: 'five_hour', used: 83, overage: false });
		// An older daemon: no window or share.
		c.handle({ type: 'rate_limit', level: 'limited', message: 'out', resets_at: null } as never);
		expect(c.rateLimit).toMatchObject({ level: 'limited', window: '', used: null, resetsAt: null });
		c.handle({ type: 'rate_limit', level: 'ok' } as never);
		expect(c.rateLimit).toBeNull();
	});
});
