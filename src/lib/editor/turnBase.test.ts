import { describe, expect, it } from 'vitest';
import { hunks, turnBase } from './turnBase';

describe('turnBase', () => {
	it('undoes Claude-style pairs, a MultiEdit and edits in order', () => {
		const before = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
		// Edit 1 (MultiEdit): a → 10, c → 30. Edit 2: 10 → 100.
		const multi = '-const a = 1;\n+const a = 10;\n-const c = 3;\n+const c = 30;';
		const second = '-const a = 10;\n+const a = 100;';
		expect(hunks(multi)).toHaveLength(2);
		const now = 'const a = 100;\nconst b = 2;\nconst c = 30;\n';
		expect(turnBase(now, [multi, second])).toBe(before);
	});

	it('undoes unified hunks with context', () => {
		const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', '@@ -9,2 +9,3 @@', ' nine', '+nine and a half', ' ten'].join('\n');
		const now = 'one\nTWO\nthree\n4\n5\n6\n7\n8\nnine\nnine and a half\nten\n';
		expect(turnBase(now, [diff])).toBe('one\ntwo\nthree\n4\n5\n6\n7\n8\nnine\nten\n');
	});

	it('takes a file written whole as new', () => {
		expect(turnBase('hello\nworld\n', ['+hello\n+world\n+'])).toBe('');
	});

	it('gives up when an edit is no longer there', () => {
		expect(turnBase('changed since\n', ['-old\n+new'])).toBeNull();
		// A removal with nothing around it can't be placed.
		expect(turnBase('a\n', ['-gone'])).toBeNull();
	});
});
