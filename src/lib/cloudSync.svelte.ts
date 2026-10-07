// Settings synced between the computers of a JuCode account
// (GET/PUT /v1/oauth/settings). Only basic preferences: interface, default
// backend, model defaults, network and voice settings. Keys, custom
// providers, paths, window sizes, projects, MCP, skills, agents and
// schedules stay on each computer.
//
// Per key, the last value synced here is remembered (`jucode-cloud-sync`):
// a local value that differs from it was changed here and is pushed; else a
// newer cloud value is applied. A computer syncing for the first time takes
// the cloud's values and uploads only what the cloud lacks.

import { fetchAccountInfo, fetchCloudSettings, putCloudSettings, readConfig, writeConfig, type CloudSettings } from './protocol';
import { getLocale, LOCALES, setLocale, type Locale } from './i18n/core.svelte';
import { setTheme, themeState, type ThemePref } from './theme.svelte';
import { prefs, TURN_STAT_KEYS, type TurnStatKey } from './prefs.svelte';
import { loadBackendSettings, saveBackendSettings } from './backends/settings';
import { isBackendId } from './backends';

const STATE_KEY = 'jucode-cloud-sync';
const EVERY_MS = 5 * 60_000;

type Config = Record<string, unknown>;
interface Spec {
	key: string;
	/** The local value; undefined when there is none to sync. */
	read(config: Config): unknown;
	/** Applies a cloud value; false when it does not fit this computer. */
	apply(value: unknown, config: Config): boolean | Promise<boolean>;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A config.json field, written as is when the type matches. */
function configField(field: string, valid: (v: unknown) => boolean): Spec {
	return {
		key: `engine.${field}`,
		read: (config) => config[field],
		apply: async (value) => {
			if (!valid(value)) return false;
			await writeConfig({ [field]: value });
			return true;
		}
	};
}

function localValue(key: string): string | undefined {
	try {
		return localStorage.getItem(key) ?? undefined;
	} catch {
		return undefined;
	}
}

const SPECS: Spec[] = [
	{
		key: 'ui.locale',
		read: () => getLocale(),
		apply: (v) => (LOCALES.includes(v as Locale) ? (setLocale(v as Locale), true) : false)
	},
	{
		key: 'ui.theme',
		read: () => themeState.pref,
		apply: (v) => (['system', 'light', 'dark'].includes(v as string) ? (setTheme(v as ThemePref), true) : false)
	},
	{
		key: 'ui.vibrancy',
		read: () => prefs.sidebarVibrancy,
		apply: (v) => (typeof v === 'boolean' ? (prefs.setSidebarVibrancy(v), true) : false)
	},
	{
		key: 'ui.turnStats',
		read: () => [...prefs.turnStats],
		apply: (v) => {
			if (!Array.isArray(v)) return false;
			for (const key of TURN_STAT_KEYS) prefs.setTurnStat(key, v.includes(key as TurnStatKey));
			return true;
		}
	},
	{
		key: 'ui.htmlOpenInBrowser',
		read: () => prefs.htmlOpenInBrowser,
		apply: (v) => (typeof v === 'boolean' ? (prefs.setHtmlOpenInBrowser(v), true) : false)
	},
	{
		// Read by each new session (ChatState).
		key: 'chat.approvalMode',
		read: () => localValue('jucode-approval-mode'),
		apply: (v) => {
			if (!['ask', 'plan', 'auto', 'edits', 'all'].includes(v as string)) return false;
			localStorage.setItem('jucode-approval-mode', v as string);
			return true;
		}
	},
	{
		key: 'backend.default',
		read: () => loadBackendSettings().default,
		apply: (v) => (isString(v) && isBackendId(v) ? (saveBackendSettings({ ...loadBackendSettings(), default: v }), true) : false)
	},
	{
		// Only between computers on the same provider: switching provider also
		// means its address, protocol and key, which stay per computer.
		key: 'engine.model',
		read: (config) => (isString(config.provider) && isString(config.model) ? { provider: config.provider, model: config.model } : undefined),
		apply: async (v, config) => {
			const next = v as { provider?: unknown; model?: unknown } | null;
			const models = Array.isArray(config.models) ? (config.models as { name?: string }[]) : [];
			if (!next || next.provider !== config.provider || !isString(next.model)) return false;
			if (!models.some((m) => m.name === next.model)) return false;
			await writeConfig({ model: next.model });
			return true;
		}
	},
	configField('reasoning_effort', isString),
	configField('compact_model', isString),
	configField('title_model', isString),
	configField('image_model', isString),
	configField('compaction_threshold_percent', isNumber),
	configField('retry_attempts', isNumber),
	configField('connect_timeout_seconds', isNumber),
	configField('read_timeout_seconds', isNumber),
	configField('include_project_instructions', (v) => typeof v === 'boolean'),
	{
		// The voice key is in auth.json and stays here.
		key: 'voice.asr',
		read: (config) => {
			const asr = config.asr as Record<string, unknown> | undefined;
			return asr && isString(asr.provider) ? { provider: asr.provider, base_url: asr.base_url ?? '', model: asr.model ?? '' } : undefined;
		},
		apply: async (v) => {
			const asr = v as Record<string, unknown> | null;
			if (!asr || !isString(asr.provider) || !isString(asr.base_url) || !isString(asr.model)) return false;
			await writeConfig({ asr: { provider: asr.provider, base_url: asr.base_url, model: asr.model } });
			return true;
		}
	}
];

/** JSON with object keys sorted, so equal values compare equal. */
export function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

export interface KeyState {
	/** stableJson of the value last synced. */
	value: string;
	/** Its cloud updated_at. */
	at: number;
}
export interface SyncPlan {
	apply: Record<string, unknown>;
	push: Record<string, unknown>;
}

/** What to apply here and what to push, per key (see the module comment). */
export function planSync(local: Record<string, unknown>, remote: CloudSettings, state: Record<string, KeyState>): SyncPlan {
	const plan: SyncPlan = { apply: {}, push: {} };
	for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
		const mine = local[key];
		const cloud = remote[key];
		const synced = state[key];
		const same = cloud !== undefined && mine !== undefined && stableJson(cloud.value) === stableJson(mine);
		if (!synced) {
			if (cloud) {
				if (!same) plan.apply[key] = cloud.value;
			} else if (mine !== undefined) plan.push[key] = mine;
		} else if (mine !== undefined && stableJson(mine) !== synced.value) {
			plan.push[key] = mine;
		} else if (cloud && cloud.updated_at > synced.at && !same) {
			plan.apply[key] = cloud.value;
		} else if (!cloud && mine !== undefined) {
			plan.push[key] = mine;
		}
	}
	return plan;
}

