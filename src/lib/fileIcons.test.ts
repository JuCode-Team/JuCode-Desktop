import { describe, it, expect } from 'vitest';
import { fileIconHtml, fileIconName } from './fileIcons';

describe('fileIconName', () => {
	it('reads the file name first, then the longest extension', () => {
		expect(fileIconName('docs/ACCOUNT-RELAY-SPEC.md')).toBe('markdown');
		expect(fileIconName('README.md')).toBe('readme');
		expect(fileIconName('web/package.json')).toBe('nodejs');
		expect(fileIconName('src/types.d.ts')).toBe('typescript-def');
		expect(fileIconName('C:\\x\\main.RS')).toBe('rust');
		expect(fileIconName('.env')).toBe('tune');
		expect(fileIconName('notes.unknownext')).toBe('file');
	});
});

describe('fileIconHtml', () => {
	it('is an SVG whose ids are its own', () => {
		const html = fileIconHtml('Main.kt');
		expect(html.startsWith('<svg class="fi" aria-hidden="true" ')).toBe(true);
		expect(html).toContain('id="fi-kotlin-a"');
		expect(html).toContain('url(#fi-kotlin-a)');
	});

	it('has an SVG for every type it names', () => {
		for (const path of ['a.md', 'a.tsx', 'a.svelte', 'a.toml', 'pnpm-lock.yaml', 'CLAUDE.md', 'a.zzz']) {
			expect(fileIconHtml(path)).toMatch(/^<svg /);
		}
	});
});
