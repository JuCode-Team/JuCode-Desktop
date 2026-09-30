<script lang="ts">
	// One project on the remote app: its sessions (every saved one, whoever
	// ran it), a new session, and the ways into its files and changes.
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import FilesIcon from 'phosphor-svelte/lib/FilesIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import RemoteScreen from './RemoteScreen.svelte';
	import SessionRow from './SessionRow.svelte';
	import { remoteProjects, shortPath, type HistoryItem, type ProjectView } from './store.svelte';
	import { t } from '$lib/i18n';

	let {
		project,
		onBack,
		onOpenSession,
		onNewSession,
		onFiles,
		onChanges
	}: {
		project: ProjectView;
		onBack: () => void;
		onOpenSession: (session: string, cwd: string, title: string) => void;
		onNewSession: () => void;
		onFiles: () => void;
		onChanges: () => void;
	} = $props();

	let items = $state<HistoryItem[]>([]);
	let loading = $state(true);
	let error = $state('');
	let showArchived = $state(false);

	const active = $derived(items.filter((s) => !s.archived && !s.agent));
	const archived = $derived(items.filter((s) => s.archived && !s.agent));
	const title = $derived(project.chats ? t('shell.remote.chats') : project.name);
	/** A session with no messages yet is labelled with its id. */
	const label = (item: HistoryItem) => (item.title === item.session ? t('shell.remote.untitled') : item.title);

	async function load() {
		try {
			items = await remoteProjects.history(project.path);
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	// Loads on mount and again whenever hosted sessions change anywhere
	// (opened, closed, renamed).
	$effect(() => {
		void agentDirectory.sessions;
		void load();
	});

	async function rename(item: HistoryItem) {
		const next = prompt(t('shell.remote.renamePrompt'), item.title);
		if (next === null) return;
		await act(() => remoteProjects.setMeta(item.session, { title: next.trim() }));
	}

	async function archive(item: HistoryItem, value: boolean) {
		await act(() => remoteProjects.setMeta(item.session, { archived: value }));
	}

	async function act(work: () => Promise<void>) {
		try {
			await work();
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function remove() {
		if (!confirm(t('shell.remote.removeProjectConfirm', { name: project.name }))) return;
		try {
			await remoteProjects.removeProject(project.id);
			onBack();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<RemoteScreen {title} subtitle={project.chats ? undefined : shortPath(project.path)} {onBack}>
	<div class="tools">
		<Button variant="primary" onclick={onNewSession}><PlusIcon size={14} /> {t('shell.remote.newSession')}</Button>
		{#if !project.chats}
			<Button onclick={onFiles}><FilesIcon size={14} /> {t('shell.remote.files')}</Button>
			<Button onclick={onChanges}><GitDiffIcon size={14} /> {t('shell.remote.changes')}</Button>
		{/if}
	</div>

	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if loading}
		<p class="empty"><CircleNotchIcon size={14} class="spin" /></p>
	{:else}
		{#each active as item (item.session)}
			<SessionRow
				title={label(item)}
				at={item.updated_at}
				open={item.open}
				onOpen={() => onOpenSession(item.session, project.path, label(item))}
				archived={item.archived}
				onRename={() => rename(item)}
				onArchive={() => archive(item, !item.archived)}
			/>
		{:else}
			<p class="empty">{t('shell.remote.noSessions')}</p>
		{/each}

		{#if archived.length > 0}
			<button class="toggle" onclick={() => (showArchived = !showArchived)}>
				{t('shell.remote.archivedCount', { n: archived.length })}
			</button>
			{#if showArchived}
				{#each archived as item (item.session)}
					<SessionRow
						title={label(item)}
						at={item.updated_at}
						open={item.open}
						onOpen={() => onOpenSession(item.session, project.path, label(item))}
						archived={item.archived}
				onRename={() => rename(item)}
				onArchive={() => archive(item, !item.archived)}
					/>
				{/each}
			{/if}
		{/if}

		{#if !project.chats}
			<button class="toggle danger" onclick={remove}>{t('shell.remote.removeProject')}</button>
		{/if}
	{/if}
</RemoteScreen>

<style>
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 4px 0 12px;
	}
	.toggle {
		display: block;
		margin: 16px 0 4px;
		padding: 4px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.toggle.danger {
		margin-top: 28px;
		color: var(--err);
	}
	.empty {
		color: var(--dim2);
		font-size: var(--fs-md);
	}
</style>
