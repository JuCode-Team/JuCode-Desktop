// Handmade binary tile/split tree for the workbench ("mosaic") layout.
//
// Framework-free, pure data + pure transforms: every operation returns a new
// layout (structural sharing, untouched subtrees keep their identity) so the
// caller can hold the layout in reactive state and persist on change. No DOM,
// no Svelte — see docs/workbench-plan.md §3.2 for why this is hand-rolled
// instead of pulling in a panel framework.
//
// Shape: an inner node splits its area between exactly two children (row =
// side by side, col = stacked) at `ratio`; a leaf is a tab stack (several
// tabs, one active). Maximize is layout state *next to* the tree — restoring
// never has to rebuild anything, it just clears `maximized`.

export type SplitDir = 'row' | 'col';

/** Where a dragged tab lands on a leaf: its stack, or one of the four edges. */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface TileTab {
	/** Unique across the whole tree — a tab lives in exactly one leaf. */
	id: string;
	/** What the tab shows (panel kind); the UI maps this to a component. */
	panel: string;
}

export interface LeafNode {
	kind: 'leaf';
	id: string;
	tabs: TileTab[];
	/** Active tab id ('' only for a leaf about to be collapsed away). */
	active: string;
}

export interface SplitNode {
	kind: 'split';
	id: string;
	dir: SplitDir;
	/** Share of the area given to `a` (clamped to RATIO_MIN..RATIO_MAX). */
	ratio: number;
	a: TileNode;
	b: TileNode;
}

export type TileNode = LeafNode | SplitNode;

export interface TileLayout {
	root: TileNode | null;
	/** Leaf shown full-bleed (dblclick semantic); null = normal tiling. */
	maximized: string | null;
}

export const RATIO_MIN = 0.15;
export const RATIO_MAX = 0.85;

export const LAYOUT_VERSION = 1;

export interface SerializedLayout {
	version: number;
	root: TileNode | null;
	maximized: string | null;
}

