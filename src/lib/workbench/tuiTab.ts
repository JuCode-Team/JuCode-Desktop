// Pure helpers for native TUI dock tabs: a tab whose panel kind encodes which
// agent CLI it runs (`tui:jucode`, `tui:codex`, `tui:claude`). Framework-free
// so the mapping stays unit-testable; every TUI tab is an independent
// interactive process, never a second view of a GUI session.

import type { BackendId } from '$lib/backends/types';
import { isBackendId } from '$lib/backends/types';

export const TUI_PANEL_PREFIX = 'tui:';

/** Panel kind string for a backend's TUI tab. */
export function tuiPanelKind(backend: BackendId): string {
	return `${TUI_PANEL_PREFIX}${backend}`;
}

/** The backend a `tui:*` panel kind runs, or null for any other panel kind
 *  (including malformed / unknown `tui:*` strings from persisted layouts). */
export function tuiBackendOf(panel: string): BackendId | null {
	if (!panel.startsWith(TUI_PANEL_PREFIX)) return null;
	const raw = panel.slice(TUI_PANEL_PREFIX.length);
	return isBackendId(raw) ? raw : null;
}

/** Tab title, e.g. "TUI · jucode" — the CLI's own name, not translated. */
export function tuiTabTitle(backend: BackendId): string {
	return `TUI · ${backend}`;
}
