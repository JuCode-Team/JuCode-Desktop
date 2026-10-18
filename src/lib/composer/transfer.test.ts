import { describe, it, expect } from 'vitest';
import { PendingSaves, takeTransfer } from './transfer';

type Item = { kind: string; type: string; getAsFile: () => File | null };

const file = (type: string): Item => ({ kind: 'file', type, getAsFile: () => new File([new Uint8Array([1])], 'x', { type }) });
const str = (type: string): Item => ({ kind: 'string', type, getAsFile: () => null });
const transfer = (items: Item[], data: Record<string, string>) => ({
	items,
	getData: (k: string) => data[k] ?? ''
});

describe('takeTransfer', () => {
	it('takes every pasted image as a file, in order, and no text', () => {
		const t = takeTransfer(transfer([file('image/png'), file('image/jpeg')], { 'text/plain': 'Screenshot.png' }));
		expect(t.images.map((i) => i.ext)).toEqual(['png', 'jpeg']);
		expect(t.text).toBe('');
	});

	it('takes HTML with an <img> as its plain text only', () => {
		const t = takeTransfer(
			transfer([str('text/html'), str('text/plain')], { 'text/html': '<p>hi <img src="data:image/png;base64,AA"></p>', 'text/plain': 'hi ' })
		);
		expect(t).toEqual({ images: [], text: 'hi ' });
	});

	it('takes nothing from HTML that has no plain text', () => {
		expect(takeTransfer(transfer([str('text/html')], { 'text/html': '<img src="x.png">' }))).toEqual({ images: [], text: '' });
	});

	it('ignores files that are not images', () => {
		expect(takeTransfer(transfer([file('application/pdf')], { 'text/plain': 'a.pdf' }))).toEqual({ images: [], text: 'a.pdf' });
	});

	it('names an image of unknown subtype png', () => {
		expect(takeTransfer(transfer([file('image/')], {})).images[0]!.ext).toBe('png');
	});
});

describe('PendingSaves', () => {
	it('holds a send until the pasted images are saved', async () => {
		const saves = new PendingSaves();
		const attached: string[] = [];
		const sent: string[][] = [];
		let save!: () => void;
		const saving = saves.track(async () => {
			await new Promise<void>((r) => (save = r));
			attached.push('/tmp/paste.png');
		});
		// Enter right after the paste.
		saves.send(() => sent.push([...attached]));
		expect(sent).toEqual([]);
		save();
		await saving;
		expect(sent).toEqual([['/tmp/paste.png']]);
	});

	it('sends at once with nothing being saved, and after a failed save', async () => {
		const saves = new PendingSaves();
		let sent = 0;
		saves.send(() => sent++);
		expect(sent).toBe(1);
		const failed = saves.track(async () => {
			throw new Error('disk full');
		});
		saves.send(() => sent++);
		await failed.catch(() => {});
		expect(sent).toBe(2);
	});
});
