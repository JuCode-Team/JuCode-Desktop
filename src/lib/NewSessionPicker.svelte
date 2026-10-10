<script lang="ts">
	// A new conversation not started yet, as one sentence: "in <project>
	// with <agent>", both words menus. The choices are only recorded until the
	// first message starts the engine there (SessionStore.moveDraft /
	// switchBackend).
	import { open } from '@tauri-apps/plugin-dialog';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { BACKEND_LABELS, NATIVE_BACKEND_IDS, type BackendId } from '$lib/backends';
	import type { SessionStore } from '$lib/session.svelte';
	import type { Session } from '$lib/types';

	let { store, session }: { store: SessionStore; session: Session } = $props();

	const OPEN_FOLDER = '\u0000open';
	let menu = $state<'project' | 'backend' | null>(null);
	const projects = $derived(store.shownProjects.filter((p) => !p.chats && !p.stale));
	const current = $derived(store.projects.find((p) => p.sessions.some((s) => s.id === session.id)));
	// The home directory as ~, as a terminal shows it.
	const short = (path: string) => path.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
	// The sentence around the two menus, in the UI language's word order.
	const parts = $derived(t('shell.startPicker.lead').split(/(\{project\}|\{backend\})/));

	async function pickProject(key: string) {
		menu = null;
		if (key !== OPEN_FOLDER) return store.moveDraft(session.id, key);
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
		store.addProjectShell({ id: store.uid(), name, path });
		// Already a project (the same folder, with or without a trailing separator): that one.
		const trim = (x: string) => x.replace(/[\\/]+$/, '');
		const added = store.userProjects.find((p) => trim(p.path) === trim(path));
		if (added) store.moveDraft(session.id, added.id);
	}
	function pickBackend(key: string) {
		menu = null;
		store.switchBackend(session.id, key as BackendId);
	}
</script>

<p class="lead">
	{#each parts as part, i (i)}
		{#if part === '{project}'}
			<span class="anchor">
				<button class="word" class:on={menu === 'project'} onclick={() => (menu = menu === 'project' ? null : 'project')} aria-haspopup="menu" aria-expanded={menu === 'project'} title={current?.path} aria-label={t('shell.startPicker.project')}>
					<FolderIcon size={15} />
					<span class="wname">{current?.name ?? ''}</span>
					<CaretDownIcon size={11} />
				</button>
				{#if menu === 'project'}
					<PopMenu
						placement="down-left"
						items={[
							...projects.map((p) => ({ key: p.id, label: p.name, desc: short(p.path), icon: FolderIcon, checked: p.id === current?.id })),
							{ key: OPEN_FOLDER, label: t('shell.startPicker.openFolder'), icon: FolderPlusIcon }
						]}
						onSelect={pickProject}
						onClose={() => (menu = null)}
					/>
				{/if}
			</span>
		{:else if part === '{backend}'}
			<span class="anchor">
				<button class="word" class:on={menu === 'backend'} onclick={() => (menu = menu === 'backend' ? null : 'backend')} aria-haspopup="menu" aria-expanded={menu === 'backend'} aria-label={t('shell.startPicker.backend')}>
					<BackendIcon backend={session.backendId} size={14} />
					<span class="wname">{BACKEND_LABELS[session.backendId]}</span>
					<CaretDownIcon size={11} />
				</button>
				{#if menu === 'backend'}
					<PopMenu
						placement="down-left"
						items={NATIVE_BACKEND_IDS.map((id) => ({ key: id, label: BACKEND_LABELS[id], checked: id === session.backendId }))}
						onSelect={pickBackend}
						onClose={() => (menu = null)}
					/>
				{/if}
			</span>
		{:else}{part}{/if}
	{/each}
</p>

<style>
	/* The welcome line itself: the same size and colour as the hint it
	   replaces; the two choices read as words in it. */
	.lead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 2px;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-md);
		white-space: pre-wrap;
	}
	.anchor {
		position: relative;
		display: inline-flex;
		text-align: left;
	}
	.word {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 260px;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.word:hover,
	.word.on {
		background: var(--surface2);
	}
	.word:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.word > :global(svg:last-child) {
		color: var(--dim2);
	}
	.wname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
