import { describe, expect, it } from 'vitest';
import { followTop, shortOfEnd } from './chatFollow';

/** A scroller 500 px high over `height` px of content, scrolled to `scrollTop`,
 *  whose latest user message starts `userAt` px into the content. */
function view(height: number, scrollTop: number, userAt: number | null) {
	const scroller = {
		scrollHeight: height,
		clientHeight: 500,
		scrollTop,
		getBoundingClientRect: () => ({ top: 0 })
	} as unknown as HTMLElement;
	const row = { getBoundingClientRect: () => ({ top: (userAt ?? 0) - scrollTop }) };
	const content = { querySelectorAll: () => (userAt === null ? [] : [row]) } as unknown as HTMLElement;
	return { scroller, content };
}

describe('followTop', () => {
	it('goes to the end while idle', () => {
		const { scroller, content } = view(2000, 100, 900);
		expect(followTop(scroller, content, false)).toBe(1500);
	});

	it('follows a short reply to the end', () => {
		const { scroller, content } = view(1300, 700, 1000);
		expect(followTop(scroller, content, true)).toBe(800);
		expect(shortOfEnd(scroller, 800)).toBe(false);
	});

	it('holds a reply that fills the view with its message at the top', () => {
		const { scroller, content } = view(3000, 700, 1000);
		expect(followTop(scroller, content, true)).toBe(984);
		expect(shortOfEnd(scroller, 984)).toBe(true);
	});

	it('never backs up to a message above the view', () => {
		const { scroller, content } = view(3000, 2400, 1000);
		expect(followTop(scroller, content, true)).toBe(2400);
		const none = view(3000, 2400, null);
		expect(followTop(none.scroller, none.content, true)).toBe(2400);
	});
});
