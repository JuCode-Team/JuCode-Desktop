// Public entry point. The reactive core lives in `core.svelte.ts` (runes need the
// `.svelte.ts` extension); this plain re-export lets consumers `import … from
// '$lib/i18n'` since SvelteKit resolves a directory to `index.ts`.
export { t, getLocale, setLocale, LOCALES, LOCALE_LABELS } from './core.svelte';
export type { Locale } from './core.svelte';
