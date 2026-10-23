<script lang="ts">
	import '$lib/app.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	import { initTheme } from '$lib/theme.svelte';
	import { prefs, applyPlatformClass } from '$lib/prefs.svelte';
	import { getLocale, setLocale } from '$lib/i18n';
	import { setLucideProps } from '@lucide/svelte/context';
	import ContextMenuHost from '$lib/ui/ContextMenuHost.svelte';
	import TooltipHost from '$lib/ui/TooltipHost.svelte';
	import ImageViewerHost from '$lib/ui/ImageViewerHost.svelte';
	import { installSmoothWheel } from '$lib/smoothWheel';

	// Tag the root with the host OS before first paint so platform-specific window
	// chrome (macOS traffic-light insets vs a native Windows/Linux title bar) is
	// styled correctly from the very first frame.
	if (browser) applyPlatformClass();

	let { children } = $props();

	// A newer build was deployed while this page was open: go to the next page
	// with a full load, so it comes with that build's files.
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});

	// Icon defaults (lucide): a fixed 1.5px stroke at every size, so 12px and
	// 20px icons read as the same weight. Icons are aria-hidden unless labelled.
	setLucideProps({ strokeWidth: 1.5, nonScalingStroke: true });

	onMount(() => {
		initTheme();
		// prefs.init() also reflects the macOS sidebar-vibrancy choice onto the root.
		prefs.init();
		// Persist detection + reflect the active locale on <html lang> for a11y.
		setLocale(getLocale());
		// A mouse wheel glides instead of stepping (macOS; the app hands its events over).
		if ('__TAURI_INTERNALS__' in window && document.documentElement.dataset.os === 'macos') installSmoothWheel(() => prefs.zoom);
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

{@render children()}
<!-- A custom theme's background image (app.css .theme-backdrop). -->
<div class="theme-backdrop" aria-hidden="true"></div>
<!-- App-drawn replacements for the WebView's context menu and title tooltips. -->
<ContextMenuHost />
<TooltipHost />
<ImageViewerHost />
