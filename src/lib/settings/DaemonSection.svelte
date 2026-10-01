<script lang="ts">
	// Settings → 所有智能体 → 后台服务: what the local jucode daemon does for
	// every agent's sessions — naming them (the caller's snippet) and remote
	// access from a phone. Persists to the backend settings in localStorage.
	import type { Snippet } from 'svelte';
	import { loadBackendSettings, saveBackendSettings } from '$lib/backends/settings';
	import { t } from '$lib/i18n';
	import DevicePairing from './DevicePairing.svelte';
	import SettingsSection from './SettingsSection.svelte';

	let { children }: { children?: Snippet } = $props();

	let settings = $state(loadBackendSettings());

	function persist() {
		saveBackendSettings({ ...loadBackendSettings(), remoteAddress: settings.remoteAddress.trim() });
	}
</script>

{@render children?.()}
<SettingsSection id="remote" title={t('settings.backend.remoteGroup')} description={t('settings.backend.remoteGroupHint')}>
	<DevicePairing bind:address={settings.remoteAddress} onAddressChange={persist} />
</SettingsSection>
