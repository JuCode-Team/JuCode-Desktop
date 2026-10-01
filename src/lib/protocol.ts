import { invoke } from '@tauri-apps/api/core';
import type { McpServerEntry } from './mcp';
import { DaemonClient, type DaemonEndpoint, type EngineSpec, type SocketLike } from './daemon';
import { buildBackendOpts } from './backends/settings';

// Started when needed with the jucode backend's binary and environment (the
// daemon runs jucode sessions itself).
const daemonEndpoint = () => {
	const opts = buildBackendOpts('jucode');
	return invoke<DaemonEndpoint>('daemon_endpoint', { binOverride: opts?.bin_override, env: opts?.env });
};

/** The desktop's connection to the local `jucode daemon`, which runs every
 *  session; the page wires its `onFrame` / `onExit` into the session store.
 *  The remote page makes one connection per computer (remote/connection). */
export const daemon = new DaemonClient(daemonEndpoint, (url) => new WebSocket(url) as unknown as SocketLike);

/** Starts (or, with `resume`, reopens) a session hosted by the daemon;
 *  `agent` starts it as that long-lived agent, `chat` as a chat. */
/** Renames, (un)archives or hides a daemon session for every client. */
export function sessionMeta(
	session: string,
	changes: { title?: string; archived?: boolean; hidden?: boolean; group?: string }
): Promise<void> {
	return daemon.post({ op: 'session_meta', session, ...changes });
}

export function hostSession(
	session: string,
	cwd: string,
	resume?: string,
	agent?: string,
	chat = false,
	engine?: EngineSpec
): Promise<void> {
	return daemon.open(session, cwd, resume, agent, chat, engine);
}

// Commands the GUI sends to a session's engine.
export type Op =
	| { op: 'user_message'; content: string; images?: string[] }
	| { op: 'command'; input: string }
	| { op: 'steer' }
	| { op: 'interrupt' }
	| { op: 'shutdown' }
	// Structured approval answer: `hunks` (edit tools, partial approval) is only
	// valid with decision "allow"; `always` is whole-call only (never with hunks).
	| { op: 'approve'; call_id: string; decision: 'allow' | 'deny'; hunks?: string[]; always?: boolean; answers?: Record<string, string> }
	// Engine-level auto-approval policy; acknowledged by an `approval_mode` event.
	| { op: 'set_approval_mode'; mode: 'read-only' | 'plan' | 'auto' | 'auto-edit' | 'full-auto' }
	// MCP server management (engine config is global; any live session's engine
	// can answer). Each op is acknowledged by an `mcp_servers` event.
	| { op: 'mcp_list' }
	| { op: 'mcp_set'; server: McpServerEntry }
	| { op: 'mcp_remove'; name: string }
	| { op: 'mcp_toggle'; name: string; enabled: boolean };

/** Saves an MCP server change (`mcp_set` / `mcp_remove` / `mcp_toggle`) for
 *  every session; open JuCode sessions apply it at once. */
export async function changeMcpServers(op: Op): Promise<void> {
	await daemon.connect();
	await daemon.request(op);
}

export function closeSession(session: string): Promise<void> {
	return daemon.close(session);
}

export function sendOp(session: string, op: Op): Promise<void> {
	return daemon.send(session, JSON.stringify(op));
}

/** Writes one protocol frame to the session's engine. */
export function sendLine(session: string, line: string): Promise<void> {
	return daemon.send(session, line);
}

/** Availability probe for a backend binary (`<bin> --version`). */
export interface BackendStatus {
	found: boolean;
	path?: string | null;
	version?: string | null;
}
export function checkBackend(backend: string, binOverride?: string): Promise<BackendStatus> {
	return invoke('check_backend', { backend, binOverride });
}

// ACP agent registry (Rust-owned: ~app-config/acp-agents.json). command/args/
// env are validated Rust-side on every read and write; a session starts the
// entry's command line in the daemon.
export interface AcpAgent {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}
export function acpAgentsList(): Promise<AcpAgent[]> {
	return invoke('acp_agents_list');
}
export function acpAgentUpsert(agent: AcpAgent): Promise<AcpAgent[]> {
	return invoke('acp_agent_upsert', { agent });
}
export function acpAgentRemove(id: string): Promise<AcpAgent[]> {
	return invoke('acp_agent_remove', { id });
}
/** Availability probe for one registered ACP agent (`<command> --version`). */
export function acpAgentCheck(id: string): Promise<BackendStatus> {
	return invoke('acp_agent_check', { id });
}

