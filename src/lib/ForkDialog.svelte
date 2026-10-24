<script lang="ts">
	// Forking a conversation from a turn: the new session goes on in the
	// same directory as the original, or in a worktree of its own whose files
	// are as they were when that turn ended (its checkpoint), so neither
	// side's edits reach the other.
	import { onMount } from 'svelte';
	import GitForkIcon from '@lucide/svelte/icons/git-fork';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { git, gitCheckpointCapture, gitForkWorktree, worktreeBase } from '$lib/protocol';
	import { slugifyTaskName } from '$lib/gitops';
	import { t } from '$lib/i18n';
	import type { WorktreeMeta } from '$lib/types';

	let {
		repo,
		cwd,
		title,
		session,
		keep,
		latest,
		checkpoint,
		onFork,
		onClose
	}: {
		/** The repository's main checkout (worktrees are made beside it). */
		repo: string;
		/** Where the original session works. */
		cwd: string;
		title: string;
		/** The original's desktop id: its checkpoints are kept under it. */
		session: string;
		/** User turns the fork keeps. */
		keep: number;
		/** It forks from the last turn: the files are as they are now. */
		latest: boolean;
		/** The checkpoint taken before turn `keep`, when this app run has it. */
		checkpoint?: string;
		onFork: (worktree?: { path: string; meta: WorktreeMeta }) => void;
		onClose: () => void;
	} = $props();

	let where = $state<'here' | 'worktree'>('here');
	let base = $state<string | null>(null);
	let busy = $state(false);
	let error = $state('');

	// A worktree needs a repository: its current branch is the base.
	onMount(() => {
		git(['branch', '--show-current'], repo)
			.then((out) => (base = String(out).trim()))
			.catch(() => (base = null));
	});

	// `fork-<title>-<time>`: a valid, unused slug whatever the title's script.
	const slug = $derived(['fork', slugifyTaskName(title).slice(0, 40), Date.now().toString(36)].filter(Boolean).join('-'));

	async function confirm() {
		if (where === 'here') return onFork();
		if (busy || base === null) return;
		busy = true;
		error = '';
		try {
			const container = await worktreeBase(repo);
			const path = `${container}${container.includes('\\') ? '\\' : '/'}${slug}`;
			const branch = `fork/${slug.slice('fork-'.length)}`;
			const sha = latest ? await gitCheckpointCapture(cwd) : (checkpoint ?? '');
			await gitForkWorktree(repo, path, branch, sha, latest ? undefined : session, latest ? undefined : keep);
			onFork({ path, meta: { isWorktree: true, mainRepoPath: repo, branch, baseBranch: base, slug } });
		} catch (e) {
			error = String(e).includes('no checkpoint') ? t('chat.fork.noCheckpoint') : String(e);
			busy = false;
		}
	}
</script>

<Modal title={t('chat.fork.title')} dismissible={!busy} {onClose}>
	{#snippet icon()}<GitForkIcon size={16} />{/snippet}
	<p class="hint">{t('chat.fork.hint')}</p>
	<div class="choices" role="radiogroup">
		<label class="choice" class:on={where === 'here'}>
			<input type="radio" bind:group={where} value="here" disabled={busy} />
			<span class="name">{t('chat.fork.here')}</span>
			<span class="desc">{t('chat.fork.hereDesc')}</span>
		</label>
		<label class="choice" class:on={where === 'worktree'} class:off={base === null}>
			<input type="radio" bind:group={where} value="worktree" disabled={busy || base === null} />
			<span class="name">{t('chat.fork.worktree')}</span>
			<span class="desc">{base === null ? t('chat.fork.noRepo') : t('chat.fork.worktreeDesc', { branch: `fork/${slug.slice('fork-'.length)}` })}</span>
		</label>
	</div>
	{#if error}
		<Notice mono onDismiss={() => (error = '')}>{error}</Notice>
	{/if}
	{#snippet footer()}
		<Button size="sm" onclick={onClose} disabled={busy}>{t('common.cancel')}</Button>
		<Button size="sm" variant="primary" onclick={confirm} disabled={busy}>
			{#if busy}<LoaderCircleIcon size={14} class="spin" /> {t('chat.fork.making')}{:else}{t('chat.fork.confirm')}{/if}
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
	.choices {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.choice {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 8px;
		row-gap: 2px;
		padding: 10px 12px;
		border-radius: var(--r);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		transition: box-shadow var(--t-fast) var(--ease-out);
	}
	.choice.on {
		box-shadow: inset 0 0 0 1px var(--border-strong);
		background: var(--surface);
	}
	.choice.off {
		cursor: default;
		opacity: 0.6;
	}
	.choice input {
		grid-row: span 2;
		margin: 2px 0 0;
	}
	.name {
		font-size: var(--fs-sm);
		color: var(--text);
	}
	.desc {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.5;
	}
</style>
