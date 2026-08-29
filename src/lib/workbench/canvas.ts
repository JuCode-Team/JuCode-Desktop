// Unified canvas tabs: everything right of the navigator is ONE mosaic whose
// tabs are chat sessions (`chat:<sessionId>`), tool panels (plan / git / term
// / …), native TUI tabs (`tui:<backend>`) and the audit pane. Pure data —
// layout transforms come from tiles.ts, this module only adds the chat-tab
// naming plus the reconcile/migration step run when a workspace loads.

import {
	closeTab,
	deserializeLayout,
	emptyLayout,
	leavesOf,
	openTab,
	singleLeafLayout,
	wrapRoot,
	type TileLayout,
	type TileTab
} from './tiles';

export const CHAT_PREFIX = 'chat:';

/** A chat tile's share of the canvas when grafted beside an old dock layout. */
export const CHAT_SEED_RATIO = 0.58;

/** Panel kind (and tab id) of a session's chat tile — one tile per session,
 *  so the id can be derived from the session id. */
export function chatPanel(sessionId: string): string {
	return `${CHAT_PREFIX}${sessionId}`;
}

/** The session id a `chat:*` panel kind renders, or null for any other kind. */
export function chatSessionOf(panel: string): string | null {
	return panel.startsWith(CHAT_PREFIX) && panel.length > CHAT_PREFIX.length
		? panel.slice(CHAT_PREFIX.length)
		: null;
}

export function chatTab(sessionId: string): TileTab {
	return { id: chatPanel(sessionId), panel: chatPanel(sessionId) };
}

/** Session ids of every chat tile in the layout (DFS / visual order). */
export function chatSessionsIn(layout: TileLayout): string[] {
	return leavesOf(layout.root)
		.flatMap((l) => l.tabs)
		.map((t) => chatSessionOf(t.panel))
		.filter((s): s is string => s !== null);
}

/** Open (or re-activate) the chat tile for `sessionId`, landing in `leafId`. */
export function openChatTab(
	layout: TileLayout,
	leafId: string | null,
	sessionId: string
): TileLayout {
	return openTab(layout, leafId, chatTab(sessionId));
}

/**
 * Build the canvas from a persisted layout blob when a workspace loads:
 * - chat tiles whose session no longer exists this run are dropped (session
 *   ids are minted per run, so most restarts land here);
 * - a layout left without any chat tile gets one seeded for `seedSessionId` —
 *   an old dock-only layout keeps its panel arrangement and gains a chat leaf
 *   on the left (the pre-canvas shape, chat | panels);
 * - garbage / absent input falls back to a single chat leaf (or an empty
 *   canvas when there is no session to seed).
 */
export function reconcileLayout(
	raw: unknown,
	liveSessionIds: string[],
	seedSessionId: string | null
): TileLayout {
	let layout = deserializeLayout(raw) ?? emptyLayout();
	const live = new Set(liveSessionIds);
	for (const leaf of leavesOf(layout.root)) {
		for (const tab of leaf.tabs) {
			const sid = chatSessionOf(tab.panel);
			if (sid && !live.has(sid)) layout = closeTab(layout, tab.id);
		}
	}
	if (!seedSessionId || chatSessionsIn(layout).length) return layout;
	if (!layout.root) return singleLeafLayout([chatTab(seedSessionId)]);
	return wrapRoot(layout, 'left', chatTab(seedSessionId), CHAT_SEED_RATIO);
}
