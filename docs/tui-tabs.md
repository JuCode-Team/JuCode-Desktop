# Native TUI tabs

A TUI tab runs the **real interactive CLI** — `jucode`, `codex` or `claude` —
inside the desktop app: a pty (portable-pty) on the Rust side, xterm.js on the
front. Nothing is re-rendered or emulated; what you see is exactly what the
terminal would show.

## Opening a tab

- **Command palette** (⌘K): "Open TUI: JuCode / Codex / Claude Code". This
  re-activates an existing tab for that backend if one is open.
- **Dock "+" menu** (mosaic leaf or classic tab bar): the `TUI · jucode` /
  `TUI · codex` / `TUI · claude` entries. Each pick spawns a fresh tab, so you
  can deliberately run several at once.

The process starts in the active project's directory. Closing the tab kills
the process; restarting after exit spawns a new one.

## v1 semantics

- **Independent session.** A TUI tab is its own process with its own session
  state. It is *not* another view of a GUI chat session, and there is no
  handoff between the two.
- Tab kinds are `tui:<backend>` in the dock/mosaic layout (see
  `src/lib/workbench/tuiTab.ts`). They persist with the layout and respawn a
  fresh process on app restart, like terminal tabs.

## Security model

The webview never passes argv or a program path directly:

- `pty_open` accepts a `command` **name** that must parse as one of the fixed
  backends (`jucode` / `codex` / `claude`); anything else is rejected.
- Extra `args` are validated against a per-backend exact-token allowlist
  (`backend::validate_tui_args`): none for jucode, `resume` for codex,
  `--continue` / `--resume` for claude. No values, no free-form flags.
- The binary resolves exactly like engine spawns (`backend::resolve_backend_bin`):
  env override (`JUCODE_BIN` …) → settings path (`bin_override`, validated) →
  PATH → well-known install dirs.
- The TUI child gets the login-shell env snapshot overlaid (see
  `shell_env.rs`) so PATH / proxy / CA vars match the user's terminal, plus
  `TERM=xterm-256color`.

## Missing binary

If the CLI can't be found anywhere, `pty_open` fails fast with
`binary-missing:<name>` and the tab shows install guidance with a shortcut to
Settings → Engine backends instead of a dead terminal.
