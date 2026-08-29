import { describe, it, expect } from 'vitest';
import {
	activateTab,
	closeTab,
	deserializeLayout,
	emptyLayout,
	findLeaf,
	leafOfTab,
	leavesOf,
	moveTab,
	openTab,
	resizeSplit,
	serializeLayout,
	singleLeafLayout,
	splitLeaf,
	toggleMaximize,
	LAYOUT_VERSION,
	RATIO_MAX,
	RATIO_MIN,
	type LeafNode,
	type SplitNode,
	type TileLayout,
	type TileTab
} from './tiles';

const tab = (id: string, panel = id): TileTab => ({ id, panel });

/** One leaf [a, b] split with a fresh leaf [c] on the given edge of it. */
function twoLeaves(zone: 'left' | 'right' | 'top' | 'bottom' = 'right') {
	const layout = singleLeafLayout([tab('a'), tab('b')]);
	const first = leavesOf(layout.root)[0];
	const { layout: next, leafId } = splitLeaf(layout, first.id, zone, tab('c'));
	return { layout: next, firstId: first.id, secondId: leafId };
}

describe('split', () => {
	it('replaces the leaf with a split holding it and the fresh leaf', () => {
		const { layout, firstId, secondId } = twoLeaves('right');
		const root = layout.root as SplitNode;
		expect(root.kind).toBe('split');
		expect(root.dir).toBe('row');
		expect(root.ratio).toBe(0.5);
		expect((root.a as LeafNode).id).toBe(firstId);
		expect((root.b as LeafNode).id).toBe(secondId);
		expect((root.b as LeafNode).tabs.map((t) => t.id)).toEqual(['c']);
	});

	it('puts the new leaf before the target for left/top zones', () => {
		const { layout, secondId } = twoLeaves('top');
		const root = layout.root as SplitNode;
		expect(root.dir).toBe('col');
		expect((root.a as LeafNode).id).toBe(secondId);
	});

	it('splitting a maximized leaf clears maximize so the result is visible', () => {
		const layout = singleLeafLayout([tab('a')]);
		const leaf = leavesOf(layout.root)[0];
		const maxed = toggleMaximize(layout, leaf.id);
		const { layout: next } = splitLeaf(maxed, leaf.id, 'bottom', tab('c'));
		expect(next.maximized).toBeNull();
	});

	it('is a no-op on an unknown leaf', () => {
		const layout = singleLeafLayout([tab('a')]);
		expect(splitLeaf(layout, 'nope', 'left', tab('c')).layout).toBe(layout);
	});
});

describe('close', () => {
	it('removes a tab and activates its neighbor', () => {
		const layout = activateTab(singleLeafLayout([tab('a'), tab('b'), tab('c')]), 'b');
		const next = closeTab(layout, 'b');
		const leaf = leavesOf(next.root)[0];
		expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'c']);
		expect(leaf.active).toBe('c');
	});

	it('keeps the active tab when a background tab closes', () => {
		const layout = singleLeafLayout([tab('a'), tab('b')]);
		const next = closeTab(layout, 'b');
		expect(leavesOf(next.root)[0].active).toBe('a');
	});

	it('collapses an emptied leaf, promoting the sibling to the split area', () => {
		const { layout, firstId } = twoLeaves('right');
		const next = closeTab(layout, 'c');
		expect(next.root?.kind).toBe('leaf');
		expect((next.root as LeafNode).id).toBe(firstId);
	});

	it('closing the last tab of the only leaf empties the tree', () => {
		const layout = singleLeafLayout([tab('a')]);
		expect(closeTab(layout, 'a').root).toBeNull();
	});

	it('clears maximize when the maximized leaf collapses away', () => {
		const { layout, secondId } = twoLeaves('right');
		const maxed = toggleMaximize(layout, secondId);
		const next = closeTab(maxed, 'c');
		expect(next.maximized).toBeNull();
	});

	it('is a no-op for an unknown tab', () => {
		const layout = singleLeafLayout([tab('a')]);
		expect(closeTab(layout, 'nope')).toBe(layout);
	});
});

describe('open and activate', () => {
	it('appends to the target leaf and activates', () => {
		const layout = singleLeafLayout([tab('a')]);
		const leaf = leavesOf(layout.root)[0];
		const next = openTab(layout, leaf.id, tab('b'));
		const after = leavesOf(next.root)[0];
		expect(after.tabs.map((t) => t.id)).toEqual(['a', 'b']);
		expect(after.active).toBe('b');
	});

	it('creates a root leaf in an empty tree', () => {
		const next = openTab(emptyLayout(), null, tab('a'));
		expect(leavesOf(next.root)[0].tabs.map((t) => t.id)).toEqual(['a']);
	});

	it('re-activates an existing tab id instead of duplicating it', () => {
		const { layout, secondId } = twoLeaves('right');
		const next = openTab(layout, secondId, tab('a'));
		expect(leavesOf(next.root).flatMap((l) => l.tabs).filter((t) => t.id === 'a')).toHaveLength(1);
		expect(leafOfTab(next.root, 'a')?.active).toBe('a');
	});
});