let counter = 0;
const newId = (prefix: string) =>
	`${prefix}${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const clampRatio = (r: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));

export function makeLeaf(tabs: TileTab[], active?: string): LeafNode {
	return {
		kind: 'leaf',
		id: newId('l'),
		tabs,
		active: active && tabs.some((t) => t.id === active) ? active : (tabs[0]?.id ?? '')
	};
}

export function emptyLayout(): TileLayout {
	return { root: null, maximized: null };
}

/** A layout with a single leaf holding `tabs` (the pre-mosaic dock shape). */
export function singleLeafLayout(tabs: TileTab[], active?: string): TileLayout {
	return { root: tabs.length ? makeLeaf(tabs, active) : null, maximized: null };
}

/** All leaves in DFS order (a before b) — the visual reading order. */
export function leavesOf(node: TileNode | null): LeafNode[] {
	if (!node) return [];
	if (node.kind === 'leaf') return [node];
	return [...leavesOf(node.a), ...leavesOf(node.b)];
}

export function findLeaf(node: TileNode | null, leafId: string): LeafNode | null {
	return leavesOf(node).find((l) => l.id === leafId) ?? null;
}

/** The leaf holding `tabId`, or null. */
export function leafOfTab(node: TileNode | null, tabId: string): LeafNode | null {
	return leavesOf(node).find((l) => l.tabs.some((t) => t.id === tabId)) ?? null;
}

// ---------- internal rebuilding helpers ----------

/** Replace the leaf `leafId` with `replacement` (null = delete it, letting the
 *  sibling take the split's whole area). Untouched subtrees are reused. */
function replaceLeaf(node: TileNode, leafId: string, replacement: TileNode | null): TileNode | null {
	if (node.kind === 'leaf') return node.id === leafId ? replacement : node;
	const a = replaceLeaf(node.a, leafId, replacement);
	const b = replaceLeaf(node.b, leafId, replacement);
	if (a === node.a && b === node.b) return node;
	if (!a) return b;
	if (!b) return a;
	return { ...node, a, b };
}

function mapLeaf(node: TileNode, leafId: string, fn: (leaf: LeafNode) => LeafNode): TileNode {
	if (node.kind === 'leaf') return node.id === leafId ? fn(node) : node;
	const a = mapLeaf(node.a, leafId, fn);
	const b = mapLeaf(node.b, leafId, fn);
	return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Drop `maximized` when the leaf it pointed at no longer exists. */
function fixMaximized(layout: TileLayout): TileLayout {
	if (layout.maximized && !findLeaf(layout.root, layout.maximized)) {
		return { ...layout, maximized: null };
	}
	return layout;
}

// ---------- operations ----------

/** Add `tab` to leaf `leafId` (or the first leaf; or a fresh root leaf when the
 *  tree is empty) and activate it. A tab id that already exists anywhere in the
 *  tree is activated in place instead — tab ids are unique across the tree. */
export function openTab(layout: TileLayout, leafId: string | null, tab: TileTab): TileLayout {
	const existing = leafOfTab(layout.root, tab.id);
	if (existing) return activateTab(layout, tab.id);
	if (!layout.root) return { ...layout, root: makeLeaf([tab]) };
	const target = (leafId && findLeaf(layout.root, leafId)) || leavesOf(layout.root)[0];
	const root = mapLeaf(layout.root, target.id, (l) => ({
		...l,
		tabs: [...l.tabs, tab],
		active: tab.id
	}));
	return { ...layout, root };
}

export function activateTab(layout: TileLayout, tabId: string): TileLayout {
	const leaf = leafOfTab(layout.root, tabId);
	if (!leaf || !layout.root || leaf.active === tabId) return layout;
	const root = mapLeaf(layout.root, leaf.id, (l) => ({ ...l, active: tabId }));
	return { ...layout, root };
}

/** Remove a tab. A leaf left empty collapses: its split parent is replaced by
 *  the sibling (root leaf → empty tree). Activation moves to the neighbor tab. */
export function closeTab(layout: TileLayout, tabId: string): TileLayout {
	const leaf = leafOfTab(layout.root, tabId);
	if (!leaf || !layout.root) return layout;
	if (leaf.tabs.length === 1) {
		return fixMaximized({ ...layout, root: replaceLeaf(layout.root, leaf.id, null) });
	}
	const idx = leaf.tabs.findIndex((t) => t.id === tabId);
	const tabs = leaf.tabs.filter((t) => t.id !== tabId);
	const active = leaf.active === tabId ? tabs[Math.min(idx, tabs.length - 1)].id : leaf.active;
	const root = mapLeaf(layout.root, leaf.id, (l) => ({ ...l, tabs, active }));
	return { ...layout, root };
}

/** Split leaf `leafId`, seeding the new sibling leaf with `tab`. left/top put
 *  the new leaf before the target, right/bottom after. Returns the new layout
 *  and the created leaf's id (for follow-up focus). */
export function splitLeaf(
	layout: TileLayout,
	leafId: string,
	zone: Exclude<DropZone, 'center'>,
	tab: TileTab
): { layout: TileLayout; leafId: string } {
	const target = layout.root && findLeaf(layout.root, leafId);
	if (!target || !layout.root) return { layout, leafId };
	const fresh = makeLeaf([tab]);
	const dir: SplitDir = zone === 'left' || zone === 'right' ? 'row' : 'col';
	const first = zone === 'left' || zone === 'top';
	const split: SplitNode = {
		kind: 'split',
		id: newId('s'),
		dir,
		ratio: 0.5,
		a: first ? fresh : target,
		b: first ? target : fresh
	};
	// A maximized leaf that gets split should reveal the result, not hide it.
	return {
		layout: { root: replaceLeaf(layout.root, leafId, split), maximized: null },
		leafId: fresh.id
	};
}

/**
 * Move `tabId` onto `targetLeafId`: 'center' joins that stack (or moves the tab
 * to the stack's end when it is already there), an edge zone splits the target
 * with a fresh leaf holding just this tab. Degenerate moves (dropping a leaf's
 * only tab onto its own edge, moving onto a vanished target) are no-ops.
 */
export function moveTab(
	layout: TileLayout,
	tabId: string,
	targetLeafId: string,
	zone: DropZone
): TileLayout {
	const source = leafOfTab(layout.root, tabId);
	const tab = source?.tabs.find((t) => t.id === tabId);
	if (!source || !tab || !layout.root || !findLeaf(layout.root, targetLeafId)) return layout;
	if (source.id === targetLeafId) {
		if (zone === 'center') {
			// Reorder to the end of its own stack and activate.
			const tabs = [...source.tabs.filter((t) => t.id !== tabId), tab];
			const root = mapLeaf(layout.root, source.id, (l) => ({ ...l, tabs, active: tabId }));
			return { ...layout, root };
		}
		if (source.tabs.length === 1) return layout; // splitting itself off itself
	}
	// Detach from the source stack first (collapsing it when it empties)…
	const detached = closeTab(layout, tabId);
	// …then land on the target, which survived the collapse (it isn't the
	// vanished source: a single-tab source equal to the target returned above).
	if (zone === 'center') return openTab(detached, targetLeafId, tab);
	return splitLeaf(detached, targetLeafId, zone, tab).layout;
}

/** Set a split's ratio (clamped so neither side can be crushed away). */
export function resizeSplit(layout: TileLayout, splitId: string, ratio: number): TileLayout {
	if (!layout.root) return layout;
	const walk = (n: TileNode): TileNode => {
		if (n.kind === 'leaf') return n;
		if (n.id === splitId) return { ...n, ratio: clampRatio(ratio) };
		const a = walk(n.a);
		const b = walk(n.b);
		return a === n.a && b === n.b ? n : { ...n, a, b };
	};
	const root = walk(layout.root);
	return root === layout.root ? layout : { ...layout, root };
}

/** Dblclick semantic: maximize `leafId`, or restore when it already is. */
export function toggleMaximize(layout: TileLayout, leafId: string): TileLayout {
	if (layout.maximized === leafId) return { ...layout, maximized: null };
	if (!findLeaf(layout.root, leafId)) return layout;
	return { ...layout, maximized: leafId };
}

// ---------- serialize / deserialize ----------

export function serializeLayout(layout: TileLayout): SerializedLayout {
	return { version: LAYOUT_VERSION, root: layout.root, maximized: layout.maximized };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Rebuild a node from untrusted JSON: invalid tabs are dropped, an emptied
 *  leaf collapses, a split with one surviving child yields that child, ratios
 *  are re-clamped. Returns null for anything unusable. */
function sanitizeNode(raw: unknown): TileNode | null {
	if (!raw || typeof raw !== 'object') return null;
	const n = raw as Record<string, unknown>;
	if (n.kind === 'leaf') {
		if (!isStr(n.id) || !Array.isArray(n.tabs)) return null;
		const tabs: TileTab[] = [];
		for (const t of n.tabs) {
			const tab = t as Record<string, unknown>;
			if (tab && isStr(tab.id) && isStr(tab.panel) && !tabs.some((x) => x.id === tab.id)) {
				tabs.push({ id: tab.id, panel: tab.panel });
			}
		}
		if (!tabs.length) return null;
		const active = isStr(n.active) && tabs.some((t) => t.id === n.active) ? n.active : tabs[0].id;
		return { kind: 'leaf', id: n.id, tabs, active };
	}
	if (n.kind === 'split') {
		if (!isStr(n.id) || (n.dir !== 'row' && n.dir !== 'col')) return null;
		const a = sanitizeNode(n.a);
		const b = sanitizeNode(n.b);
		if (!a && !b) return null;
		if (!a) return b;
		if (!b) return a;
		const ratio = typeof n.ratio === 'number' && Number.isFinite(n.ratio) ? clampRatio(n.ratio) : 0.5;
		return { kind: 'split', id: n.id, dir: n.dir, ratio, a, b };
	}
	return null;
}

/** Parse a persisted layout. Unknown versions and garbage return null — the
 *  caller decides the fallback (fresh default layout), nothing throws. */
export function deserializeLayout(raw: unknown): TileLayout | null {
	if (!raw || typeof raw !== 'object') return null;
	const data = raw as Record<string, unknown>;
	if (data.version !== LAYOUT_VERSION) return null;
	const root = sanitizeNode(data.root);
	return fixMaximized({ root, maximized: isStr(data.maximized) ? data.maximized : null });
}