/** Login-shell environment snapshot state (see src-tauri/src/shell_env.rs). */
export interface ShellEnvStatus {
	supported: boolean;
	captured: boolean;
	count: number;
	captured_at_ms?: number | null;
	shell?: string | null;
}
export function shellEnvStatus(): Promise<ShellEnvStatus> {
	return invoke('shell_env_status');
}
export function refreshShellEnv(): Promise<ShellEnvStatus> {
	return invoke('refresh_shell_env');
}

/** Makes `jucode` a terminal command running the app's bundled CLI; the
 *  command's location. */
export function installCliCommand(): Promise<string> {
	return invoke('install_cli_command');
}

// Conversations Claude Code / Codex saved in their own apps, imported as a
// cleaned copy that JuCode resumes (src-tauri/src/native_import.rs).
export type NativeSource = 'claude' | 'codex';
export interface NativeSession {
	id: string;
	title: string;
	mtime_ms: number;
	origin: string;
	/** The JuCode copy when it was imported before. */
	imported: string | null;
}
export function nativeSessions(source: NativeSource, cwd: string): Promise<NativeSession[]> {
	return invoke('native_sessions', { source, cwd });
}
export function importNativeSession(source: NativeSource, cwd: string, id: string): Promise<{ id: string; title: string }> {
	return invoke('import_native_session', { source, cwd, id });
}

/** One conversation saved in a directory, by any engine, as the daemon
 *  lists it (`session_history`). `updated_at` is in milliseconds. */
export interface HistoryItem {
	session: string;
	title: string;
	updated_at: number;
	entries: number;
	archived: boolean;
	agent: string | null;
	/** Hosted by the daemon right now. */
	open: boolean;
	/** `jucode`, `claude` or `codex`. */
	engine?: string;
}
export async function sessionHistory(cwd: string): Promise<HistoryItem[]> {
	const reply = await daemon.request({ op: 'session_history', cwd });
	return (reply.sessions as HistoryItem[]) ?? [];
}

// Config / auth (read & write ~/.jucode/{config.json,auth.json} via Tauri fs).
export function readConfig(): Promise<Record<string, unknown>> {
	return invoke('read_config');
}
export function writeConfig(patch: Record<string, unknown>): Promise<void> {
	return invoke('write_config', { patch });
}
export function readAuthProviders(): Promise<string[]> {
	return invoke('read_auth_providers');
}
// Desktop app-data files (workspaces / layout), stored under the per-app
// config dir. Read resolves null when the file doesn't exist yet; write is
// atomic (write-then-rename) Rust-side.
export function appDataRead(file: string): Promise<string | null> {
	return invoke('app_data_read', { file });
}
export function appDataWrite(file: string, content: string): Promise<void> {
	return invoke('app_data_write', { file, content });
}
export function setAuthKey(provider: string, key: string): Promise<void> {
	return invoke('set_auth_key', { provider, key });
}
export function removeAuthKey(provider: string): Promise<void> {
	return invoke('remove_auth_key', { provider });
}

// Skills marketplace: the daemon combines JuCode with github.com/anthropics/skills
// and installs into the backend's personal skills directory.
export type SkillSource = 'jucode' | 'anthropic';
export interface MarketSkill {
	id: string;
	name: string;
	description: string;
	tags: string[];
	source: SkillSource;
	isDefault: boolean;
	installed: boolean;
	license: string;
	redistributable: boolean;
	homepage: string;
}
export interface SkillCatalog {
	skills: MarketSkill[];
	warnings: string[];
	installDir: string;
}
export async function fetchMarketplace(backend: string): Promise<SkillCatalog> {
	await daemon.connect();
	return (await daemon.request({ op: 'skills_catalog', backend })) as unknown as SkillCatalog;
}
export async function installMarketplaceSkill(source: SkillSource, id: string, backend: string): Promise<string> {
	await daemon.connect();
	const reply = await daemon.request({ op: 'skill_install', source, skill: id, backend });
	return reply.path as string;
}

