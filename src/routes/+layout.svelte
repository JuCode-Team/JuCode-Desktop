<script lang="ts">
	import '$lib/app.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';
	import { prefs, applyPlatformClass } from '$lib/prefs.svelte';
	import { getLocale, setLocale } from '$lib/i18n';

	// Tag the root with the host OS before first paint so platform-specific window
	// chrome (macOS traffic-light insets vs a native Windows/Linux title bar) is
	// styled correctly from the very first frame.
	if (browser) applyPlatformClass();

	let { children } = $props();
	onMount(() => {
		initTheme();
		// prefs.init() also reflects the macOS sidebar-vibrancy choice onto the root.
		prefs.init();
		// Persist detection + reflect the active locale on <html lang> for a11y.
		setLocale(getLocale());
	});
</script>

{@render children()}
