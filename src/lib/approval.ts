// Client-side tool-approval policy. The engine has no approval config, so the
// desktop decides whether to auto-respond to an approval_request.

export type ApprovalMode = 'ask' | 'edits' | 'all';

// File-mutating tools the engine gates (the rest it gates are shell tools).
export const EDIT_TOOLS = ['write', 'edit', 'str_replace', 'hashline_edit', 'apply_patch'];

/** Whether a gated tool call should be auto-approved under the given mode. */
export function shouldAutoApprove(mode: ApprovalMode, name: string): boolean {
	return mode === 'all' || (mode === 'edits' && EDIT_TOOLS.includes(name));
}
