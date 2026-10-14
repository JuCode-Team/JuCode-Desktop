import { describe, expect, it } from 'vitest';
import { fileMention, splitMentions } from './fileMention';

describe('file mentions', () => {
	it('writes a path as a mention, quoted when it has spaces', () => {
		expect(fileMention('/a/b.ts')).toBe('@/a/b.ts');
		expect(fileMention('/a/my notes.md')).toBe('@"/a/my notes.md"');
	});

	it('splits mentioned files out of the text and leaves other @ alone', () => {
		expect(splitMentions('see @src/a.ts and @"/x/my notes.md", thanks @bob')).toEqual([
			{ text: 'see ' },
			{ text: '@src/a.ts', file: 'src/a.ts' },
			{ text: ' and ' },
			{ text: '@"/x/my notes.md"', file: '/x/my notes.md' },
			{ text: ', thanks @bob' }
		]);
	});
});
