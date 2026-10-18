// What the reader clicks in a conversation stays where it was while the
// layout around it settles (ChatPane, RemoteSession): a card opening or
// closing, a turn's fold, a row growing under it.
//
// Scroll anchoring already keeps the view still when content above it
// changes. It can't when the content gets shorter than the view needs: a
// card closing near the end leaves the position past the new end, the
// browser pulls it back and everything jumps down. So the content gets
// room at its foot (padding) for as long as the view reaches into it, and
// gives it up as the reader scrolls away from it or the content grows into
// it again.

/** How long after a click its target is held, ms: a fold's transition and
 *  the layout after it. */
const HOLD_MS = 600;

export interface ClickAnchor {
	/** A click's target is held, or the foot has room: reaching the end now
	 *  is the view standing still, not the reader going back to it. */
	holding(): boolean;
	/** Drop the room at the foot (following the end: the end is wanted). */
	release(): void;
	destroy(): void;
}

export function clickAnchor(scroller: HTMLElement, content: HTMLElement): ClickAnchor {
	let room = 0;
	let held: { el: Element; top: number; until: number } | null = null;

	const setRoom = (px: number) => {
		px = Math.max(0, Math.round(px));
		if (px === room) return;
		room = px;
		content.style.paddingBottom = px ? `${px}px` : '';
	};
	/** Keep only the room the view still reaches into. */
	const trimRoom = () => {
		if (!room) return;
		const end = scroller.scrollHeight - room;
		setRoom(Math.min(room, scroller.scrollTop + scroller.clientHeight - end));
	};

	const hold = () => {
		if (!held) return;
		if (performance.now() > held.until || !held.el.isConnected) return void (held = null);
		const drift = held.el.getBoundingClientRect().top - held.top;
		if (Math.abs(drift) < 0.5) return;
		const want = scroller.scrollTop + drift;
		const max = scroller.scrollHeight - scroller.clientHeight;
		if (want > max) setRoom(room + want - max);
		scroller.scrollTop = want;
	};

	const onClick = (e: MouseEvent) => {
		const el = (e.target as Element | null)?.closest('button, [aria-expanded], summary');
		if (!el || !content.contains(el)) return;
		held = { el, top: el.getBoundingClientRect().top, until: performance.now() + HOLD_MS };
	};
	// The reader scrolling takes over.
	const letGo = () => (held = null);
	const onScroll = () => {
		if (!held) trimRoom();
	};
	const ro = new ResizeObserver(() => {
		if (held) hold();
		else trimRoom();
	});

	content.addEventListener('click', onClick, true);
	scroller.addEventListener('wheel', letGo, { passive: true });
	scroller.addEventListener('touchstart', letGo, { passive: true });
	scroller.addEventListener('keydown', letGo);
	scroller.addEventListener('scroll', onScroll, { passive: true });
	ro.observe(content);

	return {
		holding: () => !!held || room > 0,
		release: () => {
			held = null;
			setRoom(0);
		},
		destroy: () => {
			content.removeEventListener('click', onClick, true);
			scroller.removeEventListener('wheel', letGo);
			scroller.removeEventListener('touchstart', letGo);
			scroller.removeEventListener('keydown', letGo);
			scroller.removeEventListener('scroll', onScroll);
			ro.disconnect();
			setRoom(0);
		}
	};
}
