// Where a conversation's scroller goes as its content grows while it follows
// the end (ChatPane, RemoteSession).

/** Space kept above the latest message once a reply has filled the view. */
const REPLY_TOP_GAP = 16;

/** The scroll position to follow to. Idle (a conversation loading): the end.
 *  While a reply streams: the end only until the latest user message reaches
 *  the top, so the text being read never moves; never back up. */
export function followTop(scroller: HTMLElement, content: HTMLElement, streaming: boolean): number {
	const end = scroller.scrollHeight - scroller.clientHeight;
	if (!streaming) return end;
	const rows = content.querySelectorAll<HTMLElement>('.row.user');
	const last = rows[rows.length - 1];
	if (!last) return scroller.scrollTop;
	const top = scroller.scrollTop + last.getBoundingClientRect().top - scroller.getBoundingClientRect().top - REPLY_TOP_GAP;
	return Math.max(scroller.scrollTop, Math.min(end, top));
}

/** How far the scroller is from its end, px. */
export function fromEnd(scroller: HTMLElement): number {
	return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
}

/** Follow the end or not, after a scroll event the app did not cause.
 *  At the end it follows; scrolled up it stops, unless the content got
 *  shorter (the browser pulled the position back, the reader did not
 *  move); near the end it follows again; otherwise nothing changes, so a
 *  jump to the end keeps following through its animation. */
export function followAfterScroll(following: boolean, scroller: HTMLElement, lastTop: number, lastHeight: number): boolean {
	const gap = fromEnd(scroller);
	if (gap < 2) return true;
	if (scroller.scrollTop < lastTop && scroller.scrollHeight >= lastHeight) return false;
	return gap < 60 ? true : following;
}

/** Whether `top` is short of the end, so following stops there. */
export function shortOfEnd(scroller: HTMLElement, top: number): boolean {
	return top < scroller.scrollHeight - scroller.clientHeight - 1;
}
