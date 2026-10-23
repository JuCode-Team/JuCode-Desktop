<script lang="ts">
	// A new conversation not started yet, as one sentence: "in <place>
	// with <agent>", each a menu. The place is the project and, when it is
	// not the project's own folder, the folder inside it. The choices are
	// only recorded until the first message starts the engine there
	// (SessionStore.moveDraft / setDraftCwd / switchBackend).
	import { open } from '@tauri-apps/plugin-dialog';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { BACKEND_LABELS, NATIVE_BACKEND_IDS, type BackendId } from '$lib/backends';
	import type { SessionStore } from '$lib/session.svelte';
	import { LOOSE_ID, type Session } from '$lib/types';

	let { store, session }: { store: SessionStore; session: Session } = $props();

	const OPEN_FOLDER = '\u0000open';
	// Menu keys: a project's id, or DIR + a folder of the current project.
	const DIR = '\u0000dir:';
	let menu = $state<'place' | 'backend' | null>(null);
	const projects = $derived(store.workspaceProjects.filter((p) => !p.stale));
	const current = $derived(store.ownerOf(session.id));
	const cwd = $derived(session.cwd || current?.path || '');
	const trim = (x: string) => x.replace(/[\\/]+$/, '');
	const same = (a: string, b: string) => trim(a) === trim(b);
	const base = (path: string) => trim(path).split(/[\\/]/).pop() || path;
	// The home directory as ~, as a terminal shows it.
	const short = (path: string) => path.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
	const inProject = $derived(!!current && !current.loose);
	/** The current project's other folders, and the one picked. */
	const subdirs = $derived(inProject ? [...new Set([...(current!.dirs ?? []), cwd])].filter((d) => d && !same(d, current!.path)) : []);
	const label = $derived(inProject ? (same(cwd, current!.path) ? current!.name : `${current!.name} / ${base(cwd)}`) : base(cwd) || t('shell.noProject'));
	const items = $derived([
		...projects.flatMap((p) => [
			{ key: p.id, label: p.name, desc: short(p.path), icon: FolderIcon, checked: p.id === current?.id && same(cwd, p.path) },
			...(p.id === current?.id ? subdirs.map((d) => ({ key: DIR + d, label: `${p.name} / ${base(d)}`, desc: short(d), icon: FolderOpenIcon, checked: same(d, cwd) })) : [])
		]),
		{ key: LOOSE_ID, label: t('shell.noProject'), desc: current?.loose ? short(cwd) : undefined, checked: !!current?.loose },
		{ key: OPEN_FOLDER, label: t('shell.startPicker.openFolder'), icon: FolderPlusIcon }
	]);
	// The sentence around the two menus, in the UI language's word order.
	const parts = $derived(t('shell.startPicker.lead').split(/(\{place\}|\{backend\})/));

	async function pickPlace(key: string) {
		menu = null;
		if (key.startsWith(DIR)) return store.setDraftCwd(session.id, key.slice(DIR.length));
		if (key !== OPEN_FOLDER) {
			store.moveDraft(session.id, key);
			// The same project again: back to its own folder.
			if (key === current?.id && inProject) store.setDraftCwd(session.id, current.path);
			return;
		}
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		// A folder of the current project, or anywhere for a conversation of
		// no project: it works there. Elsewhere the folder is a project
		// (an existing one, or added).
		if (current?.loose || (inProject && [current!.path, ...(current!.dirs ?? [])].some((d) => same(d, path)))) return store.setDraftCwd(session.id, path);
		if (!store.projects.some((p) => !p.loose && same(p.path, path))) store.addProjectShell({ id: store.uid(), name: base(path), path });
		const target = store.projects.find((p) => !p.loose && same(p.path, path));
		if (target) store.moveDraft(session.id, target.id);
	}
	function pickBackend(key: string) {
		menu = null;
		store.switchBackend(session.id, key as BackendId);
	}
</script>

<p class="lead">
	{#each parts as part, i (i)}
		{#if part === '{place}'}
			<span class="anchor">
				<button class="word" class:on={menu === 'place'} onclick={() => (menu = menu === 'place' ? null : 'place')} aria-haspopup="menu" aria-expanded={menu === 'place'} title={cwd} aria-label={t('shell.startPicker.project')}>
					<FolderIcon size={16} />
					<span class="wname">{label}</span>
					<ChevronDownIcon size={12} />
				</button>
				{#if menu === 'place'}
					<PopMenu placement="down-left" {items} onSelect={pickPlace} onClose={() => (menu = null)} />
				{/if}
			</span>
		{:else if part === '{backend}'}
			<span class="anchor">
				<button class="word" class:on={menu === 'backend'} onclick={() => (menu = menu === 'backend' ? null : 'backend')} aria-haspopup="menu" aria-expanded={menu === 'backend'} aria-label={t('shell.startPicker.backend')}>
					<BackendIcon backend={session.backendId} agent={session.chat.acpAgentId} size={14} />
					<span class="wname">{BACKEND_LABELS[session.backendId]}</span>
					<ChevronDownIcon size={12} />
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
		border-radius: var(--r);
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
