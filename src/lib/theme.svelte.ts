export const themeState = $state<{ value: 'dark' | 'light' }>({ value: 'dark' });

function apply() {
	document.documentElement.setAttribute('data-theme', themeState.value);
}

export function initTheme() {
	const saved = localStorage.getItem('jucode-theme');
	themeState.value = saved === 'light' ? 'light' : 'dark';
	apply();
}

export function toggleTheme() {
	themeState.value = themeState.value === 'dark' ? 'light' : 'dark';
	localStorage.setItem('jucode-theme', themeState.value);
	apply();
}
