// Reactive workspace state + persistence. Workspaces (projects per workspace,
// dock tile layout, which workspace is active) live in one app-data file
// written through the Tauri layer — localStorage is only read once, to migrate
// pre-workspace installs. Writes are debounced and atomic Rust-side.

import { appDataRead, appDataWrite } from '$lib/protocol';
import type { SavedProject } from '$lib/session.svelte';
import type { SerializedLayout } from './tiles';
import {
	createWorkspace,
	defaultWorkspacesFile,
	migrateLegacy,
	parseWorkspacesFile,
	serializeWorkspaces,
	WORKSPACES_FILE,
	type WorkspaceEntry,
	type WorkspacesFile
} from './workspaces';

const SAVE_DELAY = 500;

export class WorkspaceStore {
	file = $state<WorkspacesFile | null>(null);
	loaded = $state(false);

	/** Cleared when the on-disk file is unreadable (corrupt, or written by a
	 *  newer app version): the session runs in memory and never clobbers it. */
	#writable = true;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;

	get workspaces(): WorkspaceEntry[] {
		return this.file?.workspaces ?? [];
	}
	get activeId(): string {
		return this.file?.active ?? '';
	}
	get active(): WorkspaceEntry | null {
		return this.workspaces.find((w) => w.id === this.activeId) ?? null;
	}

	/**
	 * Load the workspaces file (or migrate the legacy localStorage layout, or
	 * seed a fresh default). Resolves to the active workspace. `defaultName`
	 * labels the workspace created when none exists yet.
	 */
	async load(defaultName: string): Promise<WorkspaceEntry> {
		let raw: string | null = null;
		let readable = true;
		try {
			raw = await appDataRead(WORKSPACES_FILE);
		} catch (e) {
			// No Tauri backend (plain-browser dev) or IO failure: run in memory.
			console.error('workspaces: read failed, running in-memory', e);
			readable = false;
			this.#writable = false;
		}
		if (raw != null) {
			const parsed = parseWorkspacesFile(raw);
			if (parsed) {
				this.file = parsed;
				this.loaded = true;
				return this.active!;
			}
			// Present but unreadable — never overwrite it with a fresh file.
			console.error('workspaces: existing file is unreadable, running in-memory');
			this.#writable = false;
		}
		const migrated = migrateLegacy((k) => {
			try {
				return localStorage.getItem(k);
			} catch {
				return null;
			}
		}, defaultName);
		this.file = migrated ?? defaultWorkspacesFile(createWorkspace(defaultName));
		this.loaded = true;
		// Only persist when the file was genuinely absent (fresh install or
		// migration) — a failed read/parse above keeps the session in-memory.
		if (raw == null && readable) this.#schedule();
		return this.active!;
	}

	/** Replace the active workspace's saved projects (SessionStore.serialize). */
	updateProjects(projects: SavedProject[]) {
		const ws = this.active;
		if (!ws) return;
		ws.projects = projects;
		this.#schedule();
	}

	/** Replace the active workspace's dock tile layout. */
	updateLayout(layout: SerializedLayout | null) {
		const ws = this.active;
		if (!ws) return;
		ws.layout = layout;
		this.#schedule();
	}

	/** Replace the active workspace's main (session mosaic) layout. */
	updateMain(main: SerializedLayout | null) {
		const ws = this.active;
		if (!ws) return;
		ws.main = main;
		this.#schedule();
	}

	/** Mark `id` active; the caller swaps the live sessions. */
	setActive(id: string): WorkspaceEntry | null {
		if (!this.file || !this.file.workspaces.some((w) => w.id === id)) return null;
		this.file.active = id;
		this.#schedule();
		return this.active;
	}

	create(name: string): WorkspaceEntry | null {
		if (!this.file) return null;
		const ws = createWorkspace(name);
		this.file.workspaces.push(ws);
		this.#schedule();
		return ws;
	}

	#schedule() {
		if (!this.#writable) return;
		if (this.#saveTimer != null) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = null;
			void this.flush();
		}, SAVE_DELAY);
	}

	async flush() {
		if (!this.#writable || !this.file) return;
		if (this.#saveTimer != null) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = null;
		}
		try {
			await appDataWrite(WORKSPACES_FILE, serializeWorkspaces($state.snapshot(this.file) as WorkspacesFile));
		} catch (e) {
			console.error('workspaces: write failed', e);
		}
	}
}

export const workspaces = new WorkspaceStore();
