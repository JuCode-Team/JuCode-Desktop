// Lightweight, dependency-free i18n built on Svelte 5 runes.
//
// Why hand-rolled: the app mixes plain `.ts` modules (session, protocol) with
// `.svelte` components and runs through the Tauri build. A module-level `$state`
// locale + a plain `t()` function works uniformly in both worlds with no extra
// build step, and stays fully type-checked.
//
// Usage:
//   import { t } from '$lib/i18n';
//   t('common.copy')                     -> "复制" / "Copy"
//   t('chat.tokens', { n: 128 })         -> interpolates {n}
// In a component, calling `t(...)` in markup or a `$derived` re-runs when the
// locale changes because `t` reads the reactive `locale` state.

import { catalog, type Locale } from './messages';

export type { Locale };
export const LOCALES: Locale[] = ['zh', 'en'];
export const LOCALE_LABELS: Record<Locale, string> = { zh: '中文', en: 'English' };

const STORAGE_KEY = 'jucode-locale';
const FALLBACK: Locale = 'zh';

function detect(): Locale {
	if (typeof localStorage !== 'undefined') {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'zh' || saved === 'en') return saved;
	}
	if (typeof navigator !== 'undefined') {
		const lang = (navigator.language || '').toLowerCase();
		if (lang.startsWith('zh')) return 'zh';
		if (lang.startsWith('en')) return 'en';
	}
	return FALLBACK;
}

// Module-level rune state: shared reactively across every component.
let current = $state<Locale>(detect());

export function getLocale(): Locale {
	return current;
}

export function setLocale(next: Locale): void {
	current = next;
	if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
	if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** Resolve a dot-path key against the active locale, falling back to zh, then the key itself. */
function lookup(key: string, locale: Locale): string | undefined {
	const parts = key.split('.');
	let node: unknown = catalog[locale];
	for (const p of parts) {
		if (node && typeof node === 'object' && p in (node as Record<string, unknown>)) {
			node = (node as Record<string, unknown>)[p];
		} else {
			return undefined;
		}
	}
	return typeof node === 'string' ? node : undefined;
}

/**
 * Translate `key` for the active locale. `params` fills `{name}` placeholders.
 * Reading `current` here makes template/`$derived` usages reactive to locale changes.
 */
export function t(key: string, params?: Record<string, string | number>): string {
	const locale = current; // reactive dependency
	let msg = lookup(key, locale) ?? lookup(key, FALLBACK) ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
		}
	}
	return msg;
}
