// What the window shows right of the sidebar: one thing in front (a
// conversation or a project's page, picked in the sidebar) in the main pane,
// and tool panels (git, terminal, files, browser, a plan, the editor…) as
// tabs of up to two more panes. The panes are a tile layout (tiles.ts): a
// tool tab can be dragged onto any pane's edge to split it, or into another
// tool pane. The main pane holds only `front` and never closes. Each
// conversation (and project page) has panes of its own, which come and go
// with it. It is workspace state, saved in the workspace's `layout` field.
import {
	closeTab,
	deserializeLayout,
	findLeaf,
	leafOfTab,
	leavesOf,
	openTab,
	serializeLayout,
	singleLeafLayout,
	splitLeaf,
	type SerializedLayout,
	type TileLayout,
	type TileTab
} from './tiles';

export type View = { kind: 'chat'; id: string } | { kind: 'project'; id: string } | null;

export interface SavedView {
	v: 3;
	view: View;
	/** The panes of each conversation and project page, by viewKey. */
	layouts: Record<string, SerializedLayout>;
}

/** Which panes a view has: its conversation's, or its project page's. */
export const viewKey = (v: NonNullable<View>) => `${v.kind}:${v.id}`;

/** The main pane's one tab: whatever the sidebar put in front. */
export const FRONT = 'front';
export const frontTab: TileTab = { id: FRONT, panel: FRONT };
/** Panes at most: the main one and two for tools. */
export const MAX_PANES = 3;
/** A first tool pane's share of the window, beside the main pane. */
export const SIDE_SHARE = 0.38;

/** Tool panel keys a tab may hold: fixed ones, a plan's page
 *  (`proposal:<session>:<plan>`) and a backend's TUI (`tui:<backend>`). */
const SIDE_PANELS = new Set(['plan', 'goal', 'files', 'git', 'term', 'browser', 'audit', 'setup']);
export const isSidePanel = (key: string) => SIDE_PANELS.has(key) || key.startsWith('proposal:') || key.startsWith('tui:');

/** A tool tab: one per panel key. */
export const toolTab = (panel: string): TileTab => ({ id: panel, panel });

/** The main pane alone, with `tools` (if any) as tabs of one pane beside it. */
function basic(tools: string[], active?: string): TileLayout {
	let layout = singleLeafLayout([frontTab]);
	const [first, ...rest] = tools;
	if (!first) return layout;
	const main = leavesOf(layout.root)[0]!.id;
	const split = splitLeaf(layout, main, 'right', toolTab(first), SIDE_SHARE);
	layout = split.layout;
	for (const panel of rest) layout = openTab(layout, split.leafId, toolTab(panel));
	return active ? openTab(layout, null, toolTab(active)) : layout;
}

/** A layout as this window can show it: `front` alone in its pane, only
 *  known tool tabs, at most MAX_PANES panes. One that is not becomes the
 *  main pane with its tools beside it. */
export function normalize(layout: TileLayout | null): TileLayout {
	if (!layout?.root) return basic([]);
	let next = layout;
	for (const tab of leavesOf(next.root).flatMap((l) => l.tabs)) if (tab.id !== FRONT && !isSidePanel(tab.panel)) next = closeTab(next, tab.id);
	const tools = leavesOf(next.root)
		.flatMap((l) => l.tabs)
		.filter((x) => x.id !== FRONT)
		.map((x) => x.panel);
	const main = leafOfTab(next.root, FRONT);
	if (!main || main.tabs.length > 1 || leavesOf(next.root).length > MAX_PANES) return basic(tools);
	return next;
}

const CHAT = 'chat:';
const PROJECT = 'project:';

/** The tabs of an old tile layout (tabs for conversations and tools in
 *  any pane), with the ones in front first. */
function oldTabs(node: unknown, front: string[] = [], rest: string[] = []): { front: string[]; rest: string[] } {
	if (!node || typeof node !== 'object') return { front, rest };
	const n = node as { kind?: string; tabs?: { panel?: unknown; id?: unknown }[]; active?: unknown; a?: unknown; b?: unknown };
	if (n.kind === 'leaf' && Array.isArray(n.tabs)) {
		for (const tab of n.tabs) if (typeof tab.panel === 'string') (tab.id === n.active ? front : rest).push(tab.panel);
	} else {
		oldTabs(n.a, front, rest);
		oldTabs(n.b, front, rest);
	}
	return { front, rest };
}

