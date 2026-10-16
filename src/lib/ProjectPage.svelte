<script lang="ts">
	// One project's page, a canvas tab: its
	// directories (the main one and extra ones the user adds), its
	// requirements (the workbench's list, this project's only; one opens in
	// place).
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import { open } from '@tauri-apps/plugin-dialog';
	import Button from '$lib/ui/Button.svelte';
	import RequirementBoard from '$lib/requirements/RequirementBoard.svelte';
	import RequirementDetail from '$lib/requirements/RequirementDetail.svelte';
	import type { StartHow } from '$lib/requirements/StartButton.svelte';
	import { useRequirements, type Requirement } from '$lib/requirements.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { Project } from '$lib/types';
	import { t } from '$lib/i18n';

	let {
		project,
		projects,
		currentStep,
		onDirs,
		onStartRequirement,
		onOpenSession
	}: {
		project: Project;
		/** The open workspace's projects. */
		projects: { id: string; path: string; name: string }[];
		currentStep?: (session: string) => string | undefined;
		/** The extra directories changed. */
		onDirs: (dirs: string[]) => void;
		onStartRequirement: (r: Requirement, how: StartHow) => void;
		onOpenSession: (session: string) => void;
	} = $props();

	const reqs = useRequirements();
	const dirs = $derived(project.dirs ?? []);
	const norm = (p: string) => p.replace(/[\\/]+$/, '');
	let requirementId = $state<string | null>(null);
	const shownReq = $derived(requirementId ? reqs.get(requirementId) : undefined);

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
			<h1>{project.name}</h1>

			<section>
				<h3>{t('shell.projectPage.dirs')}</h3>
				<p class="hint">{t('shell.projectPage.dirsHint')}</p>
				<div class="dirs">
					<div class="dir">
						<FolderIcon size={16} />
						<span class="path">{project.path}</span>
						<span class="tag">{t('shell.projectPage.main')}</span>
					</div>
					{#each dirs as dir (dir)}
						<div class="dir">
							<FolderIcon size={16} />
							<span class="path">{dir}</span>
							<button
								class="icon"
								aria-label={t('shell.projectPage.removeDir')}
								title={t('shell.projectPage.removeDir')}
								onclick={() => onDirs(dirs.filter((d) => d !== dir))}><XIcon size={14} /></button
							>
						</div>
					{/each}
				</div>
				<Button size="sm" onclick={addDir}><PlusIcon size={14} />{t('shell.projectPage.addDir')}</Button>
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

		</div>
	{/if}
</div>

<style>
	.project-page {
		height: 100%;
		overflow-y: auto;
		background: var(--bg);
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
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.icon {
		display: inline-flex;
		flex: none;
		padding: 3px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
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
		border-radius: var(--r);
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
</style>
