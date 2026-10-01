<script lang="ts">
	// Settings → 关于: the license texts of the third-party code the app ships
	// (written at build time by scripts/third-party-notices.mjs, the bundled
	// jucode CLI's from its release).
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	const FILES = ['/third-party-notices.txt', '/jucode-cli-third-party-notices.txt'];
	let open = $state(false);
	let text = $state('');

	async function show() {
		open = true;
		if (text) return;
		const parts = await Promise.all(
			FILES.map((file) =>
				fetch(file)
					.then((r) => (r.ok ? r.text() : ''))
					.catch(() => '')
			)
		);
		text = parts.filter(Boolean).join('\n\n') || t('settings.licenses.missing');
	}
</script>

<SettingsSection title={t('settings.licenses.groupLabel')}>
	<SettingsRow id="licenses" title={t('settings.licenses.title')} description={t('settings.licenses.hint')}>
		<Button size="sm" variant="secondary" onclick={show}>{t('settings.licenses.open')}</Button>
	</SettingsRow>
</SettingsSection>

{#if open}
	<Modal title={t('settings.licenses.title')} width={760} onClose={() => (open = false)}>
		<pre class="notices selectable">{text || t('settings.licenses.loading')}</pre>
	</Modal>
{/if}

<style>
	.notices {
		max-height: 64vh;
		margin: 0;
		overflow: auto;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
