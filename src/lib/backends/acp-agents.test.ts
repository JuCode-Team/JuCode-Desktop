import { describe, it, expect } from 'vitest';
import { tokenizeArgs, formatArgs, slugifyAgentId } from './acp-agents';

describe('tokenizeArgs', () => {
	it('splits on whitespace and honors quotes', () => {
		expect(tokenizeArgs('--experimental-acp')).toEqual(['--experimental-acp']);
		expect(tokenizeArgs('acp  --verbose')).toEqual(['acp', '--verbose']);
		expect(tokenizeArgs('--flag "a b" \'c d\'')).toEqual(['--flag', 'a b', 'c d']);
		expect(tokenizeArgs('')).toEqual([]);
		expect(tokenizeArgs('   ')).toEqual([]);
	});

	it('round-trips through formatArgs', () => {
		const args = ['acp', '--model', 'gemini 3 pro'];
		expect(tokenizeArgs(formatArgs(args))).toEqual(args);
		expect(formatArgs(args)).toBe('acp --model "gemini 3 pro"');
	});
});

describe('slugifyAgentId', () => {
	it('lowercases, strips punctuation and never returns empty', () => {
		expect(slugifyAgentId('Gemini CLI')).toBe('gemini-cli');
		expect(slugifyAgentId('  JuCode (ACP)!  ')).toBe('jucode-acp');
		expect(slugifyAgentId('日本語')).toBe('agent');
	});

	it('deduplicates against taken ids with a numeric suffix', () => {
		const taken = new Set(['gemini-cli', 'gemini-cli-2']);
		expect(slugifyAgentId('Gemini CLI', taken)).toBe('gemini-cli-3');
	});
});
