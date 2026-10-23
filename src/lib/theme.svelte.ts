import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BUILTIN_SEEDS, isDark, normalizeHex, themeTokens, type ThemeSeeds } from './themeColors';

export type ThemePref = 'system' | 'light' | 'dark';
type Mode = 'light' | 'dark';

export interface ThemeBackground {
	/** The copy under ~/.jucode/themes (save_theme_image), so moving or
	 *  deleting the picked file changes nothing. Stays on this computer. */
	path: string;
	fit: 'cover' | 'contain' | 'tile';
	/** How strongly the image shows over the window, percent. */
	opacity: number;
	/** px */
	blur: number;
}

/** A user's theme: four colors (themeColors.ts derives the rest; the
 *  background's lightness decides which built-in theme it builds on) and an
 *  optional background image. */
export interface CustomTheme extends ThemeSeeds {
	id: string;
	name: string;
	background?: ThemeBackground;
}

export const BACKGROUND_OPACITY = [10, 15, 20, 30, 40, 50];
export const BACKGROUND_BLUR = [0, 8, 16, 32];
const FITS: ThemeBackground['fit'][] = ['cover', 'contain', 'tile'];

// `pref` is the user's choice; `value` is the resolved theme actually applied
// (consumers like the editor read `value`). `light` / `dark`: the custom
// theme used in that mode, '' for the built-in one. `preview`: a custom theme
// shown whatever the mode, while Settings edits it. `revision` changes on
// every apply, for readers of the resolved CSS (the terminal palette).
export const themeState = $state<{
	pref: ThemePref;
	value: Mode;
	custom: CustomTheme[];
	light: string;
	dark: string;
	preview: string | null;
	revision: number;
}>({
	pref: 'system',
	value: 'dark',
	custom: [],
	light: '',
	dark: '',
	preview: null,
	revision: 0
});

const THEMES_KEY = 'jucode-themes';
const inTauri = () => '__TAURI_INTERNALS__' in window;
const prefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;
let revision = 0;
// app.html sets --bg before first paint.
let appliedTokens: string[] = ['--bg'];

const saveThemeImage = (data: Uint8Array) => invoke<string>('save_theme_image', { data: Array.from(data) });
const deleteThemeImage = (path: string) => invoke('delete_theme_image', { path });

function resolve(pref: ThemePref): Mode {
	return pref === 'system' ? (prefersLight() ? 'light' : 'dark') : pref;
}

/** The custom theme on screen, if any. */
export function activeTheme(): CustomTheme | undefined {
	const id = themeState.preview ?? themeState[resolve(themeState.pref)];
	return themeState.custom.find((t) => t.id === id);
}

function apply() {
	const theme = activeTheme();
	themeState.value = theme ? (isDark(theme.bg) ? 'dark' : 'light') : resolve(themeState.pref);
	const root = document.documentElement;
	root.setAttribute('data-theme', themeState.value);
	for (const token of appliedTokens) root.style.removeProperty(token);
	appliedTokens = [];
	if (theme) {
		const tokens = themeTokens(theme);
		for (const [token, value] of Object.entries(tokens)) root.style.setProperty(token, value);
		appliedTokens = Object.keys(tokens);
	}
	applyBackground(theme?.background);
	themeState.revision = ++revision;
	// The native window appearance drives the macOS frosted material behind the
	// chrome: a light app on a dark system would otherwise sit on dark frost.
	// "system" hands the appearance back to the OS, even under a custom theme
	// of the other lightness: setting it would flip the webview's
	// prefers-color-scheme, which re-resolves the mode and flips it back.
	if (inTauri()) {
		getCurrentWindow()
			.setTheme(themeState.pref === 'system' ? null : themeState.value)
			.catch(() => {});
	}
}

/** The image layer is +layout's `.backdrop` (app.css); images live on this
 *  computer only, so the browser build shows none. */
function applyBackground(bg: ThemeBackground | undefined) {
	const root = document.documentElement;
	if (!bg || !inTauri()) {
		root.removeAttribute('data-backdrop');
		return;
	}
	root.style.setProperty('--backdrop-image', `url("${convertFileSrc(bg.path)}")`);
	root.style.setProperty('--backdrop-opacity', String(bg.opacity / 100));
	root.style.setProperty('--backdrop-blur', `${bg.blur}px`);
	root.setAttribute('data-backdrop', bg.fit);
}

const nearest = (list: number[], v: unknown) =>
	typeof v === 'number' && Number.isFinite(v) ? list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) : list[0];

/** A theme read from storage or the cloud, made valid; null when it cannot be. */
export function cleanTheme(raw: unknown): CustomTheme | null {
	const t = raw as Partial<CustomTheme> | null;
	if (!t || typeof t.id !== 'string' || !t.id) return null;
	const colors = (['bg', 'text', 'accent', 'brand'] as const).map((k) => (typeof t[k] === 'string' ? normalizeHex(t[k]) : null));
	if (colors.some((c) => !c)) return null;
	const [bg, text, accent, brand] = colors as string[];
	const b = t.background;
	const background =
		b && typeof b.path === 'string' && b.path
			? {
					path: b.path,
					fit: FITS.includes(b.fit) ? b.fit : 'cover',
					opacity: nearest(BACKGROUND_OPACITY, b.opacity),
					blur: nearest(BACKGROUND_BLUR, b.blur)
				}
			: undefined;
	return { id: t.id, name: typeof t.name === 'string' ? t.name : '', bg, text, accent, brand, ...(background && { background }) };
}

