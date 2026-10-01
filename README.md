# JuCode Desktop

A Tauri 2 + SvelteKit desktop GUI for [JuCode-CLI](https://github.com/JuCode-Team/JuCode-CLI).
Every session runs in the local `jucode daemon` (started on demand), which
hosts the JuCode engine, Claude Code, Codex and ACP agents and speaks one
WebSocket protocol for all of them (CLI repo, `docs/daemon-protocol.md`).

## Architecture

```
WebView (Svelte)  ──WebSocket (ops / events)──▶  jucode daemon  ──▶  engines
       │
       └──invoke(…)──▶  src-tauri (Rust): daemon start, files, git, PTY, …
```

- `src-tauri/src/lib.rs` — starts the daemon (`daemon_endpoint`) and hosts the
  IDE-side commands that operate directly on the project directory — file walk,
  git, a real PTY terminal, config/auth read-write, environment checks, and
  temp-image writes.
- `src/lib/protocol.ts` — command types, the daemon connection and the
  `invoke` wrappers.
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
  context/cost ring, combined JuCode + Anthropic skills marketplace (run by `jucode daemon`).
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

## Provider catalog

Settings uses the vendored snapshot at `src/lib/providers/catalog.json`. It is a
small, agent-capable subset of [models.dev](https://models.dev), with OpenRouter
featured for users who want one key across several model vendors. Catalog
providers use the same local BYOK path as manually configured providers; no
proxy service is bundled.

Refresh the snapshot when provider endpoints or model lists change:

```sh
pnpm catalog:refresh
```

The refresh command reads `https://models.dev/api.json` and therefore needs
network access. It can also read an already downloaded API response:
`node scripts/refresh-provider-catalog.mjs ./api.json`. Tests parse only the
vendored file and never call models.dev.

models.dev is MIT licensed. The generated JSON starts with source and copyright
attribution; the upstream license is kept in
`src/lib/providers/models.dev.LICENSE`.

## Configuration (env vars)

- `JUCODE_BIN` — path to the `jucode` binary (overrides auto-resolution).
- `JUCODE_CWD` — working directory the agent operates in (defaults to the launch dir).
