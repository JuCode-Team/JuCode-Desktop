import { describe, expect, it } from 'vitest';
import { attachmentToken, expandAttachments, fmtSize, tokenIds, type Attachment } from './attachments';

const img = (id: number): Attachment => ({ id, path: `/tmp/${id}.png`, image: true });
const file = (id: number): Attachment => ({ id, path: `/src/${id}.ts`, image: false });

describe('attachments', () => {
	it('numbers images by their order among the sent images', () => {
		const list = [img(3), file(4), img(7)];
		expect(expandAttachments(`see ${attachmentToken(7)} and ${attachmentToken(3)}`, list)).toBe('see [图片 #2] and [图片 #1]');
	});

	it('names a file in place (the file goes as an attachment) and drops placeholders of removed ones', () => {
		expect(expandAttachments(`${attachmentToken(4)} ${attachmentToken(9)}fix`, [file(4)])).toBe('4.ts fix');
	});

	it('finds the placeholders in a text', () => {
		expect(tokenIds(`a${attachmentToken(1)}b${attachmentToken(12)}`)).toEqual(new Set([1, 12]));
	});

	it('formats sizes', () => {
		expect(fmtSize(512)).toBe('512 B');
		expect(fmtSize(58 * 1024 + 100)).toBe('58 KB');
		expect(fmtSize(3.25 * 1024 * 1024)).toBe('3.3 MB');
	});
});
