import { describe, expect, it } from 'vitest';
import { placeFor, subagentOf, subagentPanel } from './subagentPages.svelte';

describe('subagent pages', () => {
	it('opens where a button says, whatever the setting', () => {
		for (const setting of ['side', 'tab'] as const) {
			expect(placeFor('side', setting)).toBe('side');
			expect(placeFor('tab', setting)).toBe('tab');
			expect(placeFor('default', setting)).toBe(setting);
		}
		expect(placeFor('other', 'side')).toBe('tab');
		expect(placeFor('other', 'tab')).toBe('side');
	});

	it('names the session and the agent in the panel, agent ids with colons included', () => {
		expect(subagentOf(subagentPanel('s1-a', 'agent:7'))).toEqual({ sessionId: 's1-a', agentId: 'agent:7' });
		expect(subagentOf('proposal:s1:p')).toBeNull();
		expect(subagentOf('subagent:s1:')).toBeNull();
	});
});
