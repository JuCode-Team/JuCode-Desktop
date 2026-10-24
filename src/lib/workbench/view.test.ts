import { describe, expect, it } from 'vitest';
import { leafOfTab, leavesOf, moveTab, type TileLayout } from './tiles';
import { canDrop, FRONT, keep, KEPT, normalize, openTool, restoreView, saveView } from './view';

const panels = (layout: TileLayout) => leavesOf(layout.root).map((l) => l.tabs.map((x) => x.panel));
const mainLeaf = (layout: TileLayout) => leafOfTab(layout.root, FRONT)!.id;

describe('openTool', () => {
	it('opens the first tool in a pane beside the main one, and the next as its tabs', () => {
		let layout = normalize(null);
		layout = openTool(layout, 'git', null);
		layout = openTool(layout, 'term', null);
		expect(panels(layout)).toEqual([[FRONT], ['git', 'term']]);
	});

	it('shows a tool already open where it is', () => {
		let layout = openTool(openTool(normalize(null), 'git', null), 'term', null);
		layout = openTool(layout, 'git', null);
		expect(leafOfTab(layout.root, 'git')!.active).toBe('git');
		expect(panels(layout)).toEqual([[FRONT], ['git', 'term']]);
	});

	it('opens in the tool pane last used', () => {
		let layout = openTool(openTool(normalize(null), 'git', null), 'term', null);
		layout = moveTab(layout, 'term', mainLeaf(layout), 'bottom');
		const bottom = leafOfTab(layout.root, 'term')!.id;
		layout = openTool(layout, 'files', bottom);
		expect(leafOfTab(layout.root, 'files')!.id).toBe(bottom);
	});
});

describe('canDrop', () => {
	const two = () => openTool(openTool(normalize(null), 'git', null), 'term', null);

	it('never stacks a tool into the main pane, and never moves the main tab', () => {
		const layout = two();
		expect(canDrop(layout, 'git', mainLeaf(layout), 'center')).toBe(false);
		expect(canDrop(layout, FRONT, leafOfTab(layout.root, 'git')!.id, 'center')).toBe(false);
	});

	it('splits while a pane is left, up to three', () => {
		let layout = two();
		expect(canDrop(layout, 'term', mainLeaf(layout), 'bottom')).toBe(true);
		layout = moveTab(layout, 'term', mainLeaf(layout), 'bottom');
		layout = openTool(layout, 'files', leafOfTab(layout.root, 'git')!.id);
		expect(leavesOf(layout.root)).toHaveLength(3);
		expect(canDrop(layout, 'files', mainLeaf(layout), 'left')).toBe(false);
		expect(canDrop(layout, 'files', leafOfTab(layout.root, 'term')!.id, 'center')).toBe(true);
		// The only tab of a pane takes its pane along: that is no new pane.
		expect(canDrop(layout, 'term', mainLeaf(layout), 'left')).toBe(true);
	});
});

describe('normalize', () => {
	it('puts a layout it cannot show back as the main pane with its tools beside', () => {
		const bad: TileLayout = {
			root: { kind: 'leaf', id: 'l1', tabs: [{ id: FRONT, panel: FRONT }, { id: 'git', panel: 'git' }, { id: 'x', panel: 'diag' }], active: FRONT }
		};
		expect(panels(normalize(bad))).toEqual([[FRONT], ['git']]);
	});
});

describe('restoreView', () => {
	it('keeps the panes of each conversation still there', () => {
		const layouts = { 'chat:s1': openTool(normalize(null), 'git', null), 'chat:gone': openTool(normalize(null), 'term', null) };
		const raw = JSON.parse(JSON.stringify(saveView({ kind: 'chat', id: 's1' }, layouts)));
		const restored = restoreView(raw, ['s1'], [], null);
		expect(restored.view).toEqual({ kind: 'chat', id: 's1' });
		expect(Object.keys(restored.layouts)).toEqual(['chat:s1']);
		expect(panels(restored.layouts['chat:s1']!)).toEqual([[FRONT], ['git']]);
	});

	it('falls back to the seed when the saved session is gone', () => {
		const raw = saveView({ kind: 'chat', id: 'gone' }, {});
		expect(restoreView(raw, ['s2'], [], 's2').view).toEqual({ kind: 'chat', id: 's2' });
	});

	it('gives the one tool of a v2 save to the view it shows', () => {
		const restored = restoreView({ v: 2, view: { kind: 'project', id: 'p1' }, side: 'term' }, [], ['p1'], null);
		expect(restored.view).toEqual({ kind: 'project', id: 'p1' });
		expect(panels(restored.layouts['project:p1']!)).toEqual([[FRONT], ['term']]);
	});

	it('gives the tools of an old tile layout to the conversation it had in front', () => {
		const old = {
			version: 1,
			root: {
				kind: 'split',
				a: { kind: 'leaf', tabs: [{ id: 'chat:a', panel: 'chat:a' }, { id: 'chat:b', panel: 'chat:b' }], active: 'chat:b' },
				b: { kind: 'leaf', tabs: [{ id: 'x', panel: 'git' }], active: 'x' }
			}
		};
		const restored = restoreView(old, ['a', 'b'], [], 'a');
		expect(restored.view).toEqual({ kind: 'chat', id: 'b' });
		expect(panels(restored.layouts['chat:b']!)).toEqual([[FRONT], ['git']]);
	});

	it('shows the seed with no panes of its own for garbage or nothing', () => {
		expect(restoreView(null, ['s'], [], 's')).toEqual({ view: { kind: 'chat', id: 's' }, layouts: {} });
		expect(restoreView('x', [], [], null).view).toBeNull();
	});
});

describe('keep', () => {
	it('moves a conversation to the front and keeps the latest few', () => {
		const many = Array.from({ length: KEPT }, (_, i) => `s${i}`);
		expect(keep(many, 'new')).toEqual(['new', ...many.slice(0, KEPT - 1)]);
		expect(keep(['a', 'b'], 'b')).toEqual(['b', 'a']);
	});
});
