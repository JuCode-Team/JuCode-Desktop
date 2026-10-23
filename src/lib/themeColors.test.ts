import { describe, expect, it } from 'vitest';
import { BUILTIN_SEEDS, contrast, isDark, normalizeHex, onAccent, parseHex, themeTokens } from './themeColors';

/** Largest channel difference between two hex colors. */
const distance = (a: string, b: string) => Math.max(...parseHex(a)!.map((v, i) => Math.abs(v - parseHex(b)![i])));

describe('themeTokens', () => {
	// The hand-tuned grays in app.css (the brand steps also shift hue, which a
	// mix only approximates): custom themes mix their fills in the
	// same ratios, so the built-in colors must come out (nearly) unchanged.
	const BUILTIN = {
		dark: { '--sidebar': '#202020', '--rail': '#141414', '--panel': '#262626', '--border': '#2e2e2e', '--border-strong': '#3a3a3a', '--dim': '#a3a3a3', '--dim2': '#737373', '--accent-deep': '#a3a3a3' },
		light: { '--sidebar': '#f7f7f7', '--rail': '#ececec', '--panel': '#ffffff', '--border': '#e8e8e8', '--border-strong': '#d6d6d6', '--dim': '#5c5c5c', '--dim2': '#9a9a9a', '--accent-deep': '#525252' }
	};

	for (const mode of ['dark', 'light'] as const) {
		it(`reproduces the built-in ${mode} theme`, () => {
			const tokens = themeTokens(BUILTIN_SEEDS[mode]);
			for (const [token, value] of Object.entries(BUILTIN[mode])) expect(distance(tokens[token], value), token).toBeLessThanOrEqual(4);
		});
	}

	it('picks the layering from the background lightness', () => {
		expect(themeTokens({ ...BUILTIN_SEEDS.light, bg: '#101820' })['--rail']).not.toBe(themeTokens(BUILTIN_SEEDS.light)['--rail']);
		expect(isDark('#101820')).toBe(true);
		expect(isDark('#f5efe0')).toBe(false);
	});

	it('gives translucent tokens as rgba of their color', () => {
		expect(themeTokens(BUILTIN_SEEDS.dark)['--surface']).toBe('rgba(236, 236, 236, 0.03)');
	});

	it('puts readable text on the accent', () => {
		expect(onAccent('#ececec')).toBe('#171717');
		expect(onAccent('#1f1f1f')).toBe('#ffffff');
		expect(themeTokens({ ...BUILTIN_SEEDS.dark, accent: '#2563eb' })['--on-accent']).toBe('#ffffff');
	});
});

describe('hex colors', () => {
	it('normalizes short and long forms, rejects the rest', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex('1a1a1a')).toBe('#1a1a1a');
		expect(normalizeHex('red')).toBeNull();
		expect(normalizeHex('#12345')).toBeNull();
	});

	it('measures WCAG contrast', () => {
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
		expect(contrast('#777777', '#777777')).toBe(1);
	});
});
