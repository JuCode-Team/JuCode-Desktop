# Engine backends

The desktop drives three agent backends through one abstraction:

| id       | child process                                                                 | stdin frames            | stdout frames        |
|----------|-------------------------------------------------------------------------------|-------------------------|----------------------|
| `jucode` | `jucode serve` (env `JUCODE_DESKTOP=1`)                                       | jucode Ops (JSON lines) | jucode AgentEvents   |
| `codex`  | `codex app-server`                                                            | JSON-RPC requests       | JSON-RPC responses/notifications |
| `claude` | `claude --print --input-format stream-json --output-format stream-json --include-partial-messages --verbose --replay-user-messages --permission-prompt-tool stdio [--permission-mode m] [--resume sid \| --session-id uuid] [--model m]` | stream-json + control frames | stream-json events |

`ChatState` (the reducer behind the whole chat UI) only understands the jucode
event dialect. Adapters translate INTO that dialect and encode OUT of the
desktop `Op` union — ChatState and the UI stay backend-agnostic.

## The contract (`types.ts`)

```ts
interface EngineAdapter {
  readonly id: BackendId;          // 'jucode' | 'codex' | 'claude'
  readonly caps: BackendCaps;      // static capability flags, see below
  onStart(io: AdapterIO, ctx: SessionCtx): void;
  translate(raw: unknown): NormalizedEvent[];   // NormalizedEvent = jucode AgentEvent
  encodeOp(op: Op): string[] | null;            // null = unsupported → caller notifies user
}
```

- **One adapter instance per session.** Adapters may (and for codex/claude
  will) be stateful: JSON-RPC request-id counters, pending-approval maps,
  partial-message assembly buffers. `createAdapter(id)` builds a fresh
  instance; the `SessionStore` owns it for the session's lifetime and registers
  it with `router.ts` so `dispatch(sessionId, op)` can find it.

### How `onStart` is invoked

`SessionStore` calls `adapter.onStart(io, ctx)` **after** `create_session`
resolves (the child is spawned and its stdout listener is already pumping) —
once for the initial spawn and once after **every** restart of the child
(crash auto-restart, provider switch). Reset per-process state there (request
counters, pending approvals — those requests died with the old process) and
send any handshake frames (`initialize` / `newConversation` for codex).
`ctx.sessionId` is the **desktop** session id (the routing key for
`send_line`), not the engine's own conversation id.

### Ordering guarantees

- `translate(raw)` is called once per stdout line, in the order the child
  wrote them. stderr lines (piped for codex/claude only) arrive as
  `{ __stderr: "<line>" }` payloads interleaved on the same callback, but
  ordering is only guaranteed *within* each stream, not across stdout/stderr.
- The events returned from one `translate()` call are applied to ChatState in
  array order, synchronously, before the next line is translated.
- `encodeOp` returns frames that are written to stdin in array order; each
  string is one line/frame (embedded newlines are rejected by `send_line`).
- Rust forwards stdout **byte-dumb**: every non-empty line, unparsed. The
  page JSON-parses the line and drops it if unparseable; adapters therefore
  always receive parsed JSON (or the `__stderr` wrapper).

### Approval bridging (codex / claude → jucode-style approvals)

The approval UI is driven entirely by jucode-shaped events. Backends must
surface their native permission prompts through it:

1. When the backend asks for permission (claude: a `control_request` with
   `subtype: "can_use_tool"` — only emitted when the child was spawned with
   `--permission-prompt-tool stdio`, otherwise gated tools are silently
   auto-denied; codex: an `execCommandApproval` /
   `applyPatchApproval` JSON-RPC **server→client request**), the adapter
   - allocates a **synthetic `call_id`** (e.g. `approval-<n>`),
   - records `call_id → native request id (+ whatever the response needs)` in
     its **pending-approval registry**,
   - emits a jucode-style event:
     `{ type: 'approval_request', call_id, name, summary, hunks?: null, subagent_id?: null }`.
2. The UI answers with `encodeOp({ op: 'approve', call_id, decision, always?, hunks? })`.
   The adapter looks the `call_id` up in its registry, encodes the native
   response (claude: `control_response` with `behavior: "allow" | "deny"`;
   codex: the JSON-RPC response `{ decision: "approved" | "denied" }` for the
   recorded request id), removes the registry entry and returns the frame.
   An unknown `call_id` (stale after a restart) should return `null`.
3. `onStart` clears the registry — pending prompts do not survive the child.

