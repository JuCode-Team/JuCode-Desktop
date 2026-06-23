import { invoke } from '@tauri-apps/api/core';

// Commands the GUI sends to a session's `jucode serve` over stdin.
export type Op =
	| { op: 'user_message'; content: string; images?: string[] }
	| { op: 'command'; input: string }
	| { op: 'steer' }
	| { op: 'interrupt' }
	| { op: 'shutdown' };

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

// Persists pasted image bytes to a temp file; returns the path to attach.
export function saveTempImage(data: Uint8Array, ext: string): Promise<string> {
	return invoke('save_temp_image', { data: Array.from(data), ext });
}

// First-run environment check + best-effort dependency install (setup wizard).
export interface DepStatus {
	present: boolean;
	detail: string;
}
export interface EnvReport {
	os: string;
	arch: string;
	git: DepStatus;
	engine: DepStatus;
}
export function checkEnvironment(): Promise<EnvReport> {
	return invoke('check_environment');
}
export function installDependency(name: string): Promise<string> {
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

// Events the engine emits on stdout, tagged with the originating session.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}
export interface EventPayload {
	session: string;
	data: string;
}