// JuCode account: plan / balance / usage / call-details, fetched via the
// OAuth read endpoints using the stored device access token (auto-refreshed).
export interface AccountInfo {
	email?: string;
	nickname?: string | null;
	balance?: string;
	currency?: string;
	active_plan?: { name?: string; type?: string; expire_at?: string } | null;
}
export interface PlanUsage {
	has_active_plan?: boolean;
	plan_name?: string;
	currency?: string;
	quota_5h?: string;
	used_5h?: string;
	quota_weekly?: string;
	used_weekly?: string;
	quota_monthly?: string;
	used_monthly?: string;
}
/** Token counts of a usage row: cached ⊆ input, reasoning ⊆ output. */
export interface UsageTokens {
	input_tokens: number;
	cached_input_tokens: number;
	cache_write_tokens: number;
	output_tokens: number;
	reasoning_tokens: number;
	turns: number;
	/** Gateway cost (account currency), cloud rows only. */
	cost?: string;
}
/** jucode: the JuCode gateway; third_party: a built-in catalog provider;
 *  local: the user's own logins and providers; legacy: older local counts
 *  that cannot be told apart. */
export type ChannelKind = 'jucode' | 'third_party' | 'local' | 'legacy';
/** Coding-agent usage over a range: the account's (cloud, every computer)
 *  or this computer's (the daemon's `usage_local`, with projects). */
export interface UsageSummary {
	totals: UsageTokens;
	days: (UsageTokens & { day: string })[];
	by_channel: (UsageTokens & { channel_kind: ChannelKind; channel: string; group?: string })[];
	by_model: (UsageTokens & { model: string })[];
	by_engine: (UsageTokens & { engine: string })[];
	by_device?: (UsageTokens & { authorization_id: string | null; name: string })[];
	by_project?: (UsageTokens & { cwd: string })[];
}
/** One coding-agent turn as the account recorded it. */
export interface AgentTurnRow extends Omit<UsageTokens, 'turns'> {
	turn_id: string;
	engine: string;
	channel_kind: ChannelKind;
	channel: string;
	group: string;
	model: string;
	requests: number;
	device: { id: string; name: string } | null;
	started_at: number | null;
	ended_at: number | null;
}
/** A model the JuCode account can use (GET /v1/models). */
export type JucodeModel = {
	id: string;
	/** Smallest window among the gateway accounts serving the model; absent
	 *  when the gateway has none configured. */
	context_window?: number;
	/** Largest; the user may raise their window up to this. */
	max_context_window?: number;
	max_output_tokens?: number;
	reasoning_efforts?: string[];
};
export async function fetchJucodeModels(): Promise<JucodeModel[]> {
	const v = await invoke<{ data?: JucodeModel[] }>('fetch_jucode_models');
	return Array.isArray(v.data) ? v.data : [];
}
export type JucodeGroup = {
	id: string;
	name: string;
	description?: string;
	billing_source?: 'plan_only' | 'balance_only' | '';
	rate_multiplier: number;
	models?: string[];
};
export async function fetchJucodeGroups(): Promise<JucodeGroup[]> {
	const v = await invoke<{ groups?: JucodeGroup[] }>('fetch_jucode_groups');
	return Array.isArray(v.groups) ? v.groups : [];
}
export function fetchAccountInfo(): Promise<AccountInfo> {
	return invoke('fetch_account_info');
}

// DeepSeek balance (api.deepseek.com/user/balance), keyed by the stored API key.
export interface DeepseekBalance {
	is_available: boolean;
	balance_infos: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[];
}
export function fetchDeepseekBalance(): Promise<DeepseekBalance> {
	return invoke('fetch_deepseek_balance');
}
export function fetchUsage(): Promise<PlanUsage> {
	return invoke('fetch_usage');
}
export function fetchAgentUsageSummary(days: number): Promise<UsageSummary> {
	return invoke('fetch_agent_usage_summary', { days, tzOffset: new Date().getTimezoneOffset() });
}
export async function fetchAgentUsageRecent(limit = 10): Promise<AgentTurnRow[]> {
	const v = await invoke<{ items?: AgentTurnRow[] }>('fetch_agent_usage_recent', { limit });
	return Array.isArray(v.items) ? v.items : [];
}
/** This computer's usage, from the daemon, with the project of each turn. */
export async function fetchLocalUsage(days: number): Promise<UsageSummary> {
	const reply = await daemon.request({ op: 'usage_local', days, tz_offset: new Date().getTimezoneOffset() });
	return reply as unknown as UsageSummary;
}
export type CloudSettings = Record<string, { value: unknown; updated_at: number }>;
export async function fetchCloudSettings(): Promise<CloudSettings> {
	const v = await invoke<{ settings?: CloudSettings }>('fetch_cloud_settings');
	return v.settings ?? {};
}
export async function putCloudSettings(settings: Record<string, unknown>): Promise<CloudSettings> {
	const v = await invoke<{ settings?: CloudSettings }>('put_cloud_settings', { settings });
	return v.settings ?? {};
}

