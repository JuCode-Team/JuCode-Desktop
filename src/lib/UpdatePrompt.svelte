<script lang="ts">
	// The update dialog. An installed update asks once to restart (later: the
	// next launch runs it anyway). A version the server no longer accepts
	// (updater.required) blocks the app until the update is in: it downloads,
	// then only offers the restart.
	import { openUrl } from '@tauri-apps/plugin-opener';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { readConfig } from '$lib/protocol';
	import { updater } from '$lib/updater.svelte';
	import { t } from '$lib/i18n';

	const required = $derived(!!updater.required);
	const ready = $derived(updater.phase === 'ready');
	const open = $derived(required || (ready && updater.dismissed !== updater.version));
	const busy = $derived(updater.phase === 'checking' || updater.phase === 'downloading');

	async function openDownloads() {
		const cfg = await readConfig().catch(() => ({}) as Record<string, unknown>);
		const web = String(cfg.jucode_web_url || 'https://api.jucode.net').replace(/\/+$/, '');
		await openUrl(`${web}/download`).catch(() => {});
	}
</script>

{#if open}
	<Modal label={t('shell.updatePrompt.label')} width={440} dismissible={!required} onClose={() => updater.dismiss()}>
		<div class="up">
			<h2>
				{required
					? t('shell.updatePrompt.requiredTitle', { version: updater.required })
					: t('shell.updatePrompt.readyTitle', { version: updater.version })}
			</h2>
			<p class="hint">
				{#if required && !ready}
					{t('shell.updatePrompt.requiredHint')}
				{:else}
					{t('shell.updatePrompt.readyHint')}
				{/if}
			</p>
			{#if updater.notes && (ready || busy)}
				<pre class="notes selectable">{updater.notes}</pre>
			{/if}
			{#if busy}
				<div class="bar"><div class="fill" style:width="{updater.progress}%"></div></div>
				<p class="hint">
					{updater.phase === 'checking'
						? t('shell.updatePrompt.checking')
						: t('shell.updatePrompt.downloading', { pct: updater.progress })}
				</p>
			{:else if required && !ready}
				<p class="hint">{t('shell.updatePrompt.unreachable')}</p>
			{/if}
			<div class="actions">
				{#if ready}
					{#if !required}
						<Button variant="secondary" onclick={() => updater.dismiss()}>{t('shell.updatePrompt.later')}</Button>
					{/if}
					<Button variant="primary" onclick={() => updater.restart()}>
						<ArrowClockwiseIcon size={14} />
						{t('shell.updatePrompt.restart')}
					</Button>
				{:else if required && !busy}
					<Button variant="secondary" onclick={openDownloads}>{t('shell.updatePrompt.openDownload')}</Button>
					<Button variant="primary" onclick={() => updater.check(false, true)}>{t('shell.updatePrompt.retry')}</Button>
				{/if}
			</div>
		</div>
	</Modal>
{/if}

<style>
	.up {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.6;
	}
	.notes {
		max-height: 200px;
		margin: 0;
		padding: 10px 12px;
		overflow: auto;
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: var(--fs-sm);
		line-height: 1.6;
		white-space: pre-wrap;
	}
	.bar {
		height: 4px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--surface2);
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width var(--t-fast) var(--ease-out);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
</style>
