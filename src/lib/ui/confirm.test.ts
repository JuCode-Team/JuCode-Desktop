import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm, confirmQueue } from './confirm.svelte';

describe('confirm', () => {
	beforeEach(() => {
		const data = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v)
		});
	});

	it("stops asking once confirmed with don't ask again, per key", async () => {
		const first = confirm({ title: 'Remove?', dontAskKey: 'remove-session' });
		expect(confirmQueue.current?.dontAskKey).toBe('remove-session');
		confirmQueue.answer(true, true);
		expect(await first).toBe(true);

		expect(await confirm({ title: 'Remove?', dontAskKey: 'remove-session' })).toBe(true);
		expect(confirmQueue.current).toBeNull();

		const other = confirm({ title: 'Close?', dontAskKey: 'remove-project' });
		expect(confirmQueue.current?.title).toBe('Close?');
		confirmQueue.answer(false);
		expect(await other).toBe(false);
	});

	it("keeps asking when the tick came with cancel", async () => {
		const first = confirm({ title: 'Remove?', dontAskKey: 'k' });
		confirmQueue.answer(false, true);
		expect(await first).toBe(false);
		const again = confirm({ title: 'Remove?', dontAskKey: 'k' });
		expect(confirmQueue.current?.title).toBe('Remove?');
		confirmQueue.answer(true);
		expect(await again).toBe(true);
	});
});
