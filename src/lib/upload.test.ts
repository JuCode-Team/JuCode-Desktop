import { describe, expect, it, vi } from 'vitest';
import { uploadFile } from './upload';

describe('uploadFile', () => {
	it('sends chunks one after another, each acknowledged, and returns the path', async () => {
		const bytes = new Uint8Array(600 * 1024).map((_, i) => i % 251);
		const received: Uint8Array[] = [];
		const request = vi.fn(async (op: Record<string, unknown>) => {
			received.push(Uint8Array.from(atob(String(op.data)), (c) => c.charCodeAt(0)));
			const size = received.reduce((n, b) => n + b.length, 0);
			return op.last
				? { type: 'uploaded', upload: 'u-1', path: '/home/u/.jucode/uploads/u-1-a.bin', name: 'a.bin', size, image: false }
				: { type: 'upload_part', upload: 'u-1', size };
		});
		const progress: number[] = [];
		const done = await uploadFile({ request }, new Blob([bytes]), 'a.bin', (sent) => progress.push(sent));
		expect(done.path).toBe('/home/u/.jucode/uploads/u-1-a.bin');
		const ops = request.mock.calls.map(([op]) => op);
		expect(ops.map((op) => [op.upload, op.offset, op.last])).toEqual([
			[undefined, undefined, false],
			['u-1', 256 * 1024, false],
			['u-1', 512 * 1024, true]
		]);
		expect(ops[0].name).toBe('a.bin');
		const joined = new Uint8Array(received.reduce((n, b) => n + b.length, 0));
		received.reduce((at, b) => (joined.set(b, at), at + b.length), 0);
		expect(joined).toEqual(bytes);
		expect(progress.at(-1)).toBe(bytes.length);
	});

	it('sends an empty file as one last chunk', async () => {
		const request = vi.fn(async () => ({ upload: 'u-2', path: '/p', name: 'e', size: 0, image: false }));
		await uploadFile({ request }, new Blob([]), 'e');
		expect(request).toHaveBeenCalledWith({ op: 'upload', name: 'e', data: '', last: true });
	});
});
