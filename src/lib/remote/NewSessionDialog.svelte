<script lang="ts">
	// Start a session from the remote app: pick the project and the engine
	// that runs it. Chats run on JuCode only (the chat mode is JuCode's).
	import { untrack } from 'svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { remoteProjects, type ProjectView } from './store.svelte';
	import { t } from '$lib/i18n';
	import { CHATS_ENABLED } from '$lib/types';

	let {
		project,
		onCreate,
		onClose
	}: {
		/** Preselected project; any project of the active workspace otherwise. */
		project?: ProjectView;
		onCreate: (project: ProjectView, engine: string) => void;
		onClose: () => void;
	} = $props();

	const projects = $derived((remoteProjects.active?.projects ?? []).filter((p) => CHATS_ENABLED || !p.chats));
	let projectId = $state(untrack(() => project?.id ?? ''));
	$effect(() => {
		if (!projectId && projects.length) projectId = projects[0].id;
	});
	const chosen = $derived(projects.find((p) => p.id === projectId) ?? project);
	let engine = $state('jucode');
	const engines = $derived(
		chosen?.chats
			? [{ value: 'jucode', label: 'JuCode' }]
			: [
					{ value: 'jucode', label: 'JuCode' },
					{ value: 'claude', label: 'Claude Code' },
					{ value: 'codex', label: 'Codex' }
				]
	);
	$effect(() => {
		if (!engines.some((e) => e.value === engine)) engine = 'jucode';
	});
	const label = (p: ProjectView) => (p.chats ? t('shell.remote.chats') : p.name);
</script>

<Modal title={t('shell.remote.newSession')} width={420} {onClose}>
	<div class="form">
		{#if !project}
			<div class="field">
				<span class="caption">{t('shell.remote.project')}</span>
				<Select
					value={projectId}
					options={projects.map((p) => ({ value: p.id, label: label(p) }))}
					onChange={(v) => (projectId = v)}
				/>
			</div>
		{/if}
		<div class="field">
			<span class="caption">{t('shell.remote.engine')}</span>
			<Segmented bind:value={engine} options={engines} />
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={onClose}>{t('common.cancel')}</Button>
		<Button variant="primary" disabled={!chosen} onclick={() => chosen && onCreate(chosen, engine)}>
			{t('shell.remote.create')}
		</Button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.caption {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
</style>
