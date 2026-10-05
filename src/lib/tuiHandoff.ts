// Pure helpers for the GUI ⇄ TUI session handoff: which backends can hand a
// conversation to their own TUI, and which conversation ids it can resume.
// The daemon runs the TUI itself (`session_tui`).

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
