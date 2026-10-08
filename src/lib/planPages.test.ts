import { describe, it, expect } from 'vitest';
import { planBlocks, proposalOf, proposalPanel } from './planPages.svelte';

describe('plan pages', () => {
	it('names a session and a plan in the panel and reads them back', () => {
		expect(proposalOf(proposalPanel('s1', 'plan-2'))).toEqual({ sessionId: 's1', planId: 'plan-2' });
		expect(proposalOf(proposalPanel('s1', 'a:b'))).toEqual({ sessionId: 's1', planId: 'a:b' });
		expect(proposalOf('plan')).toBeNull();
		expect(proposalOf('browser')).toBeNull();
	});

	it('splits a plan into blocks and keeps a code fence whole', () => {
		const text = '## Goal\n\nDo it.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n- one\n- two\n';
		expect(planBlocks(text)).toEqual(['## Goal', 'Do it.', '```ts\nconst a = 1;\n\nconst b = 2;\n```', '- one\n- two']);
		expect(planBlocks('')).toEqual([]);
	});
});
