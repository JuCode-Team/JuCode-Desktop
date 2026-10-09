import { describe, expect, it } from 'vitest';
import { stableBlocks } from './streamBlocks';

const texts = (done: string) => stableBlocks(done).map((b) => b.text);

describe('stableBlocks', () => {
	it('splits two paragraphs into two chunks', () => {
		expect(texts('One.\n\nTwo.\n\n')).toEqual(['One.\n\n', 'Two.\n\n']);
	});

	it('keeps a list with blank lines between items, and its continuations, one chunk', () => {
		const list = '1. a\n\n2. b\n\n   more about b\n\n- c\n\n';
		expect(texts(list)).toEqual([list]);
		expect(texts(`${list}After.\n\n`)).toEqual([list, 'After.\n\n']);
	});

	it('keeps indented code with a blank line one chunk', () => {
		const code = '    a()\n\n    b()\n\n';
		expect(texts(`${code}After.\n\n`)).toEqual([code, 'After.\n\n']);
	});

	it('never splits inside a fence', () => {
		const fence = '```\na\n\nb\n```\n\n';
		expect(texts(`${fence}Next.\n\n`)).toEqual([fence, 'Next.\n\n']);
	});

	it('keeps the trailing blank in the last chunk and its key once the next block comes', () => {
		const [first] = stableBlocks('One.\n\n');
		expect(stableBlocks('One.\n\nTwo.\n\n')[0]).toEqual(first);
	});
});
