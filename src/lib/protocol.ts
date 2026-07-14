import { invoke } from '@tauri-apps/api/core';
import type { McpServerEntry } from './mcp';

// Commands the GUI sends to a session's `jucode serve` over stdin.
export type Op =
	| { op: 'user_message'; content: string; images?: string[] }
	| { op: 'command'; input: string }
	| { op: 'steer' }
	| { op: 'interrupt' }
	| { op: 'shutdown' }
	// Structured approval answer: `hunks` (edit tools, partial approval) is only
	// valid with decision "allow"; `always` is whole-call only (never with hunks).
	| { op: 'approve'; call_id: string; decision: 'allow' | 'deny'; hunks?: string[]; always?: boolean }
	// Engine-level auto-approval policy; acknowledged by an `approval_mode` event.
	| { op: 'set_approval_mode'; mode: 'read-only' | 'auto-edit' | 'full-auto' }
	// MCP server management (engine config is global; any live session's engine
	// can answer). Each op is acknowledged by an `mcp_servers` event.
	| { op: 'mcp_list' }
	| { op: 'mcp_set'; server: McpServerEntry }
	| { op: 'mcp_remove'; name: string }
	| { op: 'mcp_toggle'; name: string; enabled: boolean };

export function createSession(session: string, cwd?: string): Promise<void> {
	return invoke('create_session', { session, cwd });
}

export function closeSession(session: string): Promise<void> {
	return invoke('close_session', { session });
}

export function sendOp(session: string, op: Op): Promise<void> {
	return invoke('send_op', { session, op });
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
export function setAuthKey(provider: string, key: string): Promise<void> {
	return invoke('set_auth_key', { provider, key });
}
export function removeAuthKey(provider: string): Promise<void> {
	return invoke('remove_auth_key', { provider });
}

// Skills marketplace (Tauri fetches it directly from the JuCode API).
export interface MarketSkill {
	id: string;
	name: string;
	description: string;
	tags: string[];
	isDefault: boolean;
}
export async function fetchMarketplace(): Promise<MarketSkill[]> {
	const v = await invoke<{ skills?: unknown[]; default_skill_ids?: unknown[] }>('fetch_marketplace');
	const defaults = new Set((Array.isArray(v.default_skill_ids) ? v.default_skill_ids : []).map(String));
	return (Array.isArray(v.skills) ? v.skills : [])
		.map((s) => s as Record<string, unknown>)
		.filter((s) => s.enabled !== false)
		.map((s) => ({
			id: String(s.id ?? ''),
			name: String(s.name ?? s.id ?? ''),
			description: String(s.description ?? ''),
			tags: Array.isArray(s.tags) ? (s.tags as unknown[]).map(String) : [],
			isDefault: defaults.has(String(s.id))
		}));
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
export interface UsageLogRow {
	created_at?: string;
	model?: string;
	tokens_in?: number;
	tokens_out?: number;
	cost_final?: string;
	status?: string;
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
export async function fetchUsageLogs(): Promise<UsageLogRow[]> {
	const v = await invoke<{ logs?: unknown[]; items?: unknown[] }>('fetch_usage_logs');
	const rows = Array.isArray(v.logs) ? v.logs : Array.isArray(v.items) ? v.items : [];
	return rows.map((r) => r as UsageLogRow);
}

// IDE features (Tauri layer, operating on the project working directory).
export function projectRoot(): Promise<string> {
	return invoke('project_root');
}
export interface FsEntry {
	name: string;
	path: string;
	is_dir: boolean;
}
export function listDir(path?: string): Promise<FsEntry[]> {
	return invoke('list_dir', { path });
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

export function listFiles(cwd?: string): Promise<string[]> {
	return invoke('list_files', { cwd });
}

export interface ProviderInfo {
	id: string;
	base_url: string;
	protocol: string;
	models: { name: string; context_window?: number; max_output_tokens?: number; reasoning_efforts?: string[] }[];
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
// GitHub CLI 桥（仅放行 --version / auth status / pr view / pr create）。
export function gh(args: string[], cwd?: string): Promise<string> {
	return invoke('gh', { args, cwd });
}
export function ptyOpen(id: string, cols: number, rows: number, cwd?: string): Promise<void> {
	return invoke('pty_open', { id, cols, rows, cwd });
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

// Speech-to-text via Xiaomi MiMo ASR (key stored under providers.mimo in
// auth.json; the HTTP call happens in the Tauri backend to bypass CSP/CORS).
export function transcribeAudio(audioBase64: string, mime?: string, language?: string): Promise<string> {
	return invoke('transcribe_audio', { audioBase64, mime, language });
}

// Events the engine emits on stdout, tagged with the originating session.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}
export interface EventPayload {
	session: string;
	data: string;
}
