<script lang="ts">
	// The composer's branch picker, opened from the branch chip under the input:
	// filter the local branches, switch to one, or create one and switch to it.
	// git itself refuses a switch that would lose uncommitted changes; its
	// message is shown as is.
	import { onMount } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { git } from '$lib/protocol';
	import { isValidBranchName, parseBranches } from '$lib/gitops';
	import { t } from '$lib/i18n';

	let {
		cwd,
		repo,
		current,
		onChanged,
		onClose
	}: {
		cwd: string;
		/** Shown in the search placeholder. */
		repo: string;
		current: string;
		onChanged: () => void;
		onClose: () => void;
	} = $props();

	let branches = $state<string[]>([]);
	let query = $state('');
	let creating = $state(false);
	let newName = $state('');
	let busy = $state(false);
	let error = $state('');

	onMount(() => {
		git(['branch', '--format=%(refname:short)'], cwd)
			.then((out) => (branches = parseBranches(out)))
			.catch((e) => (error = String(e)));
	});

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? branches.filter((b) => b.toLowerCase().includes(q)) : branches;
	});

	async function run(args: string[]) {
		busy = true;
		error = '';
		try {
			await git(args, cwd);
			onChanged();
			onClose();
		} catch (e) {
			error = String(e).trim();
		} finally {
			busy = false;
		}
	}
	function pick(name: string) {
		if (name === current) onClose();
		else void run(['switch', name]);
	}
	function startCreate() {
		creating = true;
		newName = query.trim();
		error = '';
	}
	function create() {
		const name = newName.trim();
		if (!isValidBranchName(name)) {
			error = t('dock.git.badBranchName');
			return;
		}
		void run(['switch', '--create', name]);
	}
	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && shown[0]) {
			e.preventDefault();
			pick(shown[0]);
		}
	}
	function onCreateKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			create();
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			creating = false;
		}
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !creating && onClose()} />

<button class="bm-backdrop" aria-label="close menu" tabindex="-1" onclick={onClose}></button>
<div class="pop bm" role="dialog" aria-label={t('chat.branchMenu.title')}>
	{#if creating}
		<label class="field">
			<GitBranchIcon size={15} />
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={newName} placeholder={t('dock.git.newBranchPlaceholder')} onkeydown={onCreateKey} disabled={busy} spellcheck="false" autofocus />
		</label>
		<button class="pop-row" disabled={busy || !newName.trim()} onclick={create}>
			<span class="pop-ico"><PlusIcon size={16} /></span>
			<span class="pop-txt"><span class="pop-label">{t('chat.branchMenu.createNamed', { name: newName.trim() })}</span></span>
		</button>
	{:else}
		<label class="field">
			<MagnifyingGlassIcon size={15} />
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={query} placeholder={t('chat.branchMenu.search', { repo })} onkeydown={onSearchKey} spellcheck="false" autofocus />
		</label>
		<div class="pop-head">{t('chat.branchMenu.title')}</div>
		<div class="list" role="listbox">
			{#each shown as b (b)}
				<button class="pop-row" role="option" aria-selected={b === current} disabled={busy} onclick={() => pick(b)}>
					<span class="pop-ico"><GitBranchIcon size={16} /></span>
					<span class="pop-txt"><span class="pop-label name" title={b}>{b}</span></span>
					<span class="pop-check" class:off={b !== current}><CheckIcon size={16} /></span>
				</button>
			{:else}
				<div class="empty">{branches.length ? t('chat.branchMenu.none') : ''}</div>
			{/each}
		</div>
		<div class="sep"></div>
		<button class="pop-row" disabled={busy} onclick={startCreate}>
			<span class="pop-ico"><PlusIcon size={16} /></span>
			<span class="pop-txt"><span class="pop-label">{t('chat.branchMenu.create')}</span></span>
		</button>
	{/if}
	{#if error}<div class="err">{error}</div>{/if}
</div>

<style>
	.bm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.bm {
		position: absolute;
		left: 0;
		bottom: calc(100% + 8px);
		z-index: 81;
		width: min(340px, calc(100vw - 32px));
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-out);
	}
	.field {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 10px;
		margin-bottom: 4px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
	}
	.field input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 260px;
		overflow-y: auto;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pop-check.off {
		visibility: hidden;
	}
	.empty {
		padding: 6px 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.sep {
		height: 1px;
		margin: 4px 8px;
		background: var(--hairline);
	}
	.err {
		padding: 6px 12px 4px;
		color: var(--err);
		font-size: var(--fs-xs);
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
