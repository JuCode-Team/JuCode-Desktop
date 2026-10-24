<script lang="ts">
	// Settings → 所有智能体 → 后台服务: what the local jucode daemon does for
	// every agent's sessions — naming them (the caller's snippet) and the JuCode
	// tools it gives them. Remote access has its own page (RemoteSection).
	import type { Snippet } from 'svelte';
	import AppToolsSection from './AppToolsSection.svelte';

	let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
<AppToolsSection />
