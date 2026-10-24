<script lang="ts">
	// Settings → 所有智能体 → 后台服务: what the local jucode daemon does for
	// every agent's sessions — naming them (the caller's snippet), the JuCode
	// tools it gives them, and remote access from a phone or the web (signed
	// in to the JuCode account: `onLogin` starts the app's sign-in).
	import type { Snippet } from 'svelte';
	import { t } from '$lib/i18n';
	import AppToolsSection from './AppToolsSection.svelte';
	import DevicePairing from './DevicePairing.svelte';
	import SettingsSection from './SettingsSection.svelte';

	let { children, onLogin, loggingIn = false }: { children?: Snippet; onLogin: () => void; loggingIn?: boolean } = $props();
</script>

{@render children?.()}
<AppToolsSection />
<SettingsSection id="remote" title={t('settings.backend.remoteGroup')} description={t('settings.backend.remoteGroupHint')}>
	<DevicePairing {onLogin} {loggingIn} />
</SettingsSection>
