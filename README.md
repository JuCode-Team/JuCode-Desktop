# JuCode Desktop

A Tauri 2 + SvelteKit desktop GUI for [JuCode-CLI](https://github.com/JuCode-Team/JuCode-CLI).
The app launches the CLI as a sidecar (`jucode serve`) and talks to it over the
newline-delimited JSON protocol (documented in the CLI repo under
`docs/desktop-gui-design.md`).

## Architecture

```
WebView (Svelte)  ──invoke('send_op', …)──▶  src-tauri (Rust)  ──stdin──▶  jucode serve
       ▲                                            │                          │
       └────────── 'agent-event' event ─────────────┴────────── stdout (NDJSON)┘
```

- `src-tauri/src/lib.rs` — spawns a `jucode serve` child per session, pumps its
  stdout to the webview as `agent-event` events, and exposes `send_op` (writes a
  JSON command to stdin). Also hosts IDE-side commands that operate directly on the
  project directory — file walk, git, a real PTY terminal, config/auth read-write,
  environment checks, and temp-image writes.
- `src/lib/protocol.ts` — command types and the `invoke` wrappers.
- `src/lib/chat.svelte.ts` — reactive `ChatState` projected from the `AgentEvent` stream.
- `src/routes/+page.svelte` — the shell: sidebar, chat view, right dock, modals.
- Pure logic lives in framework-free modules so it's unit-tested:
  `mention.ts` (@-completion), `tree.ts` (branch tree), `approval.ts` (auto-approve policy).

## Features

- **Chat** — streaming replies with incremental markdown + syntax highlighting,
  per-round reasoning blocks, tool-execution cards (diffs, command output, images),
  smooth adaptive reveal, phase indicator, interrupt, steer/queue.
- **Multi-project / multi-session** — projects (by directory) each with their own
  conversation tabs; layout + open tabs persist across launches; engine **crash
  auto-restart** (resumes the conversation).
- **Command palette** (`⌘K`) — searchable quick actions plus the engine's slash commands.
- **Approval modes** — client-side `谨慎 / auto-edit / full-auto`; richer approval
  card; background sessions flag when they need a decision.
- **@-mention** — completes files **and folders**, fuzzy-ranked, drills into folders
  on a trailing `/`. Filesystem-based (no git dependency); heavy dirs pruned.
- **Edit & rewind** — rewind the conversation (and files) to an earlier turn.
- **In-conversation find** (`⌘F`) and filterable history/branch pickers.
- **Right dock** — Plan, Goal, Files, Git (stage / commit / discard / diff), Terminal.
- **Setup wizard** — first-run environment check (git + engine), guided/auto install,
  JuCode OAuth login or API-key path; **logout** per provider in settings.
- **Branch tree** (`/tree`), **resume** (`/resume`), **model picker** (`/model`),
  context/cost ring, skills marketplace.
- **Theming** — system / light / dark; image paste & drag-drop; desktop notifications.

Keyboard: `⌘K` palette · `⌘F` find · `⌘N` new session · `⌘B` toggle panel · `⌘,` settings.

## Prerequisites

- The `jucode` binary. Check out [JuCode-CLI](https://github.com/JuCode-Team/JuCode-CLI)
  as a sibling of this repo and run `cargo build` in it. The app then auto-resolves
  `../JuCode-CLI/target/{debug,release}/jucode`. Otherwise set `JUCODE_BIN` to the
  binary path, or have `jucode` on `PATH`. (The packaged app bundles it as a sidecar.)
- Node + pnpm, Rust toolchain, and the platform Tauri prerequisites
  (https://v2.tauri.app/start/prerequisites/).

## Run (dev)

```sh
pnpm install
pnpm tauri dev
```

## Develop

```sh
pnpm check        # svelte-check (types)
pnpm test         # vitest (pure-logic unit tests)
pnpm build        # production frontend build
pnpm tauri build  # packaged app (bundles the engine sidecar)
```

## Configuration (env vars)

- `JUCODE_BIN` — path to the `jucode` binary (overrides auto-resolution).
- `JUCODE_CWD` — working directory the agent operates in (defaults to the launch dir).
