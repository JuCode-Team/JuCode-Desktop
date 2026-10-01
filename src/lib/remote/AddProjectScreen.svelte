<script lang="ts">
	// Adds a project from the remote app: browse folders under the computer's
	// home directory, then add the one shown or make a new folder inside it.
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import RemoteScreen from './RemoteScreen.svelte';
	import type { DirListing } from './store.svelte';
	import { useHost } from './connection.svelte';
	import { t } from '$lib/i18n';

	let { onBack, onAdded }: { onBack: () => void; onAdded: () => void } = $props();
	const remoteProjects = useHost().projects;

	let listing = $state<DirListing | null>(null);
	let home = $state('');
	let error = $state('');
	let busy = $state(false);
	let folderName = $state('');
	let gitInit = $state(true);

	async function go(path: string) {
		error = '';
		try {
			listing = await remoteProjects.list(path, true);
			if (!home) home = listing.path;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
	void go('~');

	const parent = $derived.by(() => {
		if (!listing || listing.path === home) return null;
		const cut = listing.path.replace(/[\\/]+$/, '').search(/[\\/][^\\/]*$/);
		return cut > 0 ? listing.path.slice(0, cut) : null;
	});
	const workspaceName = () => t('shell.remote.defaultWorkspace');

	async function run(work: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await work();
			onAdded();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<RemoteScreen title={t('shell.remote.addProject')} subtitle={listing?.path} {onBack}>
	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if !listing}
		<p class="empty"><CircleNotchIcon size={14} class="spin" /></p>
	{:else}
		<div class="here">
			<Button variant="primary" disabled={busy} onclick={() => run(() => remoteProjects.addProject(listing!.path, workspaceName()))}>
				{t('shell.remote.addThisFolder')}
			</Button>
		</div>

		{#if parent}
			<button class="row" onclick={() => go(parent!)}><ArrowUpIcon size={16} /> <span>..</span></button>
		{/if}
		{#each listing.entries as entry (entry.name)}
			<button class="row" onclick={() => go(`${listing!.path}/${entry.name}`)}><FolderIcon size={16} /> <span>{entry.name}</span></button>
		{:else}
			<p class="empty">{t('shell.remote.noFolders')}</p>
		{/each}

		<form class="create" onsubmit={(e) => (e.preventDefault(), run(() => remoteProjects.createProject(listing!.path, folderName.trim(), gitInit, workspaceName())))}>
			<span class="label">{t('shell.remote.newFolderIn')}</span>
			<input bind:value={folderName} placeholder={t('shell.remote.folderName')} autocomplete="off" autocapitalize="off" spellcheck="false" />
			<label class="check"><input type="checkbox" bind:checked={gitInit} /> {t('shell.remote.gitInit')}</label>
			<Button type="submit" disabled={busy || !folderName.trim()}>{t('shell.remote.createProject')}</Button>
		</form>
	{/if}
</RemoteScreen>

<style>
	.here {
		margin: 4px 0 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 12px 4px;
		border: none;
		border-bottom: 1px solid var(--hairline);
		background: none;
		color: var(--text);
		font-size: var(--fs-md);
		text-align: left;
	}
	.row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.create {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}
	.label {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.create input:not([type='checkbox']) {
		height: 40px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-lg);
		outline: none;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--fs-md);
		color: var(--text);
	}
	.empty {
		color: var(--dim2);
		font-size: var(--fs-md);
	}
</style>