describe('move', () => {
	it('center drop joins the target stack and leaves the source without the tab', () => {
		const { layout, firstId, secondId } = twoLeaves('right');
		const next = moveTab(layout, 'b', secondId, 'center');
		expect(findLeaf(next.root, firstId)?.tabs.map((t) => t.id)).toEqual(['a']);
		const target = findLeaf(next.root, secondId);
		expect(target?.tabs.map((t) => t.id)).toEqual(['c', 'b']);
		expect(target?.active).toBe('b');
	});

	it('edge drop splits the target with a fresh single-tab leaf', () => {
		const { layout, secondId } = twoLeaves('right');
		const next = moveTab(layout, 'a', secondId, 'bottom');
		const all = leavesOf(next.root);
		expect(all).toHaveLength(3);
		const fresh = leafOfTab(next.root, 'a');
		expect(fresh?.tabs).toHaveLength(1);
	});

	it('moving a leaf-emptying tab collapses the source before landing', () => {
		const { layout, firstId, secondId } = twoLeaves('right');
		// 'c' is the second leaf's only tab: the leaf must vanish.
		const next = moveTab(layout, 'c', firstId, 'center');
		expect(findLeaf(next.root, secondId)).toBeNull();
		expect(leavesOf(next.root)).toHaveLength(1);
		expect(findLeaf(next.root, firstId)?.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
	});

	it('center drop on its own leaf reorders the tab to the end', () => {
		const layout = singleLeafLayout([tab('a'), tab('b'), tab('c')]);
		const leaf = leavesOf(layout.root)[0];
		const next = moveTab(layout, 'a', leaf.id, 'center');
		expect(leavesOf(next.root)[0].tabs.map((t) => t.id)).toEqual(['b', 'c', 'a']);
	});

	it('edge drop of a stack tab onto its own leaf splits that leaf in two', () => {
		const layout = singleLeafLayout([tab('a'), tab('b')]);
		const leaf = leavesOf(layout.root)[0];
		const next = moveTab(layout, 'b', leaf.id, 'right');
		const all = leavesOf(next.root);
		expect(all).toHaveLength(2);
		expect(all[0].tabs.map((t) => t.id)).toEqual(['a']);
		expect(all[1].tabs.map((t) => t.id)).toEqual(['b']);
	});

	it("dropping a leaf's only tab onto its own edge is a no-op", () => {
		const layout = singleLeafLayout([tab('a')]);
		const leaf = leavesOf(layout.root)[0];
		expect(moveTab(layout, 'a', leaf.id, 'left')).toBe(layout);
	});
});

describe('resize', () => {
	it('sets the split ratio', () => {
		const { layout } = twoLeaves('right');
		const split = layout.root as SplitNode;
		const next = resizeSplit(layout, split.id, 0.3);
		expect((next.root as SplitNode).ratio).toBe(0.3);
	});

	it('clamps the ratio so neither side collapses', () => {
		const { layout } = twoLeaves('right');
		const split = layout.root as SplitNode;
		expect((resizeSplit(layout, split.id, 0).root as SplitNode).ratio).toBe(RATIO_MIN);
		expect((resizeSplit(layout, split.id, 1).root as SplitNode).ratio).toBe(RATIO_MAX);
	});

	it('is a no-op on an unknown split id', () => {
		const { layout } = twoLeaves('right');
		expect(resizeSplit(layout, 'nope', 0.3)).toBe(layout);
	});
});

describe('maximize', () => {
	it('dblclick semantic toggles: maximize then restore', () => {
		const { layout, firstId } = twoLeaves('right');
		const maxed = toggleMaximize(layout, firstId);
		expect(maxed.maximized).toBe(firstId);
		expect(toggleMaximize(maxed, firstId).maximized).toBeNull();
	});

	it('maximizing another leaf replaces the current one', () => {
		const { layout, firstId, secondId } = twoLeaves('right');
		const next = toggleMaximize(toggleMaximize(layout, firstId), secondId);
		expect(next.maximized).toBe(secondId);
	});

	it('ignores unknown leaves', () => {
		const layout = singleLeafLayout([tab('a')]);
		expect(toggleMaximize(layout, 'nope')).toBe(layout);
	});
});

describe('serialize / deserialize', () => {
	it('round-trips a layout with splits, stacks and maximize', () => {
		const { layout, secondId } = twoLeaves('bottom');
		const withMax = toggleMaximize(activateTab(layout, 'b'), secondId);
		const parsed = deserializeLayout(JSON.parse(JSON.stringify(serializeLayout(withMax))));
		expect(parsed).toEqual(withMax);
	});

	it('stamps the current version', () => {
		expect(serializeLayout(emptyLayout()).version).toBe(LAYOUT_VERSION);
	});

	it('rejects unknown versions and garbage', () => {
		expect(deserializeLayout({ version: 99, root: null, maximized: null })).toBeNull();
		expect(deserializeLayout('nonsense')).toBeNull();
		expect(deserializeLayout(null)).toBeNull();
	});

	it('drops invalid tabs and collapses emptied nodes while parsing', () => {
		const ser = {
			version: LAYOUT_VERSION,
			maximized: null,
			root: {
				kind: 'split',
				id: 's1',
				dir: 'row',
				ratio: 7, // out of range → clamped
				a: { kind: 'leaf', id: 'l1', tabs: [{ id: 'a', panel: 'goal' }, { bogus: true }], active: 'zz' },
				b: { kind: 'leaf', id: 'l2', tabs: [], active: '' } // empty → collapses
			}
		};
		const parsed = deserializeLayout(ser) as TileLayout;
		expect(parsed.root?.kind).toBe('leaf');
		const leaf = parsed.root as LeafNode;
		expect(leaf.tabs).toEqual([{ id: 'a', panel: 'goal' }]);
		expect(leaf.active).toBe('a');
	});

	it('clears a maximized id that no longer resolves to a leaf', () => {
		const ser = serializeLayout(singleLeafLayout([tab('a')]));
		const parsed = deserializeLayout({ ...ser, maximized: 'gone' });
		expect(parsed?.maximized).toBeNull();
	});
});
