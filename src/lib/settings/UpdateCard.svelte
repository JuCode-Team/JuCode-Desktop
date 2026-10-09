<script lang="ts">
	import { onMount } from 'svelte';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import { aboutApp, openLogsFolder, type AboutApp } from '$lib/about';
	import { toast } from '$lib/ui/toast.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { updater } from '$lib/updater.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let about = $state<AboutApp | null>(null);
	const current = $derived(about?.version ?? '');
	onMount(async () => {
		about = await aboutApp();
	});
	function showLogs() {
		openLogsFolder().catch((e) => toast.error(String(e)));
	}
</script>

<SettingsSection title={t('settings.update.groupLabel')}>
	<SettingsRow id="app-version" title={t('settings.update.currentVersion')} description={current ? `v${current}` : '…'}>
		{#snippet detail()}
			{#if updater.phase === 'latest'}
				<p class="status ok"><CheckCircleIcon size={13} /> {t('settings.update.latest')}</p>
			{:else if updater.available}
				<p class="status accent">{t('settings.update.found', { version: updater.version })}</p>
			{:else if updater.phase === 'error'}
				<div class="err"><Notice>{t('settings.update.error', { msg: updater.error })}</Notice></div>
			{/if}
			{#if updater.phase === 'downloading'}
				<div class="bar"><div class="fill" style:width="{updater.progress}%"></div></div>
			{/if}
			{#if updater.phase === 'ready'}
				<p class="status ok"><CheckCircleIcon size={13} /> {t('settings.update.readyHint')}</p>
			{/if}
		{/snippet}
		{#if updater.phase === 'checking'}
			<Button variant="secondary" size="sm" disabled>{t('settings.update.checking')}</Button>
		{:else if updater.phase === 'available'}
			<Button variant="primary" size="sm" onclick={() => updater.download()}><DownloadSimpleIcon size={14} /> {t('settings.update.download')}</Button>
		{:else if updater.phase === 'downloading'}
			<Button variant="primary" size="sm" disabled>{t('settings.update.downloading', { pct: updater.progress })}</Button>
		{:else if updater.phase === 'ready'}
			<Button variant="primary" size="sm" onclick={() => updater.restart()}><ArrowClockwiseIcon size={14} /> {t('settings.update.restart')}</Button>
		{:else}
			<Button variant="secondary" size="sm" onclick={() => updater.check()}>{t('settings.update.check')}</Button>
		{/if}
	</SettingsRow>
	{#if about?.cli}
		<SettingsRow id="engine-version" title={t('settings.update.engineVersion')} description={`v${about.cli}`} />
	{/if}
	<SettingsRow id="logs" title={t('settings.update.logs')} description={about ? `${about.os} · ${about.arch}` : undefined}>
		<Button variant="secondary" size="sm" onclick={showLogs}><FolderOpenIcon size={14} /> {t('settings.update.openLogs')}</Button>
	</SettingsRow>
</SettingsSection>

<style>
	.status {
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 4px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.status.ok {
		color: var(--ok);
	}
	.status.accent {
		color: var(--accent-bright);
	}
	.err {
		margin-top: 6px;
	}
	.bar {
		margin-top: 8px;
		max-width: 320px;
		height: 5px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: var(--r-full);
		background: var(--accent-bright);
		transition: width var(--t-med) var(--ease-out);
	}
</style>
