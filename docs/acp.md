# ACP backend (Agent Client Protocol)

The desktop can drive agent CLIs that speak the
[Agent Client Protocol](https://agentclientprotocol.com) (JSON-RPC 2.0 over
stdio, protocol v1, stable schema only) as a fourth engine backend, next to
the native `jucode`, `codex` and `claude` adapters. Three agents are built in
(OpenCode, oh-my-pi, Pi); others can be registered in Settings. The daemon
runs every ACP agent and translates it into the jucode event protocol; the
contract is JuCode-CLI `docs/daemon-protocol.md`.

## Where the pieces live

| piece | file |
|---|---|
| Built-in agents (preset table, launch, gateway files) | the daemon, JuCode-CLI `crates/daemon/src/engines/acp_presets.rs` |
| Custom agent registry (Rust-owned, validated) | `src-tauri/src/acp_registry.rs` → `~app-config/acp-agents.json` |
| Process and JSON-RPC ↔ AgentEvents | the daemon, JuCode-CLI `crates/daemon/src/engines/acp.rs` |
| Session start (preset id or registry entry → daemon `engine: "acp"`) | `src/lib/session.svelte.ts` (`#spawn`) |
| Per-session caps (`engine_caps` over `ACP_CAPS`) | `src/lib/backends/index.ts` (`caps`), `src/lib/chat.svelte.ts` |
| Engine picker rows, session options, gateway switch | `src/lib/composer/ModelMenu.svelte` |
| Settings UI (built-in agents; add / edit / remove custom agents) | `src/lib/settings/AcpSection.svelte` |

## Built-in agents

The daemon owns the preset table; the desktop lists it with the `acp_presets`
request (status `ready` / `missing` / `unsupported`, version, install command)
and starts a session by id:

```json
{"engine":"acp","options":{"agent":"omp","approval_mode":"read-only","jucode_gateway":false}}
```

No command, arguments or environment come from the client: the daemon
resolves the program, its arguments and the approval mode's launch flags.

| id | agent | approvals | JuCode gateway |
|---|---|---|---|
| `opencode` | OpenCode (`opencode acp`) | asked (ask / edits modes) | no: runs on the user's own OpenCode providers |
| `omp` | oh-my-pi (`omp acp --approval-mode …`, never its default yolo) | asked | yes |
| `pi` | Pi through the community adapter `pi-acp` | none (labelled 无审批) | yes |

A tab and a project's last choice persist the agent as
`{ id, name, preset: true }`; entries without `preset` are custom agents.
The gateway switch (`SessionStore.applyToolProfile`) restarts the agent's
process with `jucode_gateway` and reopens the conversation, as for Claude
Code / Codex.

Built-in agents are also offered on paired phones (`src/lib/remote/engines.ts`:
the remote picker, requirements), in scheduled tasks (`ScheduleDialog`:
`engine: "acp"`, `options: { agent, jucode_gateway }`) and as a TUI handoff:
"在终端中打开" asks the daemon for `session_tui`, which runs the agent's own
TUI resuming the same conversation (`tuiHandoff.ts`; the remote page shows it
in `remote/TerminalView.svelte`).

## Custom agents: the registry names the command

A registered agent is `{ id, name, command, args, env }`. Every entry is
re-validated on **every read and write** of the registry file, so a
hand-edited `acp-agents.json` cannot smuggle malformed entries into a spawn.
A session starts from the entry: the desktop sends its command line to the
daemon (`session_create` with `engine: "acp"`), which only local clients may
do — paired phones can watch and drive such a session but never start or
reopen one, and it has no TUI handoff.
The daemon resolves `command` on its `PATH` and runs `command args…` with
`env` on top of its own environment. A new entry's id never takes a built-in
agent's id.

## Capabilities per session

`ACP_CAPS` is the all-off baseline. After the handshake the daemon sends
`engine_caps` (a state event, so snapshots carry it) and `caps(chat)` merges
its `caps` over the baseline (boolean values of known keys only):

| cap | on when |
|---|---|
| `interrupt` | always (`session/cancel`) |
| `approvalModes` | a built-in agent with launch modes for ask / edits / all (a change restarts the agent after the turn) |
| `modelPicker` | the agent offers a `model` config option |
| `contextUsage` | a `usage_update` arrived |
| `slashCommands` | the agent listed commands (sent as prompt text) |
| `transcriptReplay` | `session/load`: reopening replays the conversation |

`engine_caps` also says who the agent is (`agent.id`: preset id or null),
whether it asks before running tools (`approvals`: false shows 无审批 in the
composer, null for custom agents) and whether it has a gateway mode. The
chat drops all of it on `startup` until the agent reports again.

## Protocol mapping

| ACP | desktop surface |
|---|---|
| `agent_message_chunk` / `agent_thought_chunk` (during a turn or a load) | assistant text / reasoning stream |
| `tool_call` / `tool_call_update` (`diff` content) | ToolCard, diff view |
| `plan` | Plan panel |
| `session/request_permission`, `elicitation/create` (form) | ApprovalCard (a form becomes questions) |
| config options `model` / `thought_level` | `model_status`, `/model <value> [effort]`, effort slider |
| other config options, or legacy modes | `session_options` → the model menu's options (`set_session_option`) |
| `usage_update` | context ring (`context_usage`) |
| `available_commands_update` | command list |
| `notice` | info / error line |
| `session/load` replay | one `transcript` |
| stop button | `session/cancel` (open permissions and forms are cancelled first) |
| `stopReason` `refusal` / `max_tokens` / `max_turn_requests` | info notice |

Messages sent while a turn runs wait in the daemon (`pending_messages`) and
run as their own turns.

### What does not map

Only stable ACP is used; what it cannot express is not offered: steer, hunk
approvals, rewind / checkpoints, branch tree, goals, skills, MCP management
(`mcpServers` is sent empty), subagents and the agent trace, `/compact`, a
history picker (`resume`). The client advertises no fs or terminal service;
such requests are declined with a JSON-RPC error.

## Adding an agent

Settings → 编程智能体 → ACP: the built-in agents show whether they are
installed (and the install command when not). *Add agent* registers a custom
one: a display name, a command (name or absolute path), optional fixed
arguments (quoted tokens supported) and optional per-agent `KEY=VALUE` env
lines. Agents appear in the engine picker on new (virgin) sessions; each
project remembers its last choice. Bounds: ≤ 32 agents, ≤ 32 args,
names/commands/args length- and control-character-checked, env names/values
validated like custom backend env (dangerous variables rejected).

Tests: `src/lib/backends/caps.test.ts` (caps merge),
`src/lib/backends/session-backend.test.ts` (preset and custom spawn specs,
restore), `src/lib/chat.test.ts` (`engine_caps`, `session_options`),
`src/lib/backends/acp-agents.test.ts` (settings-form helpers), the registry
tests in `src-tauri/src/acp_registry.rs` / `backend.rs`, and the daemon's own
ACP tests (JuCode-CLI `crates/daemon`).
