<script lang="ts">
	// 新建并行任务对话框：任务名（实时 slug 预览）+ 基于分支（默认当前分支）+
	// 可选任务描述。确认后在 <repo-parent>/.jucode-worktrees/<repo>/<slug> 创建
	// worktree（分支 task/<slug>），由父组件把它作为新项目打开。
	import { onMount, tick } from 'svelte';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { git, worktreeBase } from '$lib/protocol';
	import { slugifyTaskName, parseBranches, isValidBranchName } from '$lib/gitops';
	import { t } from '$lib/i18n';
	import type { Project, WorktreeMeta } from '$lib/types';

	let {
		project,
		name: initialName = '',
		description: initialDescription = '',
		onClose,
		onCreated
	}: {
		project: Project;
		/** Prefilled task name and description (a requirement started here). */
		name?: string;
		description?: string;
		onClose: () => void;
		/** worktree 已创建：path = worktree 目录，description 非空时作为首条消息。 */
		onCreated: (path: string, meta: WorktreeMeta, description: string) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(initialName);
	// svelte-ignore state_referenced_locally
	let description = $state(initialDescription);
	let base = $state('');
	let branches = $state<string[]>([]);
	let busy = $state(false);
	let error = $state('');
	let nameEl = $state<HTMLInputElement | null>(null);

	const slug = $derived(slugifyTaskName(name));
	const branch = $derived(slug ? `task/${slug}` : '');
	const canCreate = $derived(!!slug && !!base && !busy && isValidBranchName(branch));

	onMount(async () => {
		tick().then(() => nameEl?.focus());
		try {
			base = (await git(['branch', '--show-current'], project.path)).trim();
			branches = parseBranches(await git(['branch', '--format=%(refname:short)'], project.path));
			if (!base && branches.length) base = branches[0];
		} catch (e) {
			error = String(e);
		}
	});

	async function create() {
		if (!canCreate) return;
		busy = true;
		error = '';
		try {
			const container = await worktreeBase(project.path);
			const path = `${container}/${slug}`;
			await git(['worktree', 'add', path, '-b', branch, base], project.path);
			onCreated(path, { isWorktree: true, mainRepoPath: project.path, branch, baseBranch: base, slug }, description.trim());
		} catch (e) {
			error = String(e);
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
	import Select from '$lib/ui/Select.svelte';
</script>

<svelte:window onkeydown={onKey} />

<Modal title={t('shell.task.dialogTitle')} dismissible={!busy} {onClose}>
	{#snippet icon()}<GitBranchIcon size={15} />{/snippet}
	<p class="hint">{t('shell.task.dialogHint')}</p>
	<label class="field">
		<span>{t('shell.task.nameLabel')}</span>
		<input
			bind:this={nameEl}
			bind:value={name}
			placeholder={t('shell.task.namePlaceholder')}
			onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
		/>
	</label>
	<div class="preview" class:bad={!!name.trim() && !slug}>
		<span class="plabel">{t('shell.task.slugPreview')}</span>
		{#if slug}
			<code>…/.jucode-worktrees/{project.name}/{slug}</code>
			<code class="pbranch">task/{slug} ← {base || '…'}</code>
		{:else if name.trim()}
			<span class="pbad">{t('shell.task.slugInvalid')}</span>
		{:else}
			<code class="dim">—</code>
		{/if}
	</div>
	<label class="field">
		<span>{t('shell.task.baseLabel')}</span>
		<Select bind:value={base} options={[...branches, ...(base && !branches.includes(base) ? [base] : [])].map((b) => ({ value: b }))} />
	</label>
	<label class="field">
		<span>{t('shell.task.descLabel')}</span>
		<textarea bind:value={description} rows="4" placeholder={t('shell.task.descPlaceholder')}></textarea>
	</label>
	{#if error}
		<Notice mono onDismiss={() => (error = '')}>{error}</Notice>
	{/if}
	{#snippet footer()}
		<Button size="sm" onclick={onClose} disabled={busy}>{t('common.cancel')}</Button>
		<Button size="sm" variant="primary" onclick={create} disabled={!canCreate}>
			{#if busy}<CircleNotchIcon size={13} class="spin" /> {t('shell.task.creating')}{:else}{t('shell.task.create')}{/if}
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
	}
	.field input:focus,
	.field textarea:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 8px 10px;
		border: 1px dashed var(--hairline);
		border-radius: var(--r-sm);
		font-size: var(--fs-xs);
	}
	.preview.bad {
		border-color: color-mix(in oklab, var(--warn) 45%, transparent);
	}
	.plabel {
		font-size: var(--fs-2xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.preview code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
		word-break: break-all;
	}
	.preview .pbranch {
		color: var(--accent-bright);
	}
	.preview .dim {
		color: var(--dim2);
	}
	.pbad {
		font-size: var(--fs-xs);
		color: var(--warn);
	}
</style>
