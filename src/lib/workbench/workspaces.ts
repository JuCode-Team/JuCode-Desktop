// Workspace model + on-disk format. A workspace owns a set of projects (the
// existing SavedProject shape, unchanged) plus its canvas tile layout; the
// file holds every workspace and which one is active. Pure data + pure
// transforms — the reactive store and the Tauri IO live in
// workspaceStore.svelte.ts.

import type { SavedProject } from '$lib/session.svelte';
import { serializeLayout, singleLeafLayout, type SerializedLayout, type TileTab } from './tiles';
import { normalizeColor, parseTabIcon, type TabIcon } from './tabChrome';

export const WORKSPACES_FILE = 'workspaces.json';
export const WORKSPACES_VERSION = 1;

// Legacy localStorage keys this file replaces (read once for migration; never
// written again — app-data is the only source of truth for workspace/layout).
export const LEGACY_PROJECTS_KEY = 'jucode-projects';
export const LEGACY_DOCK_TABS_KEY = 'jucode-dock-tabs';
export const LEGACY_DOCK_ACTIVE_KEY = 'jucode-dock-active';

/** Tool panel kinds a tile tab may reference (besides chat:/tui: tabs). */
export const DOCK_PANELS = ['plan', 'goal', 'changes', 'turns', 'files', 'git', 'term', 'browser', 'diag'] as const;

export interface WorkspaceEntry {
	id: string;
	name: string;
	projects: SavedProject[];
	/** Serialized dock tile layout; null until the user arranges one. */
	layout: SerializedLayout | null;
	/** The one always-present workspace: cannot be deleted. Exactly one per file. */
	isDefault?: boolean;
	/** Tab tag color (`#rgb` / `#rrggbb`). */
	color?: string;
	/** Tab icon (builtin id, slug/emoji, or sanitized SVG). */
	icon?: TabIcon;
}

export interface WorkspacesFile {
	version: number;
	/** Active workspace id (always one of `workspaces`). */
	active: string;
	workspaces: WorkspaceEntry[];
}

let counter = 0;
const newId = () => `w${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function createWorkspace(
	name: string,
	projects: SavedProject[] = [],
	layout: SerializedLayout | null = null,
	opts?: { isDefault?: boolean; color?: string; icon?: TabIcon }
): WorkspaceEntry {
	return {
		id: newId(),
		name,
		projects,
		layout,
		...(opts?.isDefault ? { isDefault: true } : {}),
		...(opts?.color ? { color: opts.color } : {}),
		...(opts?.icon ? { icon: opts.icon } : {})
	};
}

export function defaultWorkspacesFile(first: WorkspaceEntry): WorkspacesFile {
	const seed = first.isDefault ? first : { ...first, isDefault: true };
	return { version: WORKSPACES_VERSION, active: seed.id, workspaces: [seed] };
}

export function serializeWorkspaces(file: WorkspacesFile): string {
	return JSON.stringify(file, null, '\t') + '\n';
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

type SavedTab = NonNullable<SavedProject['tabs']>[number];

/** Re-validate a saved tab's chrome (the file is user-editable; an inactive
 *  workspace must not carry a dirty SVG back into it). Invalid color/icon are
 *  dropped; every other field rides along untouched. */
function sanitizeTab(t: SavedTab): SavedTab {
	const { color, icon, ...rest } = t;
	const c = normalizeColor(color);
	const i = parseTabIcon(icon);
	return { ...rest, ...(c ? { color: c } : {}), ...(i ? { icon: i } : {}) };
}

/** Keep only structurally valid saved projects (id/name/path present); the
 *  optional fields (tabs / worktree / lastBackend) ride along untouched —
 *  SessionStore.restore() already tolerates their absence — except tab
 *  chrome, which is re-validated. */
export function sanitizeProjects(raw: unknown): SavedProject[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((p): p is SavedProject => {
			const o = p as Record<string, unknown>;
			return !!o && isStr(o.id) && isStr(o.name) && isStr(o.path);
		})
		.map((p) =>
			Array.isArray(p.tabs)
				? { ...p, tabs: p.tabs.filter((t) => !!t && typeof t === 'object').map(sanitizeTab) }
				: p
		);
}

/**
 * Parse the persisted workspaces file. Returns null for garbage, an unknown
 * (newer) version, or a file without a single usable workspace — the caller
 * must then fall back without overwriting what's on disk.
 */
export function parseWorkspacesFile(text: string): WorkspacesFile | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object') return null;
	const data = raw as Record<string, unknown>;
	if (data.version !== WORKSPACES_VERSION || !Array.isArray(data.workspaces)) return null;
	const workspaces: WorkspaceEntry[] = [];
	for (const w of data.workspaces) {
		const o = w as Record<string, unknown>;
		if (!o || !isStr(o.id) || !isStr(o.name)) continue;
		const entry: WorkspaceEntry = {
			id: o.id,
			name: o.name,
			projects: sanitizeProjects(o.projects),
			// Layout blobs are validated lazily by tiles.deserializeLayout at use.
			layout: o.layout && typeof o.layout === 'object' ? (o.layout as SerializedLayout) : null
		};
		if (o.isDefault === true) entry.isDefault = true;
		const color = normalizeColor(o.color);
		if (color) entry.color = color;
		const icon = parseTabIcon(o.icon);
		if (icon) entry.icon = icon;
		workspaces.push(entry);
	}
	if (!workspaces.length) return null;
	// Pre-chrome files carried no isDefault: the first workspace becomes the
	// default so old files upgrade in place without a version bump.
	if (!workspaces.some((w) => w.isDefault)) workspaces[0].isDefault = true;
	const active = isStr(data.active) && workspaces.some((w) => w.id === data.active) ? data.active : workspaces[0].id;
	return { version: WORKSPACES_VERSION, active, workspaces };
}

/** Tolerant parse of the legacy dock-tabs value: bare panel strings (oldest
 *  format) and {id, panel} objects, filtered to known panel kinds. */
export function parseLegacyDockTabs(raw: string | null): TileTab[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	let n = 0;
	const tabs: TileTab[] = [];
	for (const item of parsed) {
		const o = item as Record<string, unknown>;
		const tab =
			typeof item === 'string'
				? { id: `m${n++}`, panel: item }
				: o && isStr(o.id) && isStr(o.panel)
					? { id: o.id, panel: o.panel }
					: null;
		if (tab && (DOCK_PANELS as readonly string[]).includes(tab.panel) && !tabs.some((t) => t.id === tab.id)) {
			tabs.push(tab);
		}
	}
	return tabs;
}

/**
 * One-time migration of the pre-workspace localStorage state (project layout +
 * dock tabs) into a single default workspace. Returns null when there is no
 * legacy data at all (genuinely fresh install).
 */
export function migrateLegacy(read: (key: string) => string | null, name: string): WorkspacesFile | null {
	const projectsRaw = read(LEGACY_PROJECTS_KEY);
	const dockRaw = read(LEGACY_DOCK_TABS_KEY);
	if (projectsRaw == null && dockRaw == null) return null;
	let projects: SavedProject[] = [];
	try {
		projects = sanitizeProjects(JSON.parse(projectsRaw || '[]'));
	} catch {
		projects = [];
	}
	const tabs = parseLegacyDockTabs(dockRaw);
	const active = read(LEGACY_DOCK_ACTIVE_KEY);
	const layout = tabs.length ? serializeLayout(singleLeafLayout(tabs, active ?? undefined)) : null;
	return defaultWorkspacesFile(createWorkspace(name, projects, layout));
}
