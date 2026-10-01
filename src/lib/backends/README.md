# Engine backends

Every session runs in the local `jucode daemon` (JuCode-CLI
`docs/daemon-protocol.md`), whichever backend it uses:

| id       | what the daemon runs |
|----------|----------------------|
| `jucode` | the JuCode engine, in-process |
| `claude` | `claude --print --input-format stream-json …` |
| `codex`  | `codex app-server` |
| `acp`    | a registered ACP agent (`jucode acp`, `gemini --experimental-acp`, …), command line from the registry (`docs/acp.md`) |

The daemon translates each engine into the jucode event protocol and client
ops into the engine's own frames, so the desktop talks one protocol to all of
them: `ChatState` (the reducer behind the chat UI) and every view are
backend-agnostic, and each session's adapter is the jucode one.

## Sessions in the daemon

`src/lib/daemon.ts` keeps one WebSocket to the daemon, which the desktop
starts on demand (`daemon_endpoint`, with the jucode backend's binary and
environment from Settings). `SessionStore.#spawn` opens a session with
`session_create`, or reopens one with `session_open` by its conversation id
(restore, restart, provider or gateway switch). Claude Code and Codex
sessions pass an engine spec: approval mode, the JuCode gateway switch, the
binary and environment from Settings, and claude's `resume_at` for a rewind.

- Closing the desktop only disconnects: sessions keep running, and deferred
  actions wait in the daemon.
- Closing a tab ends its daemon session (`session_close`) and hides it for
  every client.
- A tab persists its conversation id as `sid`; restore lists it dormant and
  opens it when it is first shown.
- A daemon that can't be reached is retried with backoff for about 4.5
  minutes before the tab shows an error.

## The adapter (`types.ts`, `jucode.ts`)

```ts
interface EngineAdapter {
  readonly id: BackendId;
  readonly caps: BackendCaps;
  onStart(io: AdapterIO, ctx: SessionCtx): void;
  translate(raw: unknown): NormalizedEvent[];   // NormalizedEvent = jucode AgentEvent
  encodeOp(op: Op): string[] | null;
}
```

The jucode adapter passes events through, checks the `hello` protocol
version and maps approval-mode names between the desktop's trio and the
engine's (`read-only` ↔ `manual`, `full-auto` ↔ `full-access`).
`router.ts` holds each session's adapter and its op queue while the engine
is (re)starting; `dispatch(sessionId, op)` is how every UI call site sends.

### Capability flags → UI surfaces

`caps.ts` says which protocol features each backend's engine supports.

| cap             | gated surface(s) |
|-----------------|------------------|
| `approvalModes` | composer approval-mode picker |
| `hunkApproval`  | per-hunk checkboxes on the approval card |
| `steer`         | queued-messages “steer” button |
| `interrupt`     | stop button while busy |
| `branchTree`    | /tree palette entry, branch picker |
| `goals`         | right-dock Plan/Goal tabs |
| `skills`        | marketplace palette entry / install actions |
| `mcpManage`     | Settings → 扩展 MCP mutations |
| `checkpoints`   | /rewind palette entry, checkpoint picker, per-message rewind |
| `contextUsage`  | composer context ring |
| `compact`       | /compact palette entry (compaction_start/end/failed events) |
| `modelPicker`   | composer model button, /model palette entry, provider switch (provider switch itself is jucode-only: it rewrites the native engine's config) |
| `resume`        | /resume palette entry, history picker, tab persistence |
| `subagents`     | subagent status strip |
| `transcriptReplay` | resume replays the transcript into the message list |
| `slashCommands` | generic slash entries (/compact, /context, /stats, /doctor, engine command list) |

The single gating helper is `caps(chat)` from `$lib/backends` — components
never test `backendId` directly.

### Claude specifics the desktop still drives

- **Yolo** (`bypassPermissions`) can't be set live: `respawnClaudeYolo` closes
  the daemon session and reopens it in that mode.
- **Rewind**: the daemon reopens the conversation with
  `--resume-session-at <assistant uuid>`; the desktop truncates its transcript
  to match.
- Reopening a claude conversation keeps the messages this tab already shows
  (`ChatState.keepNextTranscript`): the daemon's replay is plain text, without
  tool cards or message uuids.
- `/resume` has no wire form in stream-json mode: ChatPane builds the picker
  from the daemon's `session_history` for the project and opens a pick in a
  new tab.

## Rust surface

- `daemon_endpoint(bin_override?, env?)` — the daemon's URL and token,
  starting it first when needed.
- `check_backend(backend, bin_override?) → { found, path?, version? }` —
  Settings' availability probe.
- `pty_open` — native TUI tabs, with a fixed per-backend argv allowlist
  (`src-tauri/src/backend.rs`).

Binary resolution order: `JUCODE_BIN`/`CODEX_BIN`/`CLAUDE_BIN` env override →
settings path override → PATH → well-known dirs (`/opt/homebrew/bin`,
`/usr/local/bin`, `~/.cargo/bin`, `~/.local/bin`, claude's `~/.claude/local`,
Windows equivalents) → (jucode only) sibling dev build.
