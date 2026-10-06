<script lang="ts">
	// One project's page, over the canvas (the sidebar stays): its
	// directories (the main one and extra ones the user adds), its
	// requirements (the workbench's list, this project's only; one opens in
	// place) and the agents that belong to it.
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { open } from '@tauri-apps/plugin-dialog';
	import Button from '$lib/ui/Button.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import RequirementBoard from '$lib/requirements/RequirementBoard.svelte';
	import RequirementDetail from '$lib/requirements/RequirementDetail.svelte';
	import type { StartHow } from '$lib/requirements/StartButton.svelte';
	import { useRequirements, type Requirement } from '$lib/requirements.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { Project } from '$lib/types';
	import { t } from '$lib/i18n';

	let {
		project,
		projects,
		currentStep,
		onClose,
		onDirs,
		onStartRequirement,
		onOpenSession,
		onOpenAgent,
		onNewAgent
	}: {
		project: Project;
		/** The open workspace's projects. */
		projects: { id: string; path: string; name: string }[];
		currentStep?: (session: string) => string | undefined;
		onClose: () => void;
		/** The extra directories changed. */
		onDirs: (dirs: string[]) => void;
		onStartRequirement: (r: Requirement, how: StartHow) => void;
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
		onNewAgent: () => void;
	} = $props();

	const reqs = useRequirements();
	const dirs = $derived(project.dirs ?? []);
	const norm = (p: string) => p.replace(/[\\/]+$/, '');
	let requirementId = $state<string | null>(null);
	const shownReq = $derived(requirementId ? reqs.get(requirementId) : undefined);
	const agents = $derived(agentDirectory.agents.filter((a) => a.project === project.id));

	async function addDir() {
		const path = await open({ directory: true, title: t('shell.projectPage.addDir') });
		if (!path || Array.isArray(path)) return;
		if ([project.path, ...dirs].some((d) => norm(d) === norm(path))) return toast.warn(t('shell.projectPage.dirKnown'));
		onDirs([...dirs, path]);
	}
</script>

<div class="project-page">
	{#if shownReq}
		<div class="col wide">
			{#key shownReq.id}
				<RequirementDetail
					requirement={shownReq}
					{projects}
					onBack={() => (requirementId = null)}
					onStart={onStartRequirement}
					{onOpenSession}
				/>
			{/key}
		</div>
	{:else}
		<div class="col">
			<header>
				<h1>{project.name}</h1>
				<button class="close" onclick={onClose} aria-label={t('common.close')} title={t('common.close')}><XIcon size={17} /></button>
			</header>

			<section>
				<h3>{t('shell.projectPage.dirs')}</h3>
				<p class="hint">{t('shell.projectPage.dirsHint')}</p>
				<div class="dirs">
					<div class="dir">
						<FolderIcon size={15} />
						<span class="path">{project.path}</span>
						<span class="tag">{t('shell.projectPage.main')}</span>
					</div>
					{#each dirs as dir (dir)}
						<div class="dir">
							<FolderIcon size={15} />
							<span class="path">{dir}</span>
							<button
								class="icon"
								aria-label={t('shell.projectPage.removeDir')}
								title={t('shell.projectPage.removeDir')}
								onclick={() => onDirs(dirs.filter((d) => d !== dir))}><XIcon size={13} /></button
							>
						</div>
					{/each}
				</div>
				<Button size="sm" onclick={addDir}><PlusIcon size={13} />{t('shell.projectPage.addDir')}</Button>
			</section>

			<section>
				<h3>{t('shell.requirement.title')}</h3>
				<RequirementBoard
					list={reqs.list}
					{projects}
					project={project.id}
					{currentStep}
					onOpen={(id) => (requirementId = id)}
					onStart={onStartRequirement}
				/>
			</section>

			<section>
				<div class="h3-row">
					<h3>{t('shell.projectPage.agents')}</h3>
					<Button size="sm" variant="ghost" onclick={onNewAgent}><PlusIcon size={13} />{t('shell.projectPage.newAgent')}</Button>
				</div>
				{#if agents.length}
					<div class="agents">
						{#each agents as a (a.id)}
							<button class="agent" class:off={!a.enabled} onclick={() => onOpenAgent(a.id)}>
								<AgentAvatar agent={a} size={24} />
								<span class="two">
									<span class="name">{a.name}</span>
									{#if a.summary}<span class="sub">{a.summary}</span>{/if}
								</span>
								{#if a.busy && a.enabled}<CircleNotchIcon size={13} class="spin" />{/if}
							</button>
						{/each}
					</div>
				{:else}
					<p class="hint">{t('shell.projectPage.noAgents')}</p>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	.project-page {
		position: absolute;
		inset: 0;
		z-index: 10;
		overflow-y: auto;
		background: var(--bg);
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.col {
		max-width: 760px;
		margin: 0 auto;
		padding: 48px 32px 80px;
	}
	.col.wide {
		max-width: 1120px;
		padding-top: 40px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	h1 {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.close,
	.icon {
		display: inline-flex;
		flex: none;
		padding: 6px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.icon {
		padding: 3px;
	}
	.close:hover,
	.icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	section {
		margin-top: 32px;
	}
	h3 {
		margin: 0 0 6px;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.h3-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	.h3-row h3 {
		margin: 0;
	}
	.hint {
		margin: 0 0 10px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.dirs {
		display: flex;
		flex-direction: column;
		margin-bottom: 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--panel);
		overflow: hidden;
	}
	.dir {
		display: flex;
		align-items: center;
		gap: 9px;
		min-height: 36px;
		padding: 0 8px 0 12px;
		border-top: 1px solid var(--hairline);
		color: var(--dim);
	}
	.dir:first-child {
		border-top: none;
	}
	.path {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex: none;
		padding: 0 4px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.agents {
		display: flex;
		flex-direction: column;
	}
	.agent {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.agent:hover {
		background: var(--surface);
	}
	.agent.off {
		opacity: 0.6;
	}
	.two {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.name {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.sub {
		font-size: var(--fs-xs);
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
