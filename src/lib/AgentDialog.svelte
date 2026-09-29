<script lang="ts">
	// New long-lived agent: id, name, working directory and role. Created in
	// the local jucode daemon; the parent opens its first session.
	import { onMount, tick } from 'svelte';
	import { X, Bot, LoaderCircle } from 'lucide-svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { agentDirectory, type AgentView } from '$lib/agents.svelte';
	import { t } from '$lib/i18n';

	let {
		defaultDir = '',
		onClose,
		onCreated
	}: {
		defaultDir?: string;
		onClose: () => void;
		onCreated: (agent: AgentView) => void;
	} = $props();

	let name = $state('');
	let id = $state('');
	let idEdited = $state(false);
	let cwd = $state('');
	let role = $state('');
	let busy = $state(false);
	let error = $state('');
	let nameEl = $state<HTMLInputElement | null>(null);

	const idValid = $derived(/^[a-z0-9-]{1,40}$/.test(id));
	const canCreate = $derived(idValid && !!cwd.trim() && !!role.trim() && !busy);

	onMount(() => {
		cwd = defaultDir;
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
				role: role.trim()
			});
			onCreated(agent);
		} catch (e) {
			error = String(e instanceof Error ? e.message : e);
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (!busy) onClose();
		} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			create();
		}
	}
</script>

<div
	class="overlay"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && !busy && onClose()}
	onkeydown={onKey}
>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label={t('shell.agents.dialogTitle')}
		use:focusTrap
	>
		<div class="head">
			<span class="title"><Bot size={15} /> {t('shell.agents.dialogTitle')}</span>
			<IconButton onclick={onClose} label="close" disabled={busy}><X size={15} /></IconButton>
		</div>
		<div class="body">
			<p class="hint">{t('shell.agents.dialogHint')}</p>
			<label class="field">
				<span>{t('shell.agents.nameLabel')}</span>
				<input bind:this={nameEl} bind:value={name} />
			</label>
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
			<div class="field">
				<span>{t('shell.agents.dirLabel')}</span>
				<div class="dir">
					<input class="mono" bind:value={cwd} />
					<Button size="sm" onclick={browse}>{t('shell.agents.browse')}</Button>
				</div>
			</div>
			<label class="field">
				<span>{t('shell.agents.roleLabel')}</span>
				<textarea bind:value={role} rows="4" placeholder={t('shell.agents.rolePlaceholder')}
				></textarea>
			</label>
			{#if error}
				<div class="err">{error}</div>
			{/if}
		</div>
		<div class="foot">
			<Button size="sm" onclick={onClose} disabled={busy}>{t('common.cancel')}</Button>
			<Button size="sm" variant="primary" onclick={create} disabled={!canCreate}>
				{#if busy}<LoaderCircle size={13} class="gspin" />
					{t('shell.agents.creating')}{:else}{t('shell.agents.create')}{/if}
			</Button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: var(--scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
		animation: scrim-in var(--t-fast) var(--ease-out);
	}
	.modal {
		width: min(480px, 92vw);
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		animation: sheet-in var(--t-med) var(--ease-spring);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.title {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		font-size: var(--fs-md);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 11px;
		padding: 13px 14px;
		overflow-y: auto;
	}
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
	.err {
		padding: 7px 10px;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 30%, transparent);
		border-radius: var(--r-sm);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 11px 14px;
		border-top: 1px solid var(--hairline);
	}
</style>
