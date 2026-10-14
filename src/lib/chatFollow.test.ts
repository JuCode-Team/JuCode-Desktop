import { describe, expect, it } from 'vitest';
import { followAfterScroll, followTop, shortOfEnd } from './chatFollow';

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

describe('followAfterScroll', () => {
	it('follows at the end, also after a small bounce back up', () => {
		const { scroller } = view(2000, 1499, null);
		expect(followAfterScroll(false, scroller, 1500, 2000)).toBe(true);
	});

	it('stops when the reader scrolls up', () => {
		const { scroller } = view(2000, 1300, null);
		expect(followAfterScroll(true, scroller, 1400, 2000)).toBe(false);
	});

	it('keeps following when shorter content pulled the position back', () => {
		// A tool card folded: the content lost 300 px and the browser moved
		// the position up with it.
		const { scroller } = view(1700, 1100, null);
		expect(followAfterScroll(true, scroller, 1500, 2000)).toBe(true);
	});

	it('follows again near the end, and leaves it alone further away', () => {
		expect(followAfterScroll(false, view(2000, 1460, null).scroller, 1400, 2000)).toBe(true);
		expect(followAfterScroll(false, view(2000, 900, null).scroller, 800, 2000)).toBe(false);
		// A jump to the end still under way.
		expect(followAfterScroll(true, view(2000, 900, null).scroller, 800, 2000)).toBe(true);
	});
});