interface Saved {
	/** The account the state belongs to. */
	account: string;
	keys: Record<string, KeyState>;
}

function loadState(): Saved {
	try {
		const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as Saved | null;
		if (saved && typeof saved.account === 'string' && saved.keys && typeof saved.keys === 'object') return saved;
	} catch {
		/* unreadable: start over, as on a new computer */
	}
	return { account: '', keys: {} };
}

function saveState(saved: Saved) {
	try {
		localStorage.setItem(STATE_KEY, JSON.stringify(saved));
	} catch {
		/* storage unavailable: the next sync starts over */
	}
}

class CloudSync {
	/** Last finished sync (ms) and its error, for the settings page. */
	lastSync = $state(0);
	error = $state('');
	#running: Promise<void> | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;

	start() {
		if (this.#timer || typeof window === 'undefined') return;
		void this.sync();
		this.#timer = setInterval(() => void this.sync(), EVERY_MS);
		window.addEventListener('focus', () => void this.sync());
	}

	/** Syncs now (joins one already running). */
	sync(): Promise<void> {
		this.#running ??= this.#run().finally(() => (this.#running = null));
		return this.#running;
	}

	async #run() {
		let account: string;
		try {
			account = (await fetchAccountInfo()).email ?? '';
		} catch {
			// Not signed in (or offline): nothing to sync with.
			return;
		}
		try {
			const saved = loadState();
			if (saved.account !== account) saved.keys = {};
			saved.account = account;
			const [remote, config] = await Promise.all([fetchCloudSettings(), readConfig()]);
			const local: Record<string, unknown> = {};
			for (const spec of SPECS) {
				const value = spec.read(config);
				if (value !== undefined) local[spec.key] = value;
			}
			const plan = planSync(local, remote, saved.keys);
			for (const spec of SPECS) {
				if (!(spec.key in plan.apply)) continue;
				const value = plan.apply[spec.key];
				// A value that does not fit here (another provider's model) is
				// passed over: this computer keeps its own and is not asked again.
				const applied = await spec.apply(value, config);
				const kept = applied ? value : local[spec.key];
				saved.keys[spec.key] = { value: stableJson(kept), at: remote[spec.key].updated_at };
			}
			const after = Object.keys(plan.push).length ? await putCloudSettings(plan.push) : remote;
			for (const key of Object.keys(local)) {
				const cloud = after[key];
				if (key in plan.apply || !cloud) continue;
				saved.keys[key] = { value: stableJson(key in plan.push ? local[key] : cloud.value), at: cloud.updated_at };
			}
			saveState(saved);
			this.lastSync = Date.now();
			this.error = '';
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		}
	}
}

export const cloudSync = new CloudSync();