Only advertise `caps.hunkApproval` if the backend can actually apply a
partial patch; otherwise the approval card hides hunk checkboxes.

### Capability flags → UI surfaces

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

## Rust surface (fixed, do not extend per-adapter)

- `create_session(session, cwd?, backend?, backend_opts?)` — validates
  `backend_opts` against a fixed per-backend allowlist
  (`src-tauri/src/backend.rs`):
  - jucode: `{ bin_override? }`
  - codex: `{ bin_override? }` (models etc. are per-conversation JSON-RPC)
  - claude: `{ bin_override?, permission_mode?, resume?, session_id?, model? }`
- `send_op(session, op)` — structured op, jucode compat path.
- `send_line(session, line)` — raw single-frame write (what adapters use).
- `check_backend(backend, bin_override?) → { found, path?, version? }`.
- `claude_sessions(cwd)` / `claude_session_transcript(cwd, id)` — read-only,
  bounded access to Claude Code's on-disk session store (`claude_history.rs`;
  drives the claude /resume picker + transcript replay, page-side).

Binary resolution order: `JUCODE_BIN`/`CODEX_BIN`/`CLAUDE_BIN` env override →
settings path override → PATH → well-known dirs (`/opt/homebrew/bin`,
`/usr/local/bin`, `~/.cargo/bin`, `~/.local/bin`, claude's `~/.claude/local`,
Windows equivalents) → (jucode only) sibling dev build.

Implementing the codex/claude adapters required **almost no per-adapter Rust
surface**: fill in `translate` / `encodeOp` / `onStart` and widen the
adapter's `caps`. The one exception is claude's /resume picker (below), which
needs read-only filesystem access to Claude Code's session store.

Claude's permission modes are pushed live over the control protocol
(`set_permission_mode`). Model switching is live too (verified against claude
2.1.208): `list_models` returns the picker catalog (`value` is what set_model
accepts, `resolvedModel` the concrete id that system/init reports) and
`set_model` switches in place, context preserved — onStart prefetches the
catalog, a bare `/model` re-fetches it tagged `view` → `model_view`, a pick
sends `set_model` and the ack emits `model_status`. There is no set-effort
control request in stream-json mode, so `reasoning_efforts` stays empty and
the effort submenu hidden. `/compact` is sent as plain stream-json user text
(the CLI executes slash commands from stdin): `system/status
{status:"compacting"}` → compaction_start, `system/compact_boundary` →
compaction_end, a non-success `compact_result` → compaction_failed;
slash-command echo frames (`<command-name>…`/`<local-command-stdout>…`) are
suppressed.

Claude resume passes the already-allowlisted `resume` spawn option through
`SessionStore.#spawn` (crash auto-restart, saved-tab restore and picker
picks). There is no session-listing protocol in stream-json mode; the /resume
picker instead lists Claude Code's session files
(`~/.claude/projects/<munged-cwd>/<session-id>.jsonl`, munging = every
non-ASCII-alphanumeric char → `-`) via the read-only `claude_sessions(cwd)`
Rust command (`src-tauri/src/claude_history.rs`) — the PAGE intercepts a bare
`/resume` for claude sessions and synthesizes the `resume_view` itself, so
the op never reaches `encodeOp`. Picking opens a fresh desktop session
spawned with `--resume <id>`; `claude_session_transcript(cwd, id)` replays
the session file's user/assistant text as a `transcript` event
(`caps.transcriptReplay`).

Codex resume is a **protocol call, not a spawn flag**: the thread id rides
`SessionCtx.resume` (a `#spawn` parameter, so the codex `backend_opts`
allowlist stays `{ bin_override? }`) and the adapter answers the initialize ack
with `thread/resume {threadId, cwd, approvalPolicy, sandbox}` instead of
`thread/start`. The response carries the persisted history
(`thread.turns[].items`) which is replayed as a `transcript` event
(`caps.transcriptReplay`). The /resume picker lists `thread/list {cwd}`;
picking an item opens a new codex-backed desktop session, while a typed
`/resume <id>` switches threads in place on the same child (the app-server
hosts many threads per process). Model switching has no thread-level set RPC
in codex-cli 0.144.x: `/model` builds the picker from `model/list` and a pick
becomes `model`/`effort` overrides on every subsequent `turn/start` ("this
turn and subsequent turns" — persisted into the rollout, so resumes keep it).
`/compact` maps to `thread/compact/start` (compaction runs as its own turn
wrapping a `contextCompaction` item) and `/goal` to the `thread/goal/*` RPCs.