/**
 * What to show when a workspace loads: the saved view while what it names
 * still exists, else `seed` (the session restore made active), and the panes
 * of the conversations and project pages still there. Older saves give their
 * panes to the view they show: one tool beside the conversation (v2), or a
 * tile layout of conversation tabs (its tool tabs).
 */
export function restoreView(
	raw: unknown,
	sessions: string[],
	projects: string[],
	seed: string | null
): { view: View; layouts: Record<string, TileLayout> } {
	const live = (v: View): View => {
		if (v?.kind === 'chat' && sessions.includes(v.id)) return v;
		if (v?.kind === 'project' && projects.includes(v.id)) return v;
		return null;
	};
	const fallback: View = seed && sessions.includes(seed) ? { kind: 'chat', id: seed } : null;
	const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
	const withPanes = (view: View, layout: TileLayout) => ({ view, layouts: view ? { [viewKey(view)]: layout } : {} });
	if (o?.v === 3) {
		const view = live((o.view as View) ?? null) ?? fallback;
		const known = new Set([...sessions.map((id) => `chat:${id}`), ...projects.map((id) => `project:${id}`)]);
		const layouts: Record<string, TileLayout> = {};
		const saved = o.layouts && typeof o.layouts === 'object' ? (o.layouts as Record<string, unknown>) : {};
		for (const [key, layout] of Object.entries(saved)) if (known.has(key)) layouts[key] = normalize(deserializeLayout(layout));
		return { view, layouts };
	}
	if (o?.v === 2) {
		const side = typeof o.side === 'string' && isSidePanel(o.side) ? [o.side] : [];
		return withPanes(live((o.view as View) ?? null) ?? fallback, basic(side));
	}
	if (o && 'root' in o) {
		const { front, rest } = oldTabs(o.root);
		const all = [...front, ...rest];
		const layout = basic(all.filter(isSidePanel), front.find(isSidePanel));
		for (const panel of all) {
			const view = live(
				panel.startsWith(CHAT) ? { kind: 'chat', id: panel.slice(CHAT.length) } : panel.startsWith(PROJECT) ? { kind: 'project', id: panel.slice(PROJECT.length) } : null
			);
			if (view) return withPanes(view, layout);
		}
		return withPanes(fallback, layout);
	}
	return { view: fallback, layouts: {} };
}

export function saveView(view: View, layouts: Record<string, TileLayout>): SavedView {
	return { v: 3, view, layouts: Object.fromEntries(Object.entries(layouts).map(([key, layout]) => [key, serializeLayout(layout)])) };
}

/** The main pane alone: a view's panes before it opens a tool. */
export const bare = () => basic([]);

/**
 * Tool `panel` as a tab: shown again where it is, else in the tool pane last
 * used (`recent`), else in the first tool pane, else in a new pane beside
 * the main one. Tools open there by default; another pane is the user's
 * (drag a tab onto an edge).
 */
export function openTool(layout: TileLayout, panel: string, recent: string | null): TileLayout {
	if (leafOfTab(layout.root, panel)) return openTab(layout, null, toolTab(panel));
	const tools = leavesOf(layout.root).filter((l) => !l.tabs.some((x) => x.id === FRONT));
	const target = (recent && tools.find((l) => l.id === recent)) || tools[0];
	if (target) return openTab(layout, target.id, toolTab(panel));
	const main = leafOfTab(layout.root, FRONT);
	return main ? splitLeaf(layout, main.id, 'right', toolTab(panel), SIDE_SHARE).layout : layout;
}

/** Whether a tab dropped on `zone` of pane `leafId` may land there: never
 *  into the main pane's stack, and an edge only while a pane is left to make
 *  (or the tab's own pane goes away with it). */
export function canDrop(layout: TileLayout, tabId: string, leafId: string, zone: 'center' | 'left' | 'right' | 'top' | 'bottom'): boolean {
	const target = findLeaf(layout.root, leafId);
	if (!target || tabId === FRONT) return false;
	if (zone === 'center') return !target.tabs.some((x) => x.id === FRONT);
	const source = leafOfTab(layout.root, tabId);
	const leaving = !!source && source.tabs.length === 1 && source.id !== leafId;
	return leavesOf(layout.root).length < MAX_PANES || leaving;
}

/** Conversations kept mounted (hidden) after they leave the front, so going
 *  back to one keeps its scroll and is instant: the latest few. */
export const KEPT = 6;

export function keep(kept: string[], id: string): string[] {
	return [id, ...kept.filter((x) => x !== id)].slice(0, KEPT);
}
