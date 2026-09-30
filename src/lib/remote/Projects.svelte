<script lang="ts">
	// The remote app's home: the workspace's projects, then sessions the
	// daemon hosts outside any project.
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import ChatsCircleIcon from 'phosphor-svelte/lib/ChatsCircleIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import { remoteProjects, shortPath, within, type ProjectView } from './store.svelte';
	import SessionRow from './SessionRow.svelte';
	import { t } from '$lib/i18n';

	let {
		onOpenProject,
		onAddProject,
		onOpenSession,
		onNewSession
	}: {
		onOpenProject: (project: ProjectView) => void;
		onAddProject: () => void;
		onOpenSession: (session: string, cwd: string, title: string) => void;
		onNewSession: () => void;
	} = $props();

	const allProjects = $derived(remoteProjects.workspaces.flatMap((w) => w.projects));
	/** Hosted sessions that belong to no project (and to no agent). */
	const loose = $derived(
		agentDirectory.sessions
			.filter((s) => !s.agent && !s.archived && !s.chat && !allProjects.some((p) => within(s.cwd, p.path)))
			.sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at))
	);
	// A current daemon sends its workspaces right after connecting; only
	// call it outdated when none arrived in a while.
	let waited = $state(false);
	$effect(() => {
		if (agentDirectory.status !== 'on') return;
		waited = false;
		const timer = setTimeout(() => (waited = true), 3000);
		return () => clearTimeout(timer);
	});
	const running = (project: ProjectView) =>
		agentDirectory.sessions.filter((s) => s.open && within(s.cwd, project.path)).length;
</script>

{#if agentDirectory.status === 'on' && waited && !remoteProjects.supported}
	<Notice tone="warn">{t('shell.remote.outdated')}</Notice>
{:else}
	{#if remoteProjects.workspaces.length > 1}
		<div class="workspaces">
			{#each remoteProjects.workspaces as ws (ws.id)}
				<button class:on={remoteProjects.active?.id === ws.id} onclick={() => (remoteProjects.activeId = ws.id)}>{ws.name}</button>
			{/each}
		</div>
	{/if}

	{#each remoteProjects.active?.projects ?? [] as project (project.id)}
		<button class="row" onclick={() => onOpenProject(project)}>
			{#if project.chats}<ChatsCircleIcon size={18} />{:else}<FolderIcon size={18} />{/if}
			<span class="text">
				<span class="name">{project.chats ? t('shell.remote.chats') : project.name}</span>
				{#if !project.chats}<span class="path">{shortPath(project.path)}</span>{/if}
			</span>
			{#if running(project) > 0}<span class="count">{t('shell.remote.running', { n: running(project) })}</span>{/if}
			<CaretRightIcon size={14} />
		</button>
	{:else}
		<p class="empty">{t('shell.remote.noProjects')}</p>
	{/each}

	<div class="add">
		{#if remoteProjects.active?.projects.length}
			<Button variant="primary" onclick={onNewSession}><PlusIcon size={14} /> {t('shell.remote.newSession')}</Button>
		{/if}
		<Button onclick={onAddProject}><FolderPlusIcon size={14} /> {t('shell.remote.addProject')}</Button>
	</div>

	{#if loose.length > 0}
		<h2>{t('shell.remote.otherSessions')}</h2>
		{#each loose as s (s.session)}
			<SessionRow
				title={s.title || s.session}
				detail={shortPath(s.cwd)}
				at={s.updated_at ?? s.created_at}
				open={s.open}
				onOpen={() => onOpenSession(s.session, s.cwd, s.title || s.session)}
			/>
		{/each}
	{/if}
{/if}

<style>
	.workspaces {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		margin-bottom: 8px;
		padding-bottom: 2px;
	}
	.workspaces button {
		flex-shrink: 0;
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.workspaces button.on {
		border-color: var(--accent);
		color: var(--text);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 14px 4px;
		border: none;
		border-bottom: 1px solid var(--hairline);
		background: none;
		color: var(--text);
		text-align: left;
	}
	.text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.path {
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		font-size: var(--fs-xs);
		color: var(--accent-bright);
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 16px 0 8px;
	}
	h2 {
		margin: 24px 0 4px;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--dim);
	}
	.empty {
		color: var(--dim2);
		font-size: var(--fs-md);
	}
</style>
