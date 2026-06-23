// Pure helper: order a conversation branch tree into DFS pre-order with a depth
// per node, so a flat list renders as a real tree.

export type TreeNodeLite = { id: string; parent_id: string | null; label: string; active: boolean };

export function treeRows<T extends TreeNodeLite>(nodes: T[]): { node: T; depth: number }[] {
	const ids = new Set(nodes.map((n) => n.id));
	const kids = new Map<string | null, T[]>();
	for (const n of nodes) {
		const key = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
		const arr = kids.get(key);
		if (arr) arr.push(n);
		else kids.set(key, [n]);
	}
	const out: { node: T; depth: number }[] = [];
	const walk = (key: string | null, depth: number) => {
		for (const n of kids.get(key) ?? []) {
			out.push({ node: n, depth });
			walk(n.id, depth + 1);
		}
	};
	walk(null, 0);
	return out;
}
