import { getCurrentWindow } from '@tauri-apps/api/window';

export type ThemePref = 'system' | 'light' | 'dark';

// `pref` is the user's choice; `value` is the resolved theme actually applied
// (consumers like the terminal palette read `value`).
export const themeState = $state<{ pref: ThemePref; value: 'dark' | 'light' }>({
	pref: 'system',
	value: 'dark'
});

const prefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

function resolve(pref: ThemePref): 'dark' | 'light' {
	return pref === 'system' ? (prefersLight() ? 'light' : 'dark') : pref;
}

function apply() {
	themeState.value = resolve(themeState.pref);
	document.documentElement.setAttribute('data-theme', themeState.value);
	// The native window appearance drives the macOS frosted material behind the
	// chrome: a light app on a dark system would otherwise sit on dark frost.
	// "system" hands the appearance back to the OS.
	if ('__TAURI_INTERNALS__' in window) {
		getCurrentWindow()
			.setTheme(themeState.pref === 'system' ? null : themeState.value)
			.catch(() => {});
	}
}

export function initTheme() {
	const saved = localStorage.getItem('jucode-theme');
	themeState.pref = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
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
