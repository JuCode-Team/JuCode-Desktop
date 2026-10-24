<script lang="ts">
	// Settings → 远程访问: reaching this computer from a phone or the web,
	// signed in to the JuCode account (`onLogin` starts the app's sign-in),
	// and the devices paired with it.
	import { t } from '$lib/i18n';
	import DevicePairing from './DevicePairing.svelte';
	import SettingsSection from './SettingsSection.svelte';

	let { onLogin, loggingIn = false }: { onLogin: () => void; loggingIn?: boolean } = $props();
</script>

<SettingsSection id="remote" title={t('settings.backend.remoteGroup')} description={t('settings.backend.remoteGroupHint')}>
	<DevicePairing {onLogin} {loggingIn} />
</SettingsSection>
