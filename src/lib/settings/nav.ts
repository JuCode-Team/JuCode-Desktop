// Settings page structure: the nav groups and sections, and the static search
// index of the rows each section renders (SettingsRow `id`s). Keep ROWS in sync
// with the rows in SettingsPage and the section components.

export type SectionKey =
	| 'general'
	| 'account'
	| 'usage'
	| 'voice'
	| 'providers'
	| 'models'
	| 'network'
	| 'plugins'
	| 'mcp'
	| 'market'
	| 'agents'
	| 'acp'
	| 'updates';

export const GROUPS: { key: string; sections: SectionKey[] }[] = [
	{ key: 'personal', sections: ['general', 'account', 'usage', 'voice'] },
	{ key: 'models', sections: ['providers', 'models', 'network'] },
	{ key: 'extensions', sections: ['plugins', 'mcp', 'market'] },
	{ key: 'agents', sections: ['agents', 'acp'] },
	{ key: 'about', sections: ['updates'] }
];

const KEYS = new Set<string>(GROUPS.flatMap((g) => g.sections));

/** Section to open for a caller's request; legacy modal keys map onto the new pages. */
export function resolveSection(key: string | undefined): SectionKey {
	if (key === 'overview') return 'usage';
	if (key && KEYS.has(key)) return key as SectionKey;
	return 'general';
}

export interface SearchRow {
	section: SectionKey;
	id: string;
	titleKey: string;
	descKey?: string;
}

export const ROWS: SearchRow[] = [
	{ section: 'general', id: 'language', titleKey: 'settings.language' },
	{ section: 'general', id: 'theme', titleKey: 'settings.theme' },
	{ section: 'general', id: 'vibrancy', titleKey: 'settings.behavior.vibrancy', descKey: 'settings.behavior.vibrancyHint' },
	{ section: 'general', id: 'html-open', titleKey: 'settings.behavior.htmlOpen', descKey: 'settings.behavior.htmlOpenHint' },
	{ section: 'account', id: 'account-login', titleKey: 'settings.page.jucodeAccount', descKey: 'settings.page.jucodeAccountDesc' },
	{ section: 'account', id: 'account-models', titleKey: 'shell.modelSetup.manage', descKey: 'settings.page.manageModelsDesc' },
	{ section: 'account', id: 'account-usage', titleKey: 'settings.usage.groupLabel', descKey: 'settings.usage.balance' },
	{ section: 'usage', id: 'usage-daily', titleKey: 'settings.overview.summaryTitle', descKey: 'settings.overview.dailyHint' },
	{ section: 'usage', id: 'usage-detail', titleKey: 'settings.overview.breakdownTitle' },
	{ section: 'voice', id: 'voice-provider', titleKey: 'settings.voice.provider', descKey: 'settings.voice.hint' },
	{ section: 'voice', id: 'voice-base-url', titleKey: 'settings.voice.baseUrl' },
	{ section: 'voice', id: 'voice-model', titleKey: 'settings.voice.model' },
	{ section: 'voice', id: 'voice-key', titleKey: 'settings.page.voiceKey', descKey: 'settings.page.voiceKeyDesc' },
	{ section: 'providers', id: 'default-provider', titleKey: 'settings.page.defaultProvider', descKey: 'settings.page.defaultProviderDesc' },
	{ section: 'providers', id: 'provider-list', titleKey: 'settings.account.groupLabel', descKey: 'settings.account.hint' },
	{ section: 'providers', id: 'provider-add', titleKey: 'settings.custom.add', descKey: 'settings.catalog.hint' },
	{ section: 'models', id: 'default-model', titleKey: 'settings.behavior.defaultModel', descKey: 'settings.page.defaultModelDesc' },
	{ section: 'models', id: 'reasoning-effort', titleKey: 'settings.behavior.reasoningEffort', descKey: 'settings.page.reasoningEffortDesc' },
	{ section: 'models', id: 'project-instructions', titleKey: 'settings.behavior.includeProjectInstructions', descKey: 'settings.behavior.includeProjectInstructionsSub' },
	{ section: 'models', id: 'compact-model', titleKey: 'settings.behavior.compactModel', descKey: 'settings.behavior.compactModelHint' },
	{ section: 'models', id: 'compaction-threshold', titleKey: 'settings.behavior.compactionThreshold', descKey: 'settings.behavior.compactionThresholdSub' },
	{ section: 'network', id: 'retry-attempts', titleKey: 'settings.behavior.retryAttempts', descKey: 'settings.page.retryAttemptsDesc' },
	{ section: 'network', id: 'connect-timeout', titleKey: 'settings.behavior.connectTimeout', descKey: 'settings.page.connectTimeoutDesc' },
	{ section: 'network', id: 'read-timeout', titleKey: 'settings.behavior.readTimeout', descKey: 'settings.page.readTimeoutDesc' },
	{ section: 'plugins', id: 'plugins', titleKey: 'settings.plugins.groupLabel', descKey: 'settings.plugins.hint' },
	{ section: 'mcp', id: 'mcp-servers', titleKey: 'settings.mcp.groupLabel', descKey: 'settings.mcp.hint' },
	{ section: 'mcp', id: 'mcp-extensions', titleKey: 'settings.ext.groupLabel', descKey: 'settings.ext.hint' },
	{ section: 'market', id: 'market-open', titleKey: 'settings.market.groupLabel', descKey: 'settings.market.hint' },
	{ section: 'agents', id: 'shell-env', titleKey: 'settings.backend.shellEnvLabel', descKey: 'settings.backend.shellEnvHint' },
	{ section: 'agents', id: 'backend-list', titleKey: 'settings.backend.groupLabel', descKey: 'settings.backend.hint' },
	{ section: 'agents', id: 'default-backend', titleKey: 'settings.backend.defaultLabel', descKey: 'settings.backend.defaultHint' },
	{ section: 'agents', id: 'daemon', titleKey: 'settings.backend.daemonToggle', descKey: 'settings.backend.daemonHint' },
	{ section: 'agents', id: 'dependencies', titleKey: 'setup.deps.title', descKey: 'setup.deps.sub' },
	{ section: 'acp', id: 'acp-agents', titleKey: 'settings.acp.groupLabel', descKey: 'settings.acp.hint' },
	{ section: 'updates', id: 'app-version', titleKey: 'settings.update.currentVersion', descKey: 'settings.update.groupLabel' }
];

/** Rows whose title or description contains the query (case-insensitive). */
export function searchRows(query: string, tr: (key: string) => string): SearchRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return ROWS.filter((r) => `${tr(r.titleKey)}\n${r.descKey ? tr(r.descKey) : ''}`.toLowerCase().includes(q));
}
