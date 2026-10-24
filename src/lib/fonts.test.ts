import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFont, fontChoice, fontStack } from './fonts';

describe('fonts', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('keeps a generic choice of the slot or a family name, else the default', () => {
		expect(fontChoice('code', 'JetBrains Mono')).toBe('JetBrains Mono');
		expect(fontChoice('chat', 'serif')).toBe('serif');
		expect(fontChoice('chat', "x'; } body { display: none")).toBe('default');
		expect(fontChoice('chat', undefined)).toBe('default');
		expect(fontChoice('ui', 'x'.repeat(101))).toBe('default');
	});

	it('quotes a family and falls back to the app’s own font', () => {
		expect(fontStack('code', 'Fira Code')).toMatch(/^'Fira Code', .*monospace$/);
		expect(fontStack('chat', 'PingFang SC')).toBe("'PingFang SC', var(--font-sans)");
		expect(fontStack('ui', 'default')).toBeUndefined();
	});

	it('sets the slot’s variable, and removes it for the default', () => {
		const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
		vi.stubGlobal('document', { documentElement: { style } });
		applyFont('code', 'Fira Code');
		expect(style.setProperty).toHaveBeenCalledWith('--font-mono', expect.stringMatching(/^'Fira Code', /));
		applyFont('chat', 'default');
		expect(style.removeProperty).toHaveBeenCalledWith('--font-chat');
	});
});
