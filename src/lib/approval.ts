// Tool-approval plumbing shared by the composer picker, the approval card and
// ChatState. The engine owns the auto-approval decision (set via the
// `set_approval_mode` op); the desktop only maps its three UI modes onto the
// engine's, reconciles from `approval_mode` events, and builds structured
// `approve` ops — including per-hunk partial approvals for edit tools.

export type ApprovalMode = 'ask' | 'edits' | 'all';
export type EngineApprovalMode = 'read-only' | 'auto-edit' | 'full-auto';

// File-mutating tools the engine gates (the rest it gates are shell tools).
// Still used by ChatState to feed the Changes panel from tool_output events.
export const EDIT_TOOLS = ['write', 'edit', 'str_replace', 'hashline_edit', 'apply_patch'];

const UI_TO_ENGINE: Record<ApprovalMode, EngineApprovalMode> = {
	ask: 'read-only',
	edits: 'auto-edit',
	all: 'full-auto'
};
const ENGINE_TO_UI: Record<EngineApprovalMode, ApprovalMode> = {
	'read-only': 'ask',
	'auto-edit': 'edits',
	'full-auto': 'all'
};

/** Desktop picker mode → the engine's `set_approval_mode` string. */
export function toEngineMode(mode: ApprovalMode): EngineApprovalMode {
	return UI_TO_ENGINE[mode];
}

/** Engine `approval_mode` event string → desktop mode (null when unknown). */
export function fromEngineMode(mode: string): ApprovalMode | null {
	return (ENGINE_TO_UI as Record<string, ApprovalMode>)[mode] ?? null;
}

/** Reconcile the local mode from an engine `approval_mode` event: the engine is
 *  the source of truth, but an unrecognized string keeps the current mode. */
export function reconcileMode(current: ApprovalMode, engineMode: string): ApprovalMode {
	return fromEngineMode(engineMode) ?? current;
}

export function buildSetApprovalModeOp(mode: ApprovalMode): {
	op: 'set_approval_mode';
	mode: EngineApprovalMode;
} {
	return { op: 'set_approval_mode', mode: toEngineMode(mode) };
}

// --- per-hunk approval ------------------------------------------------------

/** One selectable hunk of a pending edit, from `approval_request.hunks`. */
export interface ApprovalHunk {
	id: string;
	file: string;
	header: string;
	lines: string[];
}

/** Parse the `hunks` field of an approval_request event. Non-arrays (absent /
 *  null → whole-call approval) and malformed entries collapse to null. */
export function parseHunks(v: unknown): ApprovalHunk[] | null {
	if (!Array.isArray(v)) return null;
	const hunks: ApprovalHunk[] = [];
	for (const item of v) {
		if (!item || typeof item !== 'object') return null;
		const h = item as Record<string, unknown>;
		if (typeof h.id !== 'string' || h.id === '') return null;
		hunks.push({
			id: h.id,
			file: typeof h.file === 'string' ? h.file : '',
			header: typeof h.header === 'string' ? h.header : '',
			lines: Array.isArray(h.lines) ? h.lines.map(String) : []
		});
	}
	return hunks;
}

export const allHunkIds = (hunks: ApprovalHunk[]) => hunks.map((h) => h.id);

/** Toggle one hunk id in a selection, preserving the hunk-list order semantics
 *  (the returned array only contains ids, order = insertion). */
export function toggleHunk(selected: string[], id: string): string[] {
	return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

export type SelectionState = 'all' | 'some' | 'none';

export function selectionState(hunks: ApprovalHunk[], selected: string[]): SelectionState {
	const picked = hunks.filter((h) => selected.includes(h.id)).length;
	if (picked === 0) return 'none';
	return picked === hunks.length ? 'all' : 'some';
}

export interface ApproveOp {
	op: 'approve';
	call_id: string;
	decision: 'allow' | 'deny';
	hunks?: string[];
	always?: boolean;
}

/**
 * Build the structured `approve` op. Engine combination rules are enforced
 * here so an invalid payload can never be constructed:
 * - `hunks` (partial approval) is only valid with `decision: 'allow'`;
 * - `always` applies to the whole call and is incompatible with `hunks`.
 */
export function buildApproveOp(
	callId: string,
	decision: 'allow' | 'deny',
	opts: { hunks?: string[]; always?: boolean } = {}
): ApproveOp {
	if (opts.hunks && opts.always) throw new Error('always approval cannot select hunks');
	if (opts.hunks && decision !== 'allow') throw new Error('hunks require decision: allow');
	const op: ApproveOp = { op: 'approve', call_id: callId, decision };
	if (opts.hunks) op.hunks = opts.hunks;
	if (opts.always) op.always = true;
	return op;
}
