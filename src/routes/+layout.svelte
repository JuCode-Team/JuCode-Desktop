<script lang="ts">
	import '$lib/app.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';
	import { prefs, applyPlatformClass } from '$lib/prefs.svelte';
	import { getLocale, setLocale } from '$lib/i18n';
	import IconContext from 'phosphor-svelte/lib/IconContext';
	import ContextMenuHost from '$lib/ui/ContextMenuHost.svelte';
	import TooltipHost from '$lib/ui/TooltipHost.svelte';

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
		// Resizing or zooming the window: layout jumps, nothing animates along
		// (app.css .win-resizing), until 150 ms after the last resize event.
		const root = document.documentElement;
		let settle: ReturnType<typeof setTimeout> | undefined;
		const onResize = () => {
			root.classList.add('win-resizing');
			clearTimeout(settle);
			settle = setTimeout(() => root.classList.remove('win-resizing'), 150);
		};
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
			clearTimeout(settle);
		};
	});
</script>

<!-- Icon defaults (Phosphor): 24px unless a size is given; icons sit next to
     their label, so screen readers skip them. Selected navigation items switch
     to weight="fill". -->
<IconContext values={{ size: 24, weight: 'regular', 'aria-hidden': 'true' }}>
	{@render children()}
	<!-- App-drawn replacements for the WebView's context menu and title tooltips. -->
	<ContextMenuHost />
	<TooltipHost />
</IconContext>
