import { describe, it, expect } from 'vitest';
import {
	chatSessionOf,
	chatTab,
	chatTabId,
	ensureChatTab,
	pruneChatTabs,
	remapChatTabs
} from './chatTabs';
import {
	deserializeLayout,
	emptyLayout,
	findLeaf,
	leafOfTab,
	leavesOf,
	moveTab,
	serializeLayout,
	singleLeafLayout,
	toggleMaximize,
	type LeafNode,
	type TileLayout
} from './tiles';

/** Two leaves side by side: [s1 (active), s2] | [s3]. */
function twoPanes(): { layout: TileLayout; left: string; right: string } {
	let layout = singleLeafLayout([chatTab('s1'), chatTab('s2')], chatTabId('s1'));
	const left = leavesOf(layout.root)[0].id;
	layout = moveTab(ensureChatTab(layout, 's3', left), chatTabId('s3'), left, 'right');
	// Moving s3 out handed the left stack's activation to its neighbor — put it
	// back on s1 so the fixture reads as documented.
	layout = ensureChatTab(layout, 's1', left);
	const right = leavesOf(layout.root).find((l) => l.id !== left)!.id;
	return { layout, left, right };
}

describe('chat tab ids', () => {
	it('round-trips a session id through the chat: prefix', () => {
		expect(chatTabId('s1')).toBe('chat:s1');
		expect(chatSessionOf('chat:s1')).toBe('s1');
		expect(chatTab('s1')).toEqual({ id: 'chat:s1', panel: 'chat:s1' });
	});

	it('rejects non-chat and malformed ids', () => {
		expect(chatSessionOf('goal')).toBeNull();
		expect(chatSessionOf('tui:jucode')).toBeNull();
		expect(chatSessionOf('chat:')).toBeNull();
	});
});

describe('ensureChatTab (open / activate)', () => {
	it('creates the first leaf in an empty layout', () => {
		const next = ensureChatTab(emptyLayout(), 's1', null);
		const leaf = leavesOf(next.root)[0];
		expect(leaf.tabs).toEqual([chatTab('s1')]);
		expect(leaf.active).toBe(chatTabId('s1'));
	});

	it('stacks a new session into the focused leaf', () => {
		const { layout, right } = twoPanes();
		const next = ensureChatTab(layout, 's4', right);
		const leaf = findLeaf(next.root, right)!;
		expect(leaf.tabs.map((t) => t.id)).toEqual([chatTabId('s3'), chatTabId('s4')]);
		expect(leaf.active).toBe(chatTabId('s4'));
	});

	it('activates an existing tab in place instead of duplicating it', () => {
		const { layout, left, right } = twoPanes();
		// s2 lives (inactive) in the left leaf; the focused leaf is the right one.
		const next = ensureChatTab(layout, 's2', right);
		expect(findLeaf(next.root, left)!.active).toBe(chatTabId('s2'));
		expect(findLeaf(next.root, right)!.tabs).toHaveLength(1);
		expect(leavesOf(next.root).flatMap((l) => l.tabs).filter((t) => t.id === chatTabId('s2'))).toHaveLength(1);
	});

	it('is identity-stable when the tab is already active', () => {
		const { layout, left } = twoPanes();
		expect(findLeaf(layout.root, left)!.active).toBe(chatTabId('s1'));
		expect(ensureChatTab(layout, 's1', left)).toBe(layout);
	});
});

describe('pruneChatTabs (session closed / archived)', () => {
	it('removes a dead session tab and keeps the rest', () => {
		const { layout, left } = twoPanes();
		const next = pruneChatTabs(layout, (sid) => sid !== 's2');
		expect(findLeaf(next.root, left)!.tabs.map((t) => t.id)).toEqual([chatTabId('s1')]);
		expect(leavesOf(next.root)).toHaveLength(2);
	});

	it('collapses a leaf whose only tab died, promoting the sibling', () => {
		const { layout, left } = twoPanes();
		const next = pruneChatTabs(layout, (sid) => sid !== 's3');
		expect(next.root?.kind).toBe('leaf');
		expect((next.root as LeafNode).id).toBe(left);
	});

	it('keeps non-chat tabs and is identity-stable with nothing to prune', () => {
		const layout = singleLeafLayout([{ id: 't1', panel: 'goal' }, chatTab('s1')]);
		expect(pruneChatTabs(layout, () => true)).toBe(layout);
		const next = pruneChatTabs(layout, () => false);
		expect(leavesOf(next.root)[0].tabs).toEqual([{ id: 't1', panel: 'goal' }]);
	});

	it('empties the tree when every session died', () => {
		const { layout } = twoPanes();
		expect(pruneChatTabs(layout, () => false).root).toBeNull();
	});
});

describe('remapChatTabs (runtime ↔ engine session ids)', () => {
	it('rewrites tab ids/panels and the leaf active pointer', () => {
		const { layout, left } = twoPanes();
		const next = remapChatTabs(layout, (sid) => `eng-${sid}`);
		const leaf = findLeaf(next.root, left)!;
		expect(leaf.tabs.map((t) => t.id)).toEqual(['chat:eng-s1', 'chat:eng-s2']);
		expect(leaf.tabs.map((t) => t.panel)).toEqual(['chat:eng-s1', 'chat:eng-s2']);
		expect(leaf.active).toBe('chat:eng-s1');
	});

	it('drops unmappable tabs (not resumable), collapsing emptied leaves', () => {
		const { layout, left } = twoPanes();
		const next = remapChatTabs(layout, (sid) => (sid === 's3' ? null : sid));
		expect(next.root?.kind).toBe('leaf');
		expect((next.root as LeafNode).id).toBe(left);
	});

	it('clears maximized when its leaf vanished, keeps it otherwise', () => {
		const { layout, left, right } = twoPanes();
		const maxedGone = remapChatTabs(toggleMaximize(layout, right), (sid) => (sid === 's3' ? null : sid));
		expect(maxedGone.maximized).toBeNull();
		const maxedKept = remapChatTabs(toggleMaximize(layout, left), (sid) => `eng-${sid}`);
		expect(maxedKept.maximized).toBe(left);
	});

	it('is identity-stable under the identity mapping', () => {
		const { layout } = twoPanes();
		expect(remapChatTabs(layout, (sid) => sid)).toBe(layout);
	});

	it('persist round-trip: runtime → engine ids → serialize → parse → new runtime ids', () => {
		const { layout, left, right } = twoPanes();
		const engine: Record<string, string> = { s1: 'sid-a', s2: 'sid-b', s3: 'sid-c' };
		const saved = serializeLayout(remapChatTabs(layout, (sid) => engine[sid] ?? null));
		// Next launch: the file parses and engine ids map onto fresh runtime ids.
		const parsed = deserializeLayout(JSON.parse(JSON.stringify(saved)))!;
		const runtime: Record<string, string> = { 'sid-a': 'r1', 'sid-b': 'r2', 'sid-c': 'r3' };
		const restored = remapChatTabs(parsed, (sid) => runtime[sid] ?? null);
		// Same arrangement: leaf ids survive, tabs point at the new sessions.
		expect(findLeaf(restored.root, left)!.tabs.map((t) => t.id)).toEqual(['chat:r1', 'chat:r2']);
		expect(findLeaf(restored.root, right)!.tabs.map((t) => t.id)).toEqual(['chat:r3']);
		expect(leafOfTab(restored.root, 'chat:r1')!.active).toBe('chat:r1');
	});
});
