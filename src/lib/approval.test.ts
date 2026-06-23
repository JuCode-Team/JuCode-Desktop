import { describe, it, expect } from 'vitest';
import { shouldAutoApprove } from './approval';

describe('shouldAutoApprove', () => {
	it("'ask' never auto-approves", () => {
		expect(shouldAutoApprove('ask', 'apply_patch')).toBe(false);
		expect(shouldAutoApprove('ask', 'bash')).toBe(false);
	});

	it("'edits' auto-approves file mutations only", () => {
		expect(shouldAutoApprove('edits', 'str_replace')).toBe(true);
		expect(shouldAutoApprove('edits', 'write')).toBe(true);
		expect(shouldAutoApprove('edits', 'bash')).toBe(false);
		expect(shouldAutoApprove('edits', 'exec_command')).toBe(false);
	});

	it("'all' auto-approves everything", () => {
		expect(shouldAutoApprove('all', 'bash')).toBe(true);
		expect(shouldAutoApprove('all', 'apply_patch')).toBe(true);
	});
});
