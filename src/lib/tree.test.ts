import { describe, it, expect } from 'vitest';
import { treeRows, type TreeNodeLite } from './tree';

const node = (id: string, parent_id: string | null): TreeNodeLite => ({
	id,
	parent_id,
	label: id,
	active: false
});

describe('treeRows', () => {
	it('orders children under their parent in DFS pre-order with depth', () => {
		// a → (b → d), c
		const rows = treeRows([node('a', null), node('b', 'a'), node('c', 'a'), node('d', 'b')]);
		expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
			['a', 0],
			['b', 1],
			['d', 2],
			['c', 1]
		]);
	});

	it('treats a node with an unknown parent as a root', () => {
		const rows = treeRows([node('x', 'missing'), node('y', 'x')]);
		expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
			['x', 0],
			['y', 1]
		]);
	});

	it('supports multiple roots', () => {
		const rows = treeRows([node('r1', null), node('r2', null), node('c', 'r1')]);
		expect(rows.map((r) => r.node.id)).toEqual(['r1', 'c', 'r2']);
	});

	it('returns nothing for an empty tree', () => {
		expect(treeRows([])).toEqual([]);
	});
});
