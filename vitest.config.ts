import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// Standalone test config: uses the plain svelte() plugin (not sveltekit) so
// `.svelte.ts` rune modules compile, while pure `.ts` modules need nothing.
// SvelteKit provides the `$lib` alias at build time; replicate it here so
// modules importing `$lib/…` (e.g. i18n) resolve under vitest too.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
