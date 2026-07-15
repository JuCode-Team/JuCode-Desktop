// Tool-approval plumbing shared by the composer picker, the approval card and
// ChatState. The engine owns the auto-approval decision (set via the
// `set_approval_mode` op); the desktop only maps its three UI modes onto the
// engine's, reconciles from `approval_mode` events, and builds structured
// `approve` ops — including per-hunk partial approvals for edit tools.

// The shared 3-mode enum drives jucode/codex; claude additionally exposes
// 'plan' (read-only planning) and 'auto' (model auto-approves tool calls),
// gated behind BackendCaps.extendedApprovalModes so only the claude picker
// offers them. plan/auto map 1:1 between the UI and engine layers.
export type ApprovalMode = 'ask' | 'plan' | 'auto' | 'edits' | 'all';
export type EngineApprovalMode = 'read-only' | 'plan' | 'auto' | 'auto-edit' | 'full-auto';

// File-mutating tools the engine gates (the rest it gates are shell tools).
// Still used by ChatState to feed the Changes panel from tool_output events.
export const EDIT_TOOLS = ['write', 'edit', 'str_replace', 'hashline_edit', 'apply_patch'];

const UI_TO_ENGINE: Record<ApprovalMode, EngineApprovalMode> = {
	ask: 'read-only',
	plan: 'plan',
	auto: 'auto',
	edits: 'auto-edit',
	all: 'full-auto'
};
const ENGINE_TO_UI: Record<EngineApprovalMode, ApprovalMode> = {
	'read-only': 'ask',
	plan: 'plan',
	auto: 'auto',
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

/** Whether a claude approval-mode change to `mode` must go through an engine
 *  respawn (spawned with `--permission-mode bypassPermissions` + `--resume`)
 *  rather than a live `set_permission_mode` control frame: claude does not honor
 *  a runtime switch INTO bypassPermissions (no system/status follow-up, so the
 *  UI never reconciles). Every other mode switches live. Non-claude backends
 *  never respawn. */
export function needsClaudeYoloRespawn(backendId: string, mode: EngineApprovalMode): boolean {
	return backendId === 'claude' && mode === 'full-auto';
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
	/** AskUserQuestion answers, keyed by the full question text → picked label(s).
	 *  Fed back to the model as the tool result via the permission response. */
	answers?: Record<string, string>;
}

/** A claude AskUserQuestion prompt (the model asking the user to choose). */
export interface Question {
	question: string;
	header?: string;
	options: { label: string; description?: string }[];
	multiSelect: boolean;
}

/** Parse the `questions` field of an AskUserQuestion approval_request. */
export function parseQuestions(raw: unknown): Question[] | null {
	if (!Array.isArray(raw)) return null;
	const out: Question[] = [];
	for (const q of raw) {
		const m = q && typeof q === 'object' ? (q as Record<string, unknown>) : null;
		if (!m || typeof m.question !== 'string') continue;
		const options: Question['options'] = [];
		for (const o of Array.isArray(m.options) ? m.options : []) {
			const om = o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
			if (om && typeof om.label === 'string') {
				options.push({
					label: om.label,
					...(typeof om.description === 'string' ? { description: om.description } : {})
				});
			}
		}
		out.push({
			question: m.question,
			...(typeof m.header === 'string' ? { header: m.header } : {}),
			options,
			multiSelect: m.multiSelect === true
		});
	}
	return out.length ? out : null;
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
