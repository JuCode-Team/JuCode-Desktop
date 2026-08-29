import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer: the store is exercised in-memory (no
// load()), but its debounced save path still imports these.
vi.mock('$lib/protocol', () => ({
	appDataRead: vi.fn(() => Promise.resolve(null)),
	appDataWrite: vi.fn(() => Promise.resolve())
}));

import { WorkspaceStore } from './workspaceStore.svelte';
import { createWorkspace, WORKSPACES_VERSION } from './workspaces';

function seeded() {
	const store = new WorkspaceStore();
	const def = createWorkspace('default', [], null, { isDefault: true });
	const extra = createWorkspace('extra');
	store.file = { version: WORKSPACES_VERSION, active: def.id, workspaces: [def, extra] };
	return { store, def, extra };
}

beforeEach(() => vi.clearAllMocks());

describe('WorkspaceStore.remove', () => {
	it('refuses the default workspace', () => {
		const { store, def } = seeded();
		expect(store.remove(def.id)).toBeNull();
		expect(store.workspaces).toHaveLength(2);
	});

	it('refuses the last remaining workspace', () => {
		const store = new WorkspaceStore();
		// A legacy-shaped file where the only workspace isn't flagged default.
		const only = createWorkspace('only');
		store.file = { version: WORKSPACES_VERSION, active: only.id, workspaces: [only] };
		expect(store.remove(only.id)).toBeNull();
		expect(store.workspaces).toHaveLength(1);
	});

	it('removes an inactive workspace without changing the active one', () => {
		const { store, def, extra } = seeded();
		expect(store.remove(extra.id)).toBeNull(); // nothing to swap
		expect(store.workspaces.map((w) => w.id)).toEqual([def.id]);
		expect(store.activeId).toBe(def.id);
	});

	it('removing the active workspace falls back to the default and returns it', () => {
		const { store, def, extra } = seeded();
		store.setActive(extra.id);
		const next = store.remove(extra.id);
		expect(next?.id).toBe(def.id);
		expect(store.activeId).toBe(def.id);
		expect(store.workspaces).toHaveLength(1);
	});
});

describe('WorkspaceStore chrome', () => {
	it('rename trims and rejects empty names', () => {
		const { store, def } = seeded();
		store.rename(def.id, '  Ops  ');
		expect(store.workspaces[0].name).toBe('Ops');
		store.rename(def.id, '   ');
		expect(store.workspaces[0].name).toBe('Ops');
	});

	it('setChrome sets and clears color/icon, dropping invalid values', () => {
		const { store, def } = seeded();
		store.setChrome(def.id, { color: '#DC2626', icon: { kind: 'builtin', id: 'star' } });
		expect(store.workspaces[0].color).toBe('#dc2626');
		expect(store.workspaces[0].icon).toEqual({ kind: 'builtin', id: 'star' });
		store.setChrome(def.id, { color: 'lime' });
		expect(store.workspaces[0].color).toBeUndefined();
		store.setChrome(def.id, { color: null, icon: null });
		expect(store.workspaces[0].color).toBeUndefined();
		expect(store.workspaces[0].icon).toBeUndefined();
	});
});
