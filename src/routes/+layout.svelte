<script lang="ts">
	import '$lib/app.css';
	import { onMount } from 'svelte';
	import { initTheme } from '$lib/theme.svelte';

	let { children } = $props();
	onMount(() => initTheme());
</script>

{@render children()}
