import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFont, fontChoice, offeredFonts } from './fonts';

describe('fonts', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('keeps only ids on the slot’s list', () => {
		expect(fontChoice('code', 'JetBrains Mono')).toBe('JetBrains Mono');
		expect(fontChoice('ui', 'JetBrains Mono')).toBe('default');
		expect(fontChoice('chat', "x'; } body { display: none")).toBe('default');
		expect(fontChoice('chat', undefined)).toBe('default');
	});

	it('sets the slot’s variable, and removes it for the default', () => {
		const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
		vi.stubGlobal('document', { documentElement: { style } });
		applyFont('code', 'Fira Code');
		expect(style.setProperty).toHaveBeenCalledWith('--font-mono', expect.stringMatching(/^'Fira Code', /));
		applyFont('chat', 'default');
		expect(style.removeProperty).toHaveBeenCalledWith('--font-chat');
	});

	it('offers the named fonts installed here, and the current one', () => {
		// A canvas on which only Fira Code measures differently.
		const ctx = { font: '', measureText: () => ({ width: ctx.font.includes('Fira Code') ? 2 : 1 }) };
		vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
		const ids = offeredFonts('code', 'Maple Mono').map((c) => c.id);
		expect(ids).toEqual(['default', 'system', 'Fira Code', 'Maple Mono']);
	});
});
