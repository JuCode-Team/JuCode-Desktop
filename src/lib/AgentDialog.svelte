<script lang="ts">
	// New long-lived agent: id, name, project, working directory and role.
	// Created in the local jucode daemon; the parent opens its first session.
	// With a project, it works in the project's main directory.
	import { onMount, tick } from 'svelte';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ShuffleIcon from 'phosphor-svelte/lib/ShuffleIcon';
	import { open } from '@tauri-apps/plugin-dialog';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import { agentDirectory, type AgentView } from '$lib/agents.svelte';
	import { newAvatarSeed } from '$lib/avatar';
	import { t } from '$lib/i18n';

	let {
		defaultDir = '',
		projects = [],
		defaultProject = '',
		onClose,
		onCreated
	}: {
		defaultDir?: string;
		/** The open workspace's projects. */
		projects?: { id: string; path: string; name: string }[];
		/** The project it is created in ('' for none). */
		defaultProject?: string;
		onClose: () => void;
		onCreated: (agent: AgentView) => void;
	} = $props();

	let name = $state('');
	let id = $state('');
	let idEdited = $state(false);
	let cwd = $state('');
	let project = $state('');
	const projectOptions = $derived([
		{ value: '', label: t('shell.agents.noProject') },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	/** A project's agent works in its main directory. */
	function pickProject(id: string) {
		const p = projects.find((x) => x.id === id);
		if (p) cwd = p.path;
	}
	let role = $state('');
	// The avatar it will have; 「换一个」 draws another.
	let seed = $state(newAvatarSeed());
	let busy = $state(false);
	let error = $state('');
	let nameEl = $state<HTMLInputElement | null>(null);

	const idValid = $derived(/^[a-z0-9-]{1,40}$/.test(id));
	const canCreate = $derived(idValid && !!cwd.trim() && !!role.trim() && !busy);

	onMount(() => {
		cwd = defaultDir;
		project = projects.some((p) => p.id === defaultProject) ? defaultProject : '';
		pickProject(project);
		tick().then(() => nameEl?.focus());
	});

	// The id follows the name until the user edits it.
	$effect(() => {
		if (!idEdited) {
			id = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40);
		}
	});

	async function browse() {
		const path = await open({ directory: true, title: t('shell.agents.dirLabel') });
		if (path && !Array.isArray(path)) cwd = path;
	}

	async function create() {
		if (!canCreate) return;
		busy = true;
		error = '';
		try {
			const agent = await agentDirectory.create({
				id,
				name: name.trim(),
				cwd: cwd.trim(),
				role: role.trim(),
				avatar_seed: seed,
				workspace: workspaces.activeId,
				...(project ? { project } : {})
			});
			onCreated(agent);
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
			busy = false;
		}
	}

	// ⌘/Ctrl+Enter creates from any field; Escape is the modal's.
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			create();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<Modal title={t('shell.agents.dialogTitle')} width={480} dismissible={!busy} {onClose}>
	{#snippet icon()}<RobotIcon size={15} />{/snippet}
	<p class="hint">{t('shell.agents.dialogHint')}</p>
	<div class="field">
		<span>{t('shell.agents.nameLabel')}</span>
		<div class="dir">
			<AgentAvatar agent={{ id, avatar_seed: seed }} size={30} />
			<input bind:this={nameEl} bind:value={name} aria-label={t('shell.agents.nameLabel')} />
			<Button size="sm" onclick={() => (seed = newAvatarSeed())}>
				<ShuffleIcon size={13} />{t('shell.chrome.shuffle')}
			</Button>
		</div>
	</div>
	<label class="field">
		<span>{t('shell.agents.idLabel')}</span>
		<input
			class="mono"
			class:bad={!!id && !idValid}
			bind:value={id}
			oninput={() => (idEdited = true)}
		/>
		<small>{t('shell.agents.idHint')}</small>
	</label>
	{#if projects.length}
		<div class="field">
			<span>{t('shell.agents.projectLabel')}</span>
			<Select bind:value={project} options={projectOptions} onChange={pickProject} />
		</div>
	{/if}
	<div class="field">
		<span>{t('shell.agents.dirLabel')}</span>
		<div class="dir">
			<input class="mono" bind:value={cwd} disabled={!!project} />
			<Button size="sm" onclick={browse} disabled={!!project}>{t('shell.agents.browse')}</Button>
		</div>
	</div>
	<label class="field">
		<span>{t('shell.agents.roleLabel')}</span>
		<textarea bind:value={role} rows="4" placeholder={t('shell.agents.rolePlaceholder')}
		></textarea>
	</label>
	{#if error}
		<Notice mono>{error}</Notice>
	{/if}
	{#snippet footer()}
		<Button size="sm" onclick={onClose} disabled={busy}>{t('common.cancel')}</Button>
		<Button size="sm" variant="primary" onclick={create} disabled={!canCreate}>
			{#if busy}<CircleNotchIcon size={13} class="spin" />
				{t('shell.agents.creating')}{:else}{t('shell.agents.create')}{/if}
		</Button>
	{/snippet}
</Modal>

<style>
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.5;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.field small {
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.field input,
	.field textarea {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
		padding: 7px 10px;
		outline: none;
		resize: vertical;
		min-width: 0;
	}
	.field .mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.field input.bad {
		border-color: color-mix(in oklab, var(--warn) 60%, var(--border));
	}
	.field input:focus,
	.field textarea:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.dir {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.dir input {
		flex: 1;
	}
</style>
