import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Standalone test config: uses the plain svelte() plugin (not sveltekit) so
// `.svelte.ts` rune modules compile, while pure `.ts` modules need nothing.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
