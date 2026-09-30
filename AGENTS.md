# JuCode Desktop

## Terms

- **后端 (backend)**: the agent backend — the coding-agent engine that runs a session: JuCode's own engine, Claude Code, Codex, or an ACP agent. In code it is `BackendId` / `backendId`; the daemon protocol calls it `engine`. It never means a server side, the daemon (the UI calls that 后台服务, "background service"), or a model provider (`provider`).
- **草稿 (draft session)**: a new session before its first message. It has a chosen backend, model and effort but no engine and no daemon session; the first op sent to it starts the engine (`markDraft` in `src/lib/backends/router.ts`, `SessionStore.#startDraft`). Until then nothing may spawn a backend: switching backend, model or effort only records the choice.
