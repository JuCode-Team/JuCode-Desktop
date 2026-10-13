import { describe, it, expect } from 'vitest';
import conf from '../src-tauri/tauri.conf.json';

// The CSP only applies to the packaged app: dev mode and CI never see it,
// so these break silently. Pin what the frontend depends on.
describe('packaged-app CSP', () => {
	const sec = conf.app.security;

	it('keeps runtime <style> tags allowed', () => {
		// CodeMirror and Svelte transitions insert <style> without a nonce. Tauri
		// adds a nonce to style-src whenever the HTML has a <style> (app.html
		// does), and a nonce turns 'unsafe-inline' off: the editor lost all its
		// styles that way.
		expect(sec.csp['style-src']).toContain("'unsafe-inline'");
		expect(sec.dangerousDisableAssetCspModification).toContain('style-src');
	});

	it('allows inlined fonts', () => {
		// Vite inlines small font files as data: URLs (a KaTeX font is one).
		expect(sec.csp['font-src']).toContain('data:');
	});
});