// IDE features (Tauri layer, operating on the project working directory).
export function projectRoot(): Promise<string> {
	return invoke('project_root');
}

/** `~/.jucode/chats`, where chat sessions run (created when missing). */
export function chatsDir(): Promise<string> {
	return invoke('chats_dir');
}
export interface FsEntry {
	name: string;
	path: string;
	is_dir: boolean;
}
export function listDir(path?: string, root?: string): Promise<FsEntry[]> {
	return invoke('list_dir', { path, root });
}
export function readText(path: string): Promise<string> {
	return invoke('read_text', { path });
}
// Editor file IO (root-confined like read_text). `write_text` rejects with a
// structured `conflict:<mtime_ms>` error when the file changed on disk since
// `expectedMtime` — pass undefined to force-overwrite.
export interface FileStat {
	mtime_ms: number;
	size: number;
}
export function statText(path: string): Promise<FileStat> {
	return invoke('stat_text', { path });
}
export function writeText(path: string, content: string, expectedMtime?: number): Promise<FileStat> {
	return invoke('write_text', { path, content, expectedMtime });
}
export const isConflictError = (e: unknown) => String(e).startsWith('conflict:');
// File content at git HEAD (diff gutter baseline); rejects paths outside the
// project root / repository.
export function gitHeadText(path: string, cwd?: string): Promise<string> {
	return invoke('git_head_text', { path, cwd });
}

// Persists pasted image bytes to a temp file; returns the path to attach.
export function saveTempImage(data: Uint8Array, ext: string): Promise<string> {
	return invoke('save_temp_image', { data: Array.from(data), ext });
}

// First-run environment check + best-effort dependency install (setup wizard).
export interface DepStatus {
	present: boolean;
	detail: string;
}
// How the setup wizard should offer to install git on this platform:
// 'auto' (one-click button works: macOS CLT dialog / Windows winget),
// 'manual-command' (show a copyable command — we never run sudo GUI-side),
// 'open-url' (official download page only).
export interface InstallAdvice {
	kind: 'auto' | 'manual-command' | 'open-url';
	command: string | null;
	url: string;
}
export interface EnvReport {
	os: string;
	arch: string;
	git: DepStatus;
	engine: DepStatus;
	git_install: InstallAdvice;
}
export function checkEnvironment(): Promise<EnvReport> {
	return invoke('check_environment');
}
// What install_dependency actually did (or wants the UI to do).
export type InstallOutcome =
	| { kind: 'installed'; message: string }
	| { kind: 'started-install'; message: string }
	| { kind: 'manual-command'; command: string; message: string }
	| { kind: 'open-url'; url: string; message: string };
export function installDependency(name: string): Promise<InstallOutcome> {
	return invoke('install_dependency', { name });
}

// --- external tool dependencies (node/npm, ffmpeg, git, gh, codex, jucode, claude) ---

// What installing a tool entails on this machine (mirrors installer::Plan).
export type InstallPlan =
	| { kind: 'run'; program: string; args: string[] }
	| { kind: 'manual'; command: string }
	| { kind: 'system-dialog'; program: string; args: string[] }
	| { kind: 'open-url'; url: string }
	| { kind: 'needs-prereq'; prereq: string };
export interface DepReport {
	id: string;
	present: boolean;
	detail: string;
	plan: InstallPlan;
}
export function checkDependencies(): Promise<DepReport[]> {
	return invoke('check_dependencies');
}
// Outcome of triggering run_install. 'running' → the app is streaming output
// via install-output events and will emit install-done when finished.
// 'system-dialog' → an OS installer window opened; the user re-checks after.
export type InstallStart =
	| { kind: 'running' }
	| { kind: 'system-dialog' }
	| { kind: 'manual-command'; command: string }
	| { kind: 'open-url'; url: string }
	| { kind: 'needs-prereq'; prereq: string };
