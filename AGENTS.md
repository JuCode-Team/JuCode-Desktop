# JuCode Desktop

## Terms

- **后端 (backend)**: the agent backend — the coding-agent engine that runs a session: JuCode's own engine, Claude Code, Codex, or an ACP agent. In code it is `BackendId` / `backendId`; the daemon protocol calls it `engine`. It never means a server side, the daemon (the UI calls that 后台服务, "background service"), or a model provider (`provider`).
- **草稿 (draft session)**: a new session before its first message. It has a chosen backend, model and effort but no engine and no daemon session; the first op sent to it starts the engine (`markDraft` in `src/lib/backends/router.ts`, `SessionStore.#startDraft`). Until then nothing may spawn a backend: switching backend, model or effort only records the choice.

## Recurring defects

- An `$effect` that calls store methods reads that store's state too, so the store's own changes re-run it (the web chat reset a new conversation as its first message saved it). Wrap the calls in `untrack` and depend only on the inputs that should drive it.
- The CSP applies only to the packaged app, so dev mode and CI never hit it. Tauri adds a nonce to `style-src` once the HTML has a `<style>`, and that disables `'unsafe-inline'`; CodeMirror then loses every style. `src/csp.test.ts` pins the settings the frontend needs. Before a release, open the editor and a reply with math in a packaged build.
- The daemon outlives desktop updates, so a field a newer desktop reads may be missing from the daemon still running. Treat a missing field as unknown and keep the current state; never read it as null or empty (read as null, a missing `project` would move every session out of its project, and the next save would drop their tabs from workspaces.json).
- A session the daemon closed for idleness is asleep (`markAsleep`), not exited: it must not restart on its own, and anything that starts its engine clears the sleep (`#spawn` does). An op a sleeping session should act on goes in the router's `WAKING`, or it waits silently.
