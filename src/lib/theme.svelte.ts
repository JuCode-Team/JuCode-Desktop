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
