// Chat-session tabs inside the main (center) tile layout. A tab whose id/panel
// is `chat:<sessionId>` renders that session's full chat pane; the helpers here
// keep the layout in sync with the session tree (open/activate on selection,
// prune when sessions close) and translate between runtime session ids and the
// persisted engine session ids (runtime ids are regenerated every launch).
// Framework-free, pure transforms over tiles.ts — identity-stable when nothing
// changes, so reactive callers can persist on reference change.

import {
	activateTab,
	closeTab,
	findLeaf,
	leafOfTab,
	openTab,
	type LeafNode,
	type TileLayout,
	type TileNode,
	type TileTab
} from './tiles';

export const CHAT_PANEL_PREFIX = 'chat:';

/** Tab id (= panel kind) for a session's chat tab. */
export function chatTabId(sessionId: string): string {
	return `${CHAT_PANEL_PREFIX}${sessionId}`;
}

/** The session id a `chat:*` tab id / panel kind refers to, or null. */
export function chatSessionOf(id: string): string | null {
	return id.startsWith(CHAT_PANEL_PREFIX) && id.length > CHAT_PANEL_PREFIX.length
		? id.slice(CHAT_PANEL_PREFIX.length)
		: null;
}

export function chatTab(sessionId: string): TileTab {
	const id = chatTabId(sessionId);
	return { id, panel: id };
}

/**
 * Make the session's tab visible and active: an existing tab is activated in
 * place (wherever it lives), otherwise a new tab opens in `leafId` (the focused
 * leaf; null falls back to the first leaf, or a fresh root leaf in an empty
 * tree). Identity-stable when the tab is already active.
 */
export function ensureChatTab(layout: TileLayout, sessionId: string, leafId: string | null): TileLayout {
	const id = chatTabId(sessionId);
	if (leafOfTab(layout.root, id)) return activateTab(layout, id);
	return openTab(layout, leafId, chatTab(sessionId));
}

/**
 * Remove every chat tab whose session id fails `keep` (session closed or
 * archived). Emptied leaves collapse via closeTab; non-chat tabs are untouched.
 */
export function pruneChatTabs(layout: TileLayout, keep: (sessionId: string) => boolean): TileLayout {
	let next = layout;
	// Collect first: closeTab reshapes the tree while we iterate.
	const dead: string[] = [];
	const walk = (n: TileNode | null) => {
		if (!n) return;
		if (n.kind === 'leaf') {
			for (const tab of n.tabs) {
				const sid = chatSessionOf(tab.id);
				if (sid && !keep(sid)) dead.push(tab.id);
			}
			return;
		}
		walk(n.a);
		walk(n.b);
	};
	walk(layout.root);
	for (const id of dead) next = closeTab(next, id);
	return next;
}

/** Rebuild a leaf with its chat tabs mapped; null for an emptied leaf. */
function mapLeaf(leaf: LeafNode, map: (sessionId: string) => string | null): LeafNode | null {
	let changed = false;
	const tabs: TileTab[] = [];
	let active = leaf.active;
	for (const tab of leaf.tabs) {
		const sid = chatSessionOf(tab.id);
		if (!sid) {
			tabs.push(tab);
			continue;
		}
		const to = map(sid);
		if (to == null) {
			changed = true;
			if (active === tab.id) active = '';
			continue;
		}
		if (to === sid) {
			tabs.push(tab);
			continue;
		}
		changed = true;
		const nid = chatTabId(to);
		if (active === tab.id) active = nid;
		tabs.push({ id: nid, panel: nid });
	}
	if (!changed) return leaf;
	if (!tabs.length) return null;
	if (!tabs.some((t) => t.id === active)) active = tabs[0].id;
	return { ...leaf, tabs, active };
}

function mapNode(node: TileNode | null, map: (sessionId: string) => string | null): TileNode | null {
	if (!node) return null;
	if (node.kind === 'leaf') return mapLeaf(node, map);
	const a = mapNode(node.a, map);
	const b = mapNode(node.b, map);
	if (a === node.a && b === node.b) return node;
	if (!a) return b;
	if (!b) return a;
	return { ...node, a, b };
}

/**
 * Rewrite every chat tab's session id through `map` — null drops the tab (its
 * session won't exist on the other side). Used both ways around persistence:
 * runtime ids → engine session ids on save, engine ids → the freshly restored
 * runtime ids on load. Leaf/split node ids survive the round trip, so the
 * arrangement (including `maximized`) is preserved.
 */
export function remapChatTabs(layout: TileLayout, map: (sessionId: string) => string | null): TileLayout {
	const root = mapNode(layout.root, map);
	if (root === layout.root) return layout;
	const maximized = layout.maximized && root && findLeaf(root, layout.maximized) ? layout.maximized : null;
	return { root, maximized };
}
