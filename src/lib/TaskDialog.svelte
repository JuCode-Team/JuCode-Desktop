<script lang="ts">
	// 新建并行任务对话框：任务名（实时 slug 预览）+ 基于分支（默认当前分支）+
	// 可选任务描述。确认后在 <repo-parent>/.jucode-worktrees/<repo>/<slug> 创建
	// worktree（分支 task/<slug>），由父组件把它作为新项目打开。
	import { onMount, tick } from 'svelte';
	import { X, GitBranch, LoaderCircle } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { git, worktreeBase } from '$lib/protocol';
	import { focusTrap } from '$lib/focusTrap';
	import { slugifyTaskName, parseBranches, isValidBranchName } from '$lib/gitops';
	import { t } from '$lib/i18n';
	import type { Project, WorktreeMeta } from '$lib/types';

	let {
		project,
		onClose,
		onCreated
	}: {
		project: Project;
		onClose: () => void;
		/** worktree 已创建：path = worktree 目录，description 非空时作为首条消息。 */
		onCreated: (path: string, meta: WorktreeMeta, description: string) => void;
	} = $props();

	let name = $state('');
	let description = $state('');
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

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && onClose()} onkeydown={onKey}>
	<div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.task.dialogTitle')} use:focusTrap>
		<div class="head">
			<span class="title"><GitBranch size={15} /> {t('shell.task.dialogTitle')}</span>
			<IconButton onclick={onClose} label="close" disabled={busy}><X size={15} /></IconButton>
		</div>
		<div class="body">
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
				<select bind:value={base}>
					{#each branches as b (b)}<option value={b}>{b}</option>{/each}
					{#if base && !branches.includes(base)}<option value={base}>{base}</option>{/if}
				</select>
			</label>
			<label class="field">
				<span>{t('shell.task.descLabel')}</span>
				<textarea bind:value={description} rows="4" placeholder={t('shell.task.descPlaceholder')}></textarea>
			</label>
			{#if error}
				<div class="err" role="button" tabindex="0" onclick={() => (error = '')} onkeydown={(e) => e.key === 'Enter' && (error = '')}>{error}</div>
			{/if}
		</div>
		<div class="foot">
			<Button size="sm" onclick={onClose} disabled={busy}>{t('common.cancel')}</Button>
			<Button size="sm" variant="primary" onclick={create} disabled={!canCreate}>
				{#if busy}<LoaderCircle size={13} class="gspin" /> {t('shell.task.creating')}{:else}{t('shell.task.create')}{/if}
			</Button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
	}
	.modal {
		width: min(460px, 92vw);
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
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
		font-size: 14px;
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
		font-size: 12px;
		color: var(--dim);
		line-height: 1.5;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--dim);
	}
	.field input,
	.field textarea,
	.field select {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13px;
		padding: 7px 10px;
		outline: none;
		resize: vertical;
	}
	.field input:focus,
	.field textarea:focus,
	.field select:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 8px 10px;
		border: 1px dashed var(--hairline);
		border-radius: var(--r-sm);
		font-size: 12px;
	}
	.preview.bad {
		border-color: color-mix(in oklab, var(--warn) 45%, transparent);
	}
	.plabel {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.preview code {
		font-family: var(--font-mono);
		font-size: 11.5px;
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
		font-size: 11.5px;
		color: var(--warn);
	}
	.err {
		padding: 7px 10px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 30%, transparent);
		border-radius: var(--r-sm);
		white-space: pre-wrap;
		word-break: break-word;
		cursor: pointer;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 11px 14px;
		border-top: 1px solid var(--hairline);
	}
	:global(.gspin) {
		animation: gspin 0.9s linear infinite;
	}
	@keyframes gspin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
