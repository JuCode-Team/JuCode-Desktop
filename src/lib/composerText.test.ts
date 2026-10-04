import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadComposerText, saveComposerText } from './composerText';

describe('composer text', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('keeps unsent text per key and forgets blank text', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v),
			removeItem: (k: string) => store.delete(k)
		});
		saveComposerText('a', 'half a thought');
		saveComposerText('b', 'other');
		expect(loadComposerText('a')).toBe('half a thought');
		saveComposerText('a', '  ');
		expect(loadComposerText('a')).toBe('');
		expect(store.size).toBe(1);
	});

	it('works without localStorage', () => {
		saveComposerText('a', 'x');
		expect(loadComposerText('a')).toBe('');
	});
});
