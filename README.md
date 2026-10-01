# JuCode Desktop

A desktop workbench for coding agents. One window runs JuCode's own agent,
Claude Code, Codex and any [ACP](https://agentclientprotocol.com) agent side by
side, across projects, with the files, git and terminal of each project next to
the conversation.

Status: closed beta.

## Download

Get the latest build from
[Releases](https://github.com/JuCode-Team/JuCode-Desktop/releases/latest):

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `JuCode_<version>_aarch64.dmg` |
| Windows x64 | `JuCode_<version>_x64-setup.exe` (or `.msi`) |
| Linux x64 | `JuCode_<version>_amd64.AppImage`, `.deb` or `.rpm` |

The beta builds are not code-signed yet, so macOS and Windows warn on first
launch. [docs/install.md](docs/install.md) shows how to open the app and grant
the permissions it asks for. The app updates itself after that.

On first launch a setup guide checks for git and the JuCode CLI, installs what
is missing, and signs you in to JuCode. Claude Code and Codex are optional;
the guide installs them from their official sources when you want them.

## What it does

- **Several agents, one window.** JuCode, Claude Code, Codex and ACP agents,
  each in its own session. A session can also run the real TUI of `jucode`,
  `codex` or `claude` in a terminal tab.
- **Workbench.** Projects by directory, sessions per project, split panes,
  a right dock with plan, files, git (stage, commit, discard, diff), terminal and
  a built-in browser whose page elements can be referenced in a message.
- **Conversation tools.** Streaming markdown, tool cards with diffs and output,
  approvals, rewind (conversation and files), branch tree, resume, find, slash
  commands, `@` file mentions, images, voice input and screen capture.
- **Models and providers.** The JuCode gateway (sign in with your JuCode
  account), your own API keys, or the tools' own sign-in. Claude Code and Codex
  sessions can run on this machine's login or on the JuCode gateway, with a
  gateway group per session; their plan usage shows in the model menu.
- **Background service.** Every session runs in the local JuCode daemon
  (`jucode daemon`, started on demand), so it keeps going when the window
  closes and can be followed from the JuCode web app through an end-to-end
  encrypted relay.
- **History.** Import existing Claude Code and Codex conversations of a project
  and continue them.
- **Skills marketplace** ([docs/skills.md](docs/skills.md)) and first-party
  plugins ([docs/plugins.md](docs/plugins.md)).

Keyboard: `⌘K` command palette · `⌘F` find · `⌘N` new session · `⌘B` session
list · `⌘,` settings (Ctrl on Windows and Linux).

## Data and privacy

- Credentials live in `~/.jucode/auth.json`, in plain text unless encryption
  is turned on in settings ([docs/secrets.md](docs/secrets.md)).
- Prompts and code go to the model provider of the session: the JuCode gateway,
  the provider of your own key, or the tool's own service.
- The daemon keeps a connection to `wss://app.jucode.net/relay/v1` for remote
  access. Conversation content is
  end-to-end encrypted; the relay sees connection metadata only.
- Voice input sends the recording to the configured speech-to-text service.
- The app checks GitHub Releases for updates. It has no analytics.

## Architecture

```
WebView (Svelte 5)  ── WebSocket (ops / events) ──▶  jucode daemon  ──▶  JuCode, Claude Code, Codex, ACP agents
       │
       └── invoke ──▶  src-tauri (Rust): daemon start, files, git, PTY, config, installers, updates
```

- The daemon (`ws://127.0.0.1:7788`) runs every engine and translates each
  protocol into one event stream; `src/lib/chat.svelte.ts` projects it into
  the conversation state.
- `src-tauri/src/` starts the daemon and hosts the project-side commands.
- `src/routes/+page.svelte` is the shell; `src/lib/workbench/` the split panes.
- Logic without UI lives in plain TypeScript modules with unit tests.

The daemon protocol is documented in the CLI repository:
[docs/daemon-protocol.md](https://github.com/JuCode-Team/JuCode-CLI/blob/main/docs/daemon-protocol.md).

## Development

Requirements: Node with pnpm, a Rust toolchain, the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) of your
platform, and a `jucode` binary. Check out
[JuCode-CLI](https://github.com/JuCode-Team/JuCode-CLI) next to this repository
and run `cargo build` there, or point `JUCODE_BIN` at a binary.

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm check          # svelte-check
pnpm test           # vitest
pnpm tauri build    # package the app
```

Environment variables:

- `JUCODE_BIN`, `CLAUDE_BIN`, `CODEX_BIN`: use this binary for the engine.
- `JUCODE_CWD`: the directory the agent works in when none is given (default:
  where the app was launched).

Releases and updates: [docs/updater.md](docs/updater.md).

### Provider catalog

Settings lists providers from `src/lib/providers/catalog.json`, an
agent-capable subset of [models.dev](https://models.dev). Refresh it with
`pnpm catalog:refresh` (needs network access), or from a downloaded response
with `node scripts/refresh-provider-catalog.mjs ./api.json`. Tests read only
the vendored file.

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright 2026 Jucode Innovations INC.

The license covers the code. The JuCode name and logo are trademarks of Jucode
Innovations INC. and are not licensed for use by forks. Claude Code, Codex and
other tools the app works with belong to their owners and are installed from
their official sources.
