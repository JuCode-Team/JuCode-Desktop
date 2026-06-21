# JuCode Desktop (MVP)

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

- `src-tauri/src/lib.rs` — spawns `jucode serve`, pumps its stdout to the webview
  as `agent-event` events, and exposes the `send_op` command (writes a JSON command
  to the engine's stdin).
- `src/lib/protocol.ts` — command types and `sendOp`.
- `src/lib/chat.svelte.ts` — reactive state projected from the `AgentEvent` stream.
- `src/routes/+page.svelte` — the chat UI (streaming replies, tool cards, status
  bar, image attachment via drag-and-drop).

## Prerequisites

- The `jucode` binary. Check out [JuCode-CLI](https://github.com/JuCode-Team/JuCode-CLI)
  as a sibling of this repo and run `cargo build` in it. The app then auto-resolves
  `../JuCode-CLI/target/{debug,release}/jucode`. Otherwise set `JUCODE_BIN` to the
  binary path, or have `jucode` on `PATH`.
- Node + pnpm, Rust toolchain, and the platform Tauri prerequisites
  (https://v2.tauri.app/start/prerequisites/).

## Run (dev)

```sh
cd desktop
pnpm install
pnpm tauri dev
```

## Configuration (env vars)

- `JUCODE_BIN` — path to the `jucode` binary (overrides auto-resolution).
- `JUCODE_CWD` — working directory the agent operates in (defaults to the repo root).

## Status

MVP: chat streaming, reasoning blocks, tool cards, model/context/cost status bar,
interrupt, slash commands (typed into the composer), and image attachments.
Not yet ported from the TUI: interactive pickers for `/tree`, `/model`, `/resume`
(they currently work by typing the resulting command, e.g. `/checkout <id>`).
