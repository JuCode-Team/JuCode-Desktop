import { describe, it, expect } from 'vitest';
import {
	canHandOffToTui,
	isValidResumeSessionId,
	tuiResumeArgs,
	tuiResumeCommand
} from './tuiHandoff';

const SID = '0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f';

describe('isValidResumeSessionId', () => {
	it('accepts uuid-like ids (mirrors rust is_valid_session_id)', () => {
		expect(isValidResumeSessionId(SID)).toBe(true);
		expect(isValidResumeSessionId('abc123')).toBe(true);
		expect(isValidResumeSessionId('a'.repeat(64))).toBe(true);
	});

	it('rejects flag-like, whitespace, unicode and oversized ids', () => {
		for (const bad of [
			'',
			'-x',
			'--resume',
			'a b',
			'../etc/passwd',
			'a_b',
			'ID;rm',
			'会话id',
			'a'.repeat(65)
		]) {
			expect(isValidResumeSessionId(bad), JSON.stringify(bad)).toBe(false);
		}
	});
});

describe('canHandOffToTui', () => {
	it('allows the three native CLIs and never acp', () => {
		expect(canHandOffToTui('jucode')).toBe(true);
		expect(canHandOffToTui('claude')).toBe(true);
		expect(canHandOffToTui('codex')).toBe(true);
		expect(canHandOffToTui('acp')).toBe(false);
	});
});

describe('tuiResumeArgs / tuiResumeCommand', () => {
	it('builds the per-backend resume argv the rust allowlist accepts', () => {
		expect(tuiResumeArgs('claude', SID)).toEqual(['--resume', SID]);
		expect(tuiResumeArgs('codex', SID)).toEqual(['resume', SID]);
		// jucode resumes via the slash command written into the pty, not argv.
		expect(tuiResumeArgs('jucode', SID)).toEqual([]);
		expect(tuiResumeCommand('jucode', SID)).toBe(`/resume ${SID}\n`);
		expect(tuiResumeCommand('claude', SID)).toBeUndefined();
		expect(tuiResumeCommand('codex', SID)).toBeUndefined();
	});

	it('emits nothing for an invalid id', () => {
		expect(tuiResumeArgs('claude', '--help')).toEqual([]);
		expect(tuiResumeArgs('codex', '')).toEqual([]);
		expect(tuiResumeCommand('jucode', 'a b')).toBeUndefined();
	});
});
