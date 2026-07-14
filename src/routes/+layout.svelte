<script lang="ts">
	import '$lib/app.css';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { getLocale, setLocale } from '$lib/i18n';

	let { children } = $props();
	onMount(() => {
		initTheme();
		prefs.init();
		// Persist detection + reflect the active locale on <html lang> for a11y.
		setLocale(getLocale());
	});
</script>

{@render children()}
