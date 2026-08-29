// Which row feeds the popover's fixed effort column. Pure so the resolution
// order (hover > keyboard focus > active model) stays unit-testable.

export interface EffortSourceRow {
	active: boolean;
}

/**
 * Resolve the row whose reasoning efforts the side column shows.
 *
 * The hovered row wins; keyboard focus counts only after the user actually
 * arrow-keyed (`keyNav`), never on the default selection; with no focus at
 * all the column falls back to the currently active model so it is never
 * blank while the popover is idle. Returns null when nothing applies.
 */
export function effortColumnIdx(
	rows: EffortSourceRow[],
	hoverIdx: number | null,
	keyNav: boolean,
	selIdx: number
): number | null {
	const focused = hoverIdx ?? (keyNav ? selIdx : null);
	// A stale index (rows re-filtered under the pointer) falls through to the
	// active-model fallback instead of pointing at nothing.
	if (focused !== null && focused >= 0 && focused < rows.length) return focused;
	const active = rows.findIndex((r) => r.active);
	return active >= 0 ? active : null;
}
