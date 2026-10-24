// Color math for custom themes (theme.svelte.ts). A custom theme is four
// colors; every other fill is mixed from them in the ratios that give the
// built-in theme of the same lightness its own values (app.css), so a custom
// theme keeps the built-in layering. Status colors, shadows and code colors
// stay the built-in theme's.

export interface ThemeSeeds {
	bg: string;
	text: string;
	/** Primary buttons and selected state. */
	accent: string;
	/** Links and the focus ring. */
	brand: string;
}

/** The built-in themes' four colors (app.css). */
export const BUILTIN_SEEDS: Record<'dark' | 'light', ThemeSeeds> = {
	dark: { bg: '#151515', text: '#ececec', accent: '#ececec', brand: '#8b5cf6' },
	light: { bg: '#ffffff', text: '#1f1f1f', accent: '#1f1f1f', brand: '#7c3aed' }
};

type Rgb = [number, number, number];

/** `#rgb` or `#rrggbb` → [r, g, b] (0–255); null for anything else. */
export function parseHex(hex: string): Rgb | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** `#rrggbb` in lowercase; null when `hex` is not a hex color. */
export function normalizeHex(hex: string): string | null {
	const rgb = parseHex(hex);
	return rgb ? toHex(rgb) : null;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
	const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** A background is dark when white text reads better on it than black. */
export const isDark = (bg: string) => contrast(bg, '#ffffff') > contrast(bg, '#000000');

/** Text on the accent: white or near-black, whichever reads better. */
export const onAccent = (accent: string) => (contrast(accent, '#ffffff') >= contrast(accent, '#171717') ? '#ffffff' : '#171717');

type Source = keyof ThemeSeeds | 'white' | 'black';
/** `[a, b, share]`: `share` of `a` over `b` (sRGB); `b` transparent gives `a` at that alpha. */
type Mix = [Source, Source | 'transparent', number];

const SHARED: Record<string, Mix> = {
	'--border': ['text', 'bg', 0.1],
	'--hairline': ['text', 'transparent', 0.06]
};
const MIXES: Record<'dark' | 'light', Record<string, Mix>> = {
	dark: {
		...SHARED,
		'--sidebar': ['bg', 'black', 0.857],
		'--rail': ['bg', 'black', 0.667],
		'--panel': ['text', 'bg', 0.051],
		'--border-strong': ['text', 'bg', 0.15],
		'--surface': ['text', 'transparent', 0.03],
		'--surface2': ['text', 'transparent', 0.06],
		'--dim': ['text', 'bg', 0.65],
		'--dim2': ['text', 'bg', 0.42],
		'--accent-bright': ['accent', 'white', 0.75],
		'--accent-deep': ['accent', 'bg', 0.65],
		'--accent-soft': ['accent', 'transparent', 0.08],
		'--brand-bright': ['brand', 'white', 0.75]
	},
	light: {
		...SHARED,
		'--sidebar': ['text', 'bg', 0.035],
		'--rail': ['bg', 'black', 0.925],
		'--panel': ['bg', 'white', 0.6],
		'--border-strong': ['text', 'bg', 0.18],
		'--surface': ['text', 'transparent', 0.025],
		'--surface2': ['text', 'transparent', 0.055],
		'--dim': ['text', 'bg', 0.73],
		'--dim2': ['text', 'bg', 0.45],
		'--accent-bright': ['accent', 'black', 0.8],
		'--accent-deep': ['accent', 'bg', 0.77],
		'--accent-soft': ['accent', 'transparent', 0.05],
		'--brand-bright': ['brand', 'black', 0.88]
	}
};

/** Every color token (app.css) a custom theme sets, as concrete colors: the
 *  terminal and the editor read them from CSS and need plain values. */
export function themeTokens(seeds: ThemeSeeds): Record<string, string> {
	const rgb = (s: Source): Rgb => (s === 'white' ? [255, 255, 255] : s === 'black' ? [0, 0, 0] : (parseHex(seeds[s]) ?? [0, 0, 0]));
	const tokens: Record<string, string> = {
		'--bg': seeds.bg,
		'--text': seeds.text,
		'--accent': seeds.accent,
		'--on-accent': onAccent(seeds.accent),
		'--brand': seeds.brand
	};
	for (const [token, [a, b, share]] of Object.entries(MIXES[isDark(seeds.bg) ? 'dark' : 'light'])) {
		const from = rgb(a);
		tokens[token] =
			b === 'transparent'
				? `rgba(${from.join(', ')}, ${share})`
				: toHex(from.map((v, i) => v * share + rgb(b)[i] * (1 - share)) as Rgb);
	}
	return tokens;
}
