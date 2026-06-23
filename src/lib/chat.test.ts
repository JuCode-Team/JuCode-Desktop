import { describe, it, expect } from 'vitest';
import { ChatState } from './chat.svelte';

const userTexts = (c: ChatState) =>
	c.messages.filter((m) => m.kind === 'user').map((m) => (m.kind === 'user' ? m.text : ''));

describe('ChatState.handle', () => {
	it('projects a user message and streamed assistant deltas', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hello' });
		c.handle({ type: 'assistant_delta', delta: 'hi ' });
		c.handle({ type: 'assistant_delta', delta: 'there' });
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
		const a = c.messages[1];
		expect(a.kind === 'assistant' && a.text).toBe('hi there');
	});

	it('sets the title from the first user message', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'Fix the bug in foo' });
		expect(c.title).toBe('Fix the bug in foo');
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

	it('aggregates a tool card by call_id and marks it done', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: '1', name: 'read' });
		c.handle({ type: 'tool_output', call_id: '1', name: 'read', output: '{"kind":"text"}', is_error: false });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false, isError: false });
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

	it('tracks busy state from engine status', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', state: 'streaming' });
		expect(c.busy).toBe(true);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.busy).toBe(false);
	});
});
