import { githubPrManifest } from './github-pr';

export interface PluginManifest {
	id: string;
	name: string;
	commands: readonly string[];
	bin?: string;
	defaultEnabled: boolean;
}

export const PLUGIN_SETTINGS_EVENT = 'jucode:plugins-changed';
export const PLUGIN_STORAGE_KEY = 'jucode-first-party-plugins';
export const PLUGINS: readonly PluginManifest[] = [githubPrManifest];

export type PluginSettings = Record<string, boolean>;

export function defaultPluginSettings(): PluginSettings {
	return Object.fromEntries(PLUGINS.map((plugin) => [plugin.id, plugin.defaultEnabled]));
}

export function parsePluginSettings(raw: string | null): PluginSettings {
	const settings = defaultPluginSettings();
	if (!raw) return settings;
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		for (const plugin of PLUGINS) {
			if (typeof value[plugin.id] === 'boolean') settings[plugin.id] = value[plugin.id] as boolean;
		}
	} catch {
		// Invalid local state falls back to manifest defaults.
	}
	return settings;
}

export function loadPluginSettings(): PluginSettings {
	try {
		return parsePluginSettings(localStorage.getItem(PLUGIN_STORAGE_KEY));
	} catch {
		return defaultPluginSettings();
	}
}

export function isPluginEnabled(id: string): boolean {
	return loadPluginSettings()[id] === true;
}

export function setPluginEnabled(id: string, enabled: boolean): void {
	if (!PLUGINS.some((plugin) => plugin.id === id)) return;
	const settings = loadPluginSettings();
	settings[id] = enabled;
	try {
		localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(settings));
		window.dispatchEvent(new CustomEvent(PLUGIN_SETTINGS_EVENT, { detail: { id, enabled } }));
	} catch {
		// Settings remain at manifest defaults when storage is unavailable.
	}
}
