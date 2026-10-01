import { describe, it, expect } from 'vitest';
import { ChatState } from './chat.svelte';
import { sessionStatus } from './sessionStatus';

describe('sessionStatus', () => {
	it('is idle by default and ranks what needs the user first', () => {
		const c = new ChatState();
		c.engineState = 'ready';
		expect(sessionStatus(c)).toBeNull();
		c.unseen = true;
		expect(sessionStatus(c)?.kind).toBe('unread');
		c.engineState = 'streaming';
		expect(sessionStatus(c)?.kind).toBe('running');
		c.handle({ type: 'error', message: 'boom' });
		c.engineState = 'ready';
		expect(sessionStatus(c)).toEqual({ kind: 'failed', message: 'boom' });
		c.pendingApproval = { callId: 'x', name: 'bash', summary: '', subagentId: null, hunks: null };
		expect(sessionStatus(c)).toEqual({ kind: 'input', ask: 'approve' });
		c.pendingApproval = { ...c.pendingApproval, questions: [{ question: 'q', options: [] } as never] };
		expect(sessionStatus(c)).toEqual({ kind: 'input', ask: 'answer' });
	});

	it('clears a failure when the next turn starts', () => {
		const c = new ChatState();
		c.engineState = 'ready';
		c.handle({ type: 'error', message: 'boom' });
		c.optimisticUser('again');
		expect(sessionStatus(c)?.kind).not.toBe('failed');
	});
});

describe('plan usage', () => {
	it('keeps the engine’s latest windows and drops an empty report', () => {
		const c = new ChatState();
		c.handle({ type: 'plan_usage', plan: 'plus', windows: [{ key: 'primary', used: 37, resets_at: 5, minutes: 300 }] });
		expect(c.planUsage).toEqual({ plan: 'plus', windows: [{ key: 'primary', used: 37, resetsAt: 5, minutes: 300 }] });
		c.handle({ type: 'plan_usage', plan: null, windows: [] });
		expect(c.planUsage).toBeNull();
		c.handle({ type: 'plan_usage', plan: 'plus', windows: [{ key: 'primary', used: 1 }] });
		c.handle({ type: 'startup', model: 'x' });
		expect(c.planUsage).toBeNull();
	});
});

describe('engine errors', () => {
	it('shows one failure reported twice once', () => {
		const c = new ChatState();
		c.handle({ type: 'error', message: 'unexpected status 401 Unauthorized' });
		c.handle({ type: 'error', message: 'unexpected status 401 Unauthorized' });
		expect(c.messages.filter((m) => m.kind === 'error')).toHaveLength(1);
	});
});
