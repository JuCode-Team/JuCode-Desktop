// Pure helpers for the GUI ⇄ TUI session handoff: which backends can hand a
// conversation to their own TUI, and which conversation ids it can resume.
// The daemon runs the TUI itself (`session_tui`) and resolves its command.

/** Mirrors Rust `is_valid_session_id`: nonempty, ≤64 chars, no leading dash,
 *  ascii alphanumerics + dashes only. */
export function isValidResumeSessionId(s: string): boolean {
	return s.length > 0 && s.length <= 64 && !s.startsWith('-') && /^[a-zA-Z0-9-]+$/.test(s);
}

/** The ACP presets whose TUI the daemon knows (`acp_presets` `tui`). */
const TUI_PRESETS = new Set(['opencode', 'omp', 'pi']);

/** The preset id of an ACP session's agent; none for a registered agent. */
export function presetOf(agent: { id: string; preset?: boolean } | undefined): string | undefined {
	return agent?.preset ? agent.id : undefined;
}

/** Backends whose session can move to the native TUI: the native CLIs, and
 *  ACP sessions of a built-in preset (`agent`, its id). A registered ACP
 *  agent has no TUI the daemon could resolve. */
export function canHandOffToTui(backend: string, agent?: string | null): boolean {
	if (backend === 'acp') return !!agent && TUI_PRESETS.has(agent);
	return backend === 'jucode' || backend === 'claude' || backend === 'codex';
}
