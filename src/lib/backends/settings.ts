// Desktop-side backend preferences (localStorage): per-backend binary path
// overrides and the default backend for new sessions. Pure helpers are split
// out so they stay unit-testable without a DOM.

import type { BackendId } from './types';
import { isBackendId, normalizeBackendId } from './types';
import type { BackendStatus } from '$lib/protocol';

export interface BackendSettings {
	/** Default backend for new sessions (used when a project has no last-used one). */
	default: BackendId;
	/** Per-backend binary path overrides (passed as bin_override on create). */
	paths: Partial<Record<BackendId, string>>;
	/** Build backend child env from the login-shell snapshot (default true). */
	useShellEnv: boolean;
	/** Per-backend custom env vars, applied after the snapshot. */
	env: Partial<Record<BackendId, Record<string, string>>>;
}

const KEY = 'jucode-backend-settings';

export const DEFAULT_BACKEND_SETTINGS: BackendSettings = {
	default: 'jucode',
	paths: {},
	useShellEnv: true,
	env: {}
};

function freshDefaults(): BackendSettings {
	return { ...DEFAULT_BACKEND_SETTINGS, paths: {}, env: {} };
}

/** POSIX-style env names only; dynamic-linker prefixes rejected (mirrors Rust). */
export function isValidEnvName(name: string): boolean {
	return (
		/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
		name.length <= 128 &&
		!name.startsWith('DYLD_') &&
		!name.startsWith('LD_')
	);
}

/** KEY=VALUE lines → env map. Returns invalid line texts alongside the map. */
export function parseEnvLines(text: string): { env: Record<string, string>; invalid: string[] } {
	const env: Record<string, string> = {};
	const invalid: string[] = [];
	for (const line of text.split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		const name = eq > 0 ? t.slice(0, eq).trim() : '';
		if (!name || !isValidEnvName(name)) {
			invalid.push(t);
			continue;
		}
		env[name] = t.slice(eq + 1);
	}
	return { env, invalid };
}

export function formatEnvLines(env: Record<string, string> | undefined): string {
	return Object.entries(env ?? {})
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');
}

/** Parse persisted settings; malformed / partial data degrades to defaults. */
export function parseBackendSettings(raw: string | null): BackendSettings {
	if (!raw) return freshDefaults();
	try {
		const v = JSON.parse(raw) as Record<string, unknown>;
		const paths: Partial<Record<BackendId, string>> = {};
		const rawPaths = (v && typeof v === 'object' ? v.paths : null) as Record<string, unknown> | null;
		if (rawPaths && typeof rawPaths === 'object') {
			for (const [k, p] of Object.entries(rawPaths)) {
				if (isBackendId(k) && typeof p === 'string' && p.trim()) paths[k] = p.trim();
			}
		}
		const env: Partial<Record<BackendId, Record<string, string>>> = {};
		const rawEnv = (v && typeof v === 'object' ? v.env : null) as Record<string, unknown> | null;
		if (rawEnv && typeof rawEnv === 'object') {
			for (const [k, m] of Object.entries(rawEnv)) {
				if (!isBackendId(k) || !m || typeof m !== 'object') continue;
				const clean: Record<string, string> = {};
				for (const [name, val] of Object.entries(m as Record<string, unknown>)) {
					if (isValidEnvName(name) && typeof val === 'string') clean[name] = val;
				}
				if (Object.keys(clean).length) env[k] = clean;
			}
		}
		return {
			default: normalizeBackendId(v?.default),
			paths,
			useShellEnv: v?.useShellEnv !== false,
			env
		};
	} catch {
		return freshDefaults();
	}
}

export function loadBackendSettings(): BackendSettings {
	try {
		return parseBackendSettings(localStorage.getItem(KEY));
	} catch {
		/* no localStorage (tests) */
		return freshDefaults();
	}
}

export function saveBackendSettings(s: BackendSettings): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(s));
	} catch {
		/* no localStorage (tests) */
	}
}

export interface SpawnBackendOpts extends Record<string, unknown> {
	bin_override?: string;
	use_shell_env?: boolean;
	env?: Record<string, string>;
}

/**
 * Spawn options for `create_session` from the settings: binary override,
 * shell-env toggle (only sent when off — on is the engine-side default) and
 * per-backend custom env. Returns undefined when there is nothing to pass,
 * so the jucode default path stays exactly the historical two-argument call.
 */
export function buildBackendOpts(
	id: BackendId,
	settings: BackendSettings = loadBackendSettings()
): SpawnBackendOpts | undefined {
	const opts: SpawnBackendOpts = {};
	const path = settings.paths[id];
	if (path) opts.bin_override = path;
	if (!settings.useShellEnv) opts.use_shell_env = false;
	const env = settings.env[id];
	if (env && Object.keys(env).length) opts.env = env;
	return Object.keys(opts).length ? opts : undefined;
}

/**
 * Which backend a new session should use: the project's last-used backend
 * wins, else the settings' default, else 'jucode'.
 */
export function defaultBackendFor(
	lastUsed: string | null | undefined,
	settings: BackendSettings = loadBackendSettings()
): BackendId {
	if (isBackendId(lastUsed)) return lastUsed;
	return settings.default;
}

/** First line of a `--version` probe, trimmed — CLI version strings can carry
 *  trailing chatter (e.g. "2.0.1 (Claude Code)" is fine, multi-line isn't). */
export function versionLabel(status: BackendStatus): string {
	return (status.version ?? '').split('\n')[0]?.trim() ?? '';
}