export function runInstall(name: string): Promise<InstallStart> {
	return invoke('run_install', { name });
}
// Claude Code / Codex: the latest release and whether the installed one is
// older; run_upgrade streams like run_install (same events, same id).
export interface AgentUpdate {
	latest: string;
	available: boolean;
}
export function checkAgentUpdate(backend: string, binOverride?: string): Promise<AgentUpdate> {
	return invoke('check_agent_update', { backend, binOverride });
}
export function runUpgrade(backend: string, binOverride?: string): Promise<InstallStart> {
	return invoke('run_upgrade', { backend, binOverride });
}
export interface InstallOutputEvent {
	id: string;
	line: string;
	stream: 'stdout' | 'stderr';
}
export interface InstallDoneEvent {
	id: string;
	success: boolean;
	code: number | null;
}

export function listFiles(cwd?: string): Promise<string[]> {
	return invoke('list_files', { cwd });
}

export interface ProviderInfo {
	id: string;
	base_url: string;
	protocol: string;
	models: {
		name: string;
		context_window?: number;
		max_context_window?: number;
		max_output_tokens?: number;
		reasoning_efforts?: string[];
	}[];
}
export function listProviders(): Promise<ProviderInfo[]> {
	return invoke('list_providers');
}
export function git(args: string[], cwd?: string): Promise<string> {
	return invoke('git', { args, cwd });
}
// 并行任务 worktree 的容器目录（<repo-parent>/.jucode-worktrees/<repo-name>）。
export function worktreeBase(cwd: string): Promise<string> {
	return invoke('worktree_base', { cwd });
}
/** Non-shell pty target: `command` must be an allowlisted backend name
 *  (jucode / codex / claude). The Rust side validates it and `args` against
 *  fixed allowlists and resolves the binary like engine spawns — a missing
 *  binary rejects with `binary-missing:<name>`. */
export interface PtyCommand {
	command: string;
	args?: string[];
	binOverride?: string;
}
export function ptyOpen(
	id: string,
	cols: number,
	rows: number,
	cwd?: string,
	cmd?: PtyCommand
): Promise<void> {
	return invoke('pty_open', {
		id,
		cols,
		rows,
		cwd,
		command: cmd?.command,
		args: cmd?.args,
		binOverride: cmd?.binOverride
	});
}
export function ptyWrite(id: string, data: string): Promise<void> {
	return invoke('pty_write', { id, data });
}
export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
	return invoke('pty_resize', { id, cols, rows });
}
export function ptyClose(id: string): Promise<void> {
	return invoke('pty_close', { id });
}

// Screen capture / recording / video keyframe extraction (Tauri layer).
export function captureScreenshot(): Promise<string | null> {
	return invoke('capture_screenshot');
}
export function startScreenRecording(): Promise<void> {
	return invoke('start_screen_recording');
}
export function stopScreenRecording(): Promise<string> {
	return invoke('stop_screen_recording');
}
export interface VideoInfo {
	path: string;
	duration: number;
	width: number;
	height: number;
	frames: string[];
}
export function processVideo(path: string, maxFrames?: number): Promise<VideoInfo> {
	return invoke('process_video', { path, maxFrames });
}

// Speech-to-text via the ASR provider selected in config.json. Keys remain in
// auth.json; the HTTP call happens in the Tauri backend to bypass CSP/CORS.
export function transcribeAudio(audioBase64: string, mime?: string, language?: string): Promise<string> {
	return invoke('transcribe_audio', { audioBase64, mime, language });
}

/** Snapshot the working tree as a dangling checkpoint commit (returns its sha).
 *  Non-destructive: it never touches the index or working tree. */
export function gitCheckpointCapture(cwd: string): Promise<string> {
	return invoke('git_checkpoint_capture', { cwd });
}

/** Restore the working tree to a checkpoint sha. Snapshots the current state
 *  first (returns that recovery sha) so nothing is unrecoverable. */
export function gitCheckpointRestore(cwd: string, checkpoint: string): Promise<string> {
	return invoke('git_checkpoint_restore', { cwd, checkpoint });
}

/** One-shot LLM completion (no agent / no chat pollution) — powers AI commit
 *  messages and PR text. The key is read engine-side from auth.json by provider. */
export function generateText(
	provider: string,
	baseUrl: string,
	format: string,
	model: string,
	system: string,
	prompt: string
): Promise<string> {
	return invoke('generate_text', { provider, baseUrl, format, model, system, prompt });
}

// Events the engine emits on stdout, tagged with the originating session.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}
