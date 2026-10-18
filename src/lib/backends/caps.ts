// What each backend's sessions can do in the UI. The daemon runs every
// backend and translates it into the jucode protocol; these flags say which
// of the protocol's features the engine behind it actually supports.

import type { BackendCaps } from './types';

export const CLAUDE_CAPS: BackendCaps = {
	approvalModes: true, // set_permission_mode control request (live, acked)
	extendedApprovalModes: true, // native plan + auto permission modes
	planMode: true,
	hunkApproval: true, // MultiEdit splits into per-edit hunks (single Edit stays whole-call)
	steer: false, // stdin is already a queue: mid-turn messages run as the next turn
	interrupt: true, // control_request subtype interrupt
	branchTree: false,
	goals: false,
	skills: false,
	mcpManage: true,
	checkpoints: true, // conversation rewind: the daemon reopens it with --resume-session-at
	contextUsage: true, // stream_event usage + result modelUsage.contextWindow
	compact: true, // "/compact" as stream-json user text → compacting/compact_boundary frames
	modelPicker: true, // list_models catalog + set_model control requests (live, in place)
	// stream-json has no session listing: the /resume picker lists the daemon's
	// session_history for the project, and a pick opens it in a new tab.
	resume: true,
	subagents: true, // system/task_* frames: Task subagents and background tasks
	transcriptReplay: true, // the daemon replays the session file's user/assistant text
	slashCommands: true, // the CLI's own commands as stream-json user text (/context, /usage, /doctor…)
	mcpEngineOwned: true, // mcp_status / mcp_toggle / mcp_reconnect on Claude Code's own config
	ruleScopes: true, // can_use_tool updatedPermissions destination + list_permission_rules
	sideQuestions: true, // side_question control request
	agentTrace: true, // system/task_* + the session's saved workflows/subagents files
	contextBreakdown: true // get_context_usage
};

export const CODEX_CAPS: BackendCaps = {
	approvalModes: true, // thread/start approvalPolicy+sandbox, per-turn overrides
	extendedApprovalModes: true, // plan: collaborationMode plan; auto: the auto_review approvals reviewer
	planMode: true,
	hunkApproval: false, // codex approvals are whole-patch accept/decline
	steer: true, // the daemon holds mid-turn messages; turn/steer joins them to the running turn
	interrupt: true, // turn/interrupt
	branchTree: false,
	goals: true, // thread/goal/set|get|clear + thread/goal/updated|cleared
	skills: false,
	mcpManage: true, // mcpServerStatus/list, config/mcpServer/reload, mcpServer/oauth/login
	checkpoints: true, // conversation rewind via thread/revert (files handled desktop-side)
	contextUsage: true, // thread/tokenUsage/updated
	compact: true, // thread/compact/start + contextCompaction item lifecycle
	modelPicker: true, // model/list catalog + per-turn model/effort overrides
	resume: true, // thread/list picker + thread/resume
	subagents: true, // subagent threads (subAgentActivity + their own notifications)
	transcriptReplay: true, // thread/resume replays thread.turns[].items
	slashCommands: false,
	mcpEngineOwned: true, // Codex's own config: listed, reloaded and signed in to, not edited
	ruleScopes: false,
	sideQuestions: false,
	agentTrace: true, // subagent threads, read back with thread/turns/list
	contextBreakdown: false // the app server reports a total only
};

// The baseline for an ACP session before its agent reports anything: what
// stays off for every ACP agent. The daemon's `engine_caps` event turns on,
// per session, what the agent's own ACP handshake offers; `caps(chat)`
// merges it over this table.
export const ACP_CAPS: BackendCaps = {
	approvalModes: false, // engine_caps: a preset with a launch mode per approval mode
	extendedApprovalModes: false,
	planMode: false, // an agent's own plan mode is a session option, not the desktop's
	hunkApproval: false, // permission responses are whole-call option picks
	steer: false, // no mid-turn injection; queued messages run as the next turn
	interrupt: false, // engine_caps: session/cancel
	branchTree: false,
	goals: false, // plan updates still render (the plan tile shows them when present)
	skills: false,
	mcpManage: false,
	checkpoints: false,
	contextUsage: false, // engine_caps: once a usage_update arrived
	compact: false,
	modelPicker: false, // engine_caps: the agent offers a model config option
	resume: false, // no session/list picker (stable, not used yet)
	subagents: false,
	transcriptReplay: false, // engine_caps: session/load replays the conversation
	slashCommands: false, // engine_caps: the agent listed commands (sent as prompt text)
	mcpEngineOwned: false,
	ruleScopes: false,
	sideQuestions: false,
	agentTrace: false,
	contextBreakdown: false
};

