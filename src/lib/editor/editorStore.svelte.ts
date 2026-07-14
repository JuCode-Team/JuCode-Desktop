import { readText, statText, writeText, gitHeadText, isConflictError } from '$lib/protocol';

// Open-tab model for the built-in editor. Pure state + protocol IO — the
// CodeMirror view lives in EditorPane.svelte, which mirrors the live document
// into `doc` (debounced) and bumps nothing here on plain typing except `dirty`.

export interface EditorTab {
	/** Absolute path (as the backend confined it). */
	path: string;
	name: string;
	/** Path relative to the project root, for display. */
	rel: string;
	/** Last content loaded from / written to disk, plus live edits synced in. */
	doc: string;
	dirty: boolean;
	/** Disk mtime (ms) at load/save — optimistic-concurrency baseline. */
	mtime: number;
	size: number;
	/** Content at git HEAD (null → unavailable: new file, no repo, binary…). */
	headText: string | null;
	/** File changed on disk since load and a save was rejected (覆盖 / 重新加载). */
	conflict: boolean;
	/** 1-based line range a ⌘K AI edit is pending on (drives the busy overlay). */
	aiRange: { fromLine: number; toLine: number } | null;
	/** Bumped whenever `doc` is replaced from outside the editor view (open /
	 *  reload / AI edit), so the pane rebuilds its EditorState. */
	rev: number;
	error: string;
}

export type SaveResult = 'saved' | 'conflict' | 'error';

const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export class EditorStore {
	tabs = $state<EditorTab[]>([]);
	activePath = $state('');
	visible = $state(false);
	/** Project root the open files belong to (rel-path display + git HEAD). */
	root = $state('');

	get active(): EditorTab | undefined {
		return this.tabs.find((t) => t.path === this.activePath);
	}
	get hasDirty(): boolean {
		return this.tabs.some((t) => t.dirty);
	}
	tab(path: string): EditorTab | undefined {
		return this.tabs.find((t) => t.path === path);
	}

	#rel(path: string): string {
		const root = this.root.replace(/\/+$/, '');
		return root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
	}

	/** Resolve an engine-reported path (absolute or project-relative) to absolute. */
	#abs(path: string): string {
		if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path;
		const root = this.root.replace(/\/+$/, '');
		return root ? `${root}/${path}` : path;
	}

	/**
	 * Open `path` in a tab (activating an existing one) and reveal the pane.
	 * Rejects when the file can't be read as text (caller falls back to the
	 * legacy preview).
	 */
	async open(path: string, root?: string): Promise<EditorTab> {
		if (root) this.root = root.replace(/\/+$/, '');
		const abs = this.#abs(path);
		const existing = this.tab(abs);
		if (existing) {
			this.activePath = abs;
			this.visible = true;
			return existing;
		}
		const doc = await readText(abs); // throws for binary / oversized / escaping paths
		let mtime = 0;
		let size = doc.length;
		try {
			const st = await statText(abs);
			mtime = st.mtime_ms;
			size = st.size;
		} catch {
			/* stat is best-effort; a 0 baseline just always conflicts safely */
		}
		const tab: EditorTab = {
			path: abs,
			name: baseName(abs),
			rel: this.#rel(abs),
			doc,
			dirty: false,
			mtime,
			size,
			headText: null,
			conflict: false,
			aiRange: null,
			rev: 1,
			error: ''
		};
		this.tabs.push(tab);
		this.activePath = abs;
		this.visible = true;
		this.#loadHead(tab);
		return tab;
	}

	/** Fetch the git-HEAD baseline for the diff gutter (best-effort). */
	async #loadHead(tab: EditorTab) {
		try {
			tab.headText = await gitHeadText(tab.path, this.root || undefined);
		} catch {
			tab.headText = null; // new file / not a repo / binary at HEAD
		}
	}

	activate(path: string) {
		if (this.tab(path)) this.activePath = path;
	}

	/**
	 * Close a tab. Returns false (and keeps it open) when it has unsaved
	 * changes and `force` is not set — the UI confirms and retries with force.
	 */
	close(path: string, force = false): boolean {
		const idx = this.tabs.findIndex((t) => t.path === path);
		if (idx < 0) return true;
		if (this.tabs[idx].dirty && !force) return false;
		this.tabs.splice(idx, 1);
		if (this.activePath === path) {
			this.activePath = this.tabs[Math.min(idx, this.tabs.length - 1)]?.path ?? '';
		}
		if (this.tabs.length === 0) this.visible = false;
		return true;
	}

	/** Live-doc sync from the editor view (debounced there). Marks dirty. */
	syncDoc(path: string, doc: string) {
		const tab = this.tab(path);
		if (!tab) return;
		tab.doc = doc;
		tab.dirty = true;
	}

	markDirty(path: string) {
		const tab = this.tab(path);
		if (tab) tab.dirty = true;
	}

	/**
	 * Save a tab to disk. `content` (when given) is the authoritative live
	 * document from the editor view. Optimistic concurrency: a disk change since
	 * load flips `conflict` instead of overwriting; `force` overwrites anyway.
	 */
	async save(path: string, content?: string, force = false): Promise<SaveResult> {
		const tab = this.tab(path);
		if (!tab) return 'error';
		const text = content ?? tab.doc;
		try {
			const st = await writeText(tab.path, text, force ? undefined : tab.mtime);
			tab.doc = text;
			tab.mtime = st.mtime_ms;
			tab.size = st.size;
			tab.dirty = false;
			tab.conflict = false;
			tab.error = '';
			return 'saved';
		} catch (e) {
			if (isConflictError(e)) {
				tab.conflict = true;
				return 'conflict';
			}
			tab.error = String(e);
			return 'error';
		}
	}

	async saveAll(): Promise<void> {
		for (const t of this.tabs) {
			if (t.dirty) await this.save(t.path);
		}
	}

	/** Reload a tab from disk, discarding buffer state (clears dirty/conflict). */
	async reload(path: string): Promise<void> {
		const tab = this.tab(path);
		if (!tab) return;
		try {
			const doc = await readText(tab.path);
			const st = await statText(tab.path);
			tab.doc = doc;
			tab.mtime = st.mtime_ms;
			tab.size = st.size;
			tab.dirty = false;
			tab.conflict = false;
			tab.aiRange = null;
			tab.error = '';
			tab.rev++;
			this.#loadHead(tab);
		} catch (e) {
			tab.error = String(e);
		}
	}

	/** Mark a ⌘K AI edit in flight on a 1-based line range. */
	beginAiEdit(path: string, fromLine: number, toLine: number) {
		const tab = this.tab(path);
		if (tab) tab.aiRange = { fromLine, toLine };
	}

	cancelAiEdit(path: string) {
		const tab = this.tab(path);
		if (tab) tab.aiRange = null;
	}

	/**
	 * Engine edit-tool completions for `paths` (from ChatState tool events).
	 * Open clean tabs (and tabs awaiting an AI edit) auto-reload; a dirty tab is
	 * flagged as conflicted instead so the user decides.
	 */
	handleEngineEdit(paths: string[]) {
		for (const p of paths) {
			const tab = this.tab(this.#abs(p));
			if (!tab) continue;
			if (!tab.dirty || tab.aiRange) void this.reload(tab.path);
			else tab.conflict = true;
		}
	}
}

export const editorStore = new EditorStore();
