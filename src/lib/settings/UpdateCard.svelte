<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw, CircleCheck, CircleAlert, Download, RotateCw } from 'lucide-svelte';
	import { getVersion } from '@tauri-apps/api/app';
	import Button from '$lib/ui/Button.svelte';
	import { updater } from '$lib/updater.svelte';
	import { t } from '$lib/i18n';

	let current = $state('');
	onMount(async () => {
		current = await getVersion().catch(() => '');
	});
</script>

<div class="group">
	<div class="glabel"><RefreshCw size={12} /> {t('settings.update.groupLabel')}</div>
	<div class="card">
		<div class="row">
			<span class="txt">
				<span class="title">{t('settings.update.currentVersion')}</span>
				<span class="ver mono">{current ? `v${current}` : '…'}</span>
			</span>
			{#if updater.phase === 'checking'}
				<Button variant="secondary" size="sm" disabled>{t('settings.update.checking')}</Button>
			{:else if updater.phase === 'available'}
				<Button variant="primary" size="sm" onclick={() => updater.download()}><Download size={14} /> {t('settings.update.download')}</Button>
			{:else if updater.phase === 'downloading'}
				<Button variant="primary" size="sm" disabled>{t('settings.update.downloading', { pct: updater.progress })}</Button>
			{:else if updater.phase === 'ready'}
				<Button variant="primary" size="sm" onclick={() => updater.restart()}><RotateCw size={14} /> {t('settings.update.restart')}</Button>
			{:else}
				<Button variant="secondary" size="sm" onclick={() => updater.check()}>{t('settings.update.check')}</Button>
			{/if}
		</div>
		{#if updater.phase === 'latest'}
			<p class="status ok"><CircleCheck size={13} /> {t('settings.update.latest')}</p>
		{:else if updater.available}
			<p class="status accent">{t('settings.update.found', { version: updater.version })}</p>
		{:else if updater.phase === 'error'}
			<p class="status err"><CircleAlert size={13} /> {t('settings.update.error', { msg: updater.error })}</p>
		{/if}
		{#if updater.phase === 'downloading'}
			<div class="bar"><div class="fill" style:width="{updater.progress}%"></div></div>
		{/if}
		{#if updater.phase === 'ready'}
			<p class="status ok"><CircleCheck size={13} /> {t('settings.update.readyHint')}</p>
		{/if}
	</div>
</div>

<style>
	.group {
		margin-top: 22px;
	}
	.glabel {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--dim2);
		margin-bottom: 10px;
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		padding: 12px 14px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.title {
		font-size: 13px;
	}
	.ver {
		font-size: 12px;
		color: var(--dim);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--dim);
	}
	.status.ok {
		color: var(--ok);
	}
	.status.err {
		color: var(--err);
		word-break: break-all;
	}
	.status.accent {
		color: var(--accent-bright);
	}
	.bar {
		margin-top: 10px;
		height: 5px;
		border-radius: 999px;
		background: var(--surface2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 999px;
		background: var(--accent-bright);
		transition: width var(--t-med) var(--ease-out);
	}
</style>
