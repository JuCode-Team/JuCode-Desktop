// Pure helpers for the GUI ⇄ TUI session handoff: which backends can hand a
// conversation to the native TUI, and the resume argv / slash command a
// TuiPanel spawn uses to continue that conversation by session id. Mirrors
// the Rust-side allowlist (`backend::validate_tui_args`) so the UI never
// offers a spawn Rust would reject.

import type { BackendId } from './backends/types';

/** Mirrors Rust `is_valid_session_id`: nonempty, ≤64 chars, no leading dash,
 *  ascii alphanumerics + dashes only. */
export function isValidResumeSessionId(s: string): boolean {
	return s.length > 0 && s.length <= 64 && !s.startsWith('-') && /^[a-zA-Z0-9-]+$/.test(s);
}

/** Backends whose session can move to the native TUI. ACP agents have no
 *  fixed TUI binary and are never offered a handoff. */
export function canHandOffToTui(backend: BackendId): boolean {
	return backend === 'jucode' || backend === 'claude' || backend === 'codex';
}

/** Extra argv for the TUI spawn of a handed-off session (exactly the shapes
 *  `validate_tui_args` accepts). jucode has no resume argv — see
 *  `tuiResumeCommand`. */
export function tuiResumeArgs(backend: BackendId, sid: string): string[] {
	if (!isValidResumeSessionId(sid)) return [];
	if (backend === 'claude') return ['--resume', sid];
	if (backend === 'codex') return ['resume', sid];
	return [];
}

/** The `/resume <id>` line written into a fresh jucode TUI pty (the jucode
 *  TUI resumes via slash command, not argv). Undefined for other backends. */
export function tuiResumeCommand(backend: BackendId, sid: string): string | undefined {
	return backend === 'jucode' && isValidResumeSessionId(sid) ? `/resume ${sid}\n` : undefined;
}