function loadThemes() {
	try {
		const saved = JSON.parse(localStorage.getItem(THEMES_KEY) || '{}');
		themeState.custom = Array.isArray(saved.custom) ? saved.custom.map(cleanTheme).filter((t: CustomTheme | null) => t !== null) : [];
		themeState.light = typeof saved.light === 'string' ? saved.light : '';
		themeState.dark = typeof saved.dark === 'string' ? saved.dark : '';
	} catch {
		/* unreadable: the built-in themes */
	}
}

function saveThemes() {
	try {
		localStorage.setItem(THEMES_KEY, JSON.stringify({ custom: themeState.custom, light: themeState.light, dark: themeState.dark }));
	} catch {
		/* private mode / no storage — in-memory only */
	}
}

export function initTheme() {
	const saved = localStorage.getItem('jucode-theme');
	themeState.pref = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
	loadThemes();
	apply();
	// Track OS theme changes while following the system.
	window
		.matchMedia('(prefers-color-scheme: light)')
		.addEventListener('change', () => {
			if (themeState.pref === 'system') apply();
		});
}

export function setTheme(pref: ThemePref) {
	themeState.pref = pref;
	localStorage.setItem('jucode-theme', pref);
	apply();
}

// Sidebar/command-palette control: system → light → dark → system.
export function cycleTheme() {
	const order: ThemePref[] = ['system', 'light', 'dark'];
	setTheme(order[(order.indexOf(themeState.pref) + 1) % order.length]);
}

/** Use custom theme `id` ('' for the built-in one) in `mode`. */
export function setThemeSlot(mode: Mode, id: string) {
	themeState[mode] = themeState.custom.some((t) => t.id === id) ? id : '';
	saveThemes();
	apply();
}

/** A new custom theme starting from the colors on screen, used in the
 *  current mode. */
export function createTheme(name: string): CustomTheme {
	const current = activeTheme();
	const seeds = current ?? BUILTIN_SEEDS[themeState.value];
	const theme: CustomTheme = { id: Date.now().toString(36), name, bg: seeds.bg, text: seeds.text, accent: seeds.accent, brand: seeds.brand };
	themeState.custom = [...themeState.custom, theme];
	themeState[resolve(themeState.pref)] = theme.id;
	saveThemes();
	apply();
	return theme;
}

export function updateTheme(id: string, patch: Partial<Omit<CustomTheme, 'id'>>) {
	themeState.custom = themeState.custom.map((t) => (t.id === id ? { ...t, ...patch } : t));
	saveThemes();
	apply();
}

export function deleteTheme(id: string) {
	const theme = themeState.custom.find((t) => t.id === id);
	themeState.custom = themeState.custom.filter((t) => t.id !== id);
	if (themeState.light === id) themeState.light = '';
	if (themeState.dark === id) themeState.dark = '';
	if (themeState.preview === id) themeState.preview = null;
	saveThemes();
	apply();
	if (theme?.background) deleteThemeImage(theme.background.path).catch(() => {});
}

/** Show theme `id` whatever the mode (null: back to the mode's theme). */
export function previewTheme(id: string | null) {
	if (themeState.preview === id) return;
	themeState.preview = id;
	apply();
}

/** Photos are scaled to fit this many pixels on their long side. */
const MAX_SIDE = 3200;

/** Saves `file` (scaled down, JPEG) as theme `id`'s background image. */
export async function setThemeImage(id: string, file: File) {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	const ctx = canvas.getContext('2d')!;
	// JPEG has no alpha: transparent parts take the theme's background.
	ctx.fillStyle = themeState.custom.find((t) => t.id === id)?.bg ?? '#000000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
	if (!blob) throw new Error('image encoding failed');
	const path = await saveThemeImage(new Uint8Array(await blob.arrayBuffer()));
	const theme = themeState.custom.find((t) => t.id === id);
	if (!theme) {
		// Deleted while the image was saving.
		deleteThemeImage(path).catch(() => {});
		return;
	}
	const old = theme.background?.path;
	updateTheme(id, { background: { fit: 'cover', opacity: 15, blur: 0, ...theme.background, path } });
	if (old) deleteThemeImage(old).catch(() => {});
}

export function clearThemeImage(id: string) {
	const path = themeState.custom.find((t) => t.id === id)?.background?.path;
	updateTheme(id, { background: undefined });
	if (path) deleteThemeImage(path).catch(() => {});
}

/** For cloud sync: the themes without their images, which stay here. */
export const syncedThemes = () => themeState.custom.map(({ background: _, ...colors }) => colors);

/** Applies synced themes: colors and names from the cloud, each theme's
 *  image kept from this computer. A theme only this computer had goes, but
 *  its image file stays: a first sync replaces the local list with the
 *  cloud's, and that must not lose a picture. False when `value` is not a
 *  theme list. */
export function applySyncedThemes(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	const local = new Map(themeState.custom.map((t) => [t.id, t]));
	const next = value.map(cleanTheme).filter((t): t is CustomTheme => t !== null);
	themeState.custom = next.map(({ background: _, ...t }) => ({ ...t, ...(local.get(t.id)?.background && { background: local.get(t.id)!.background }) }));
	const kept = new Set(next.map((t) => t.id));
	for (const mode of ['light', 'dark'] as const) if (!kept.has(themeState[mode])) themeState[mode] = '';
	if (themeState.preview && !kept.has(themeState.preview)) themeState.preview = null;
	saveThemes();
	apply();
	return true;
}

/** xterm palette from the theme tokens (xterm needs concrete colors, so it
 *  reads the resolved custom properties). Call again after a theme change. */
export function terminalPalette() {
	const css = getComputedStyle(document.documentElement);
	const token = (name: string) => css.getPropertyValue(name).trim();
	return {
		background: token('--panel'),
		foreground: token('--text'),
		cursor: token('--accent-bright'),
		selectionBackground: `${token('--accent')}40`
	};
}
