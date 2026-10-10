<script lang="ts">
	// A new conversation not started yet: where it starts (the project) and
	// which agent runs it. Both are only recorded until the first message
	// starts the engine there (SessionStore.moveDraft / switchBackend).
	import { open } from '@tauri-apps/plugin-dialog';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { BACKEND_LABELS, NATIVE_BACKEND_IDS } from '$lib/backends';
	import type { SessionStore } from '$lib/session.svelte';
	import type { Session } from '$lib/types';

	let { store, session }: { store: SessionStore; session: Session } = $props();

	const OPEN_FOLDER = '\u0000open';
	let menu = $state(false);
	const projects = $derived(store.shownProjects.filter((p) => !p.chats && !p.stale));
	const current = $derived(store.projects.find((p) => p.sessions.some((s) => s.id === session.id)));
	// The home directory as ~, as a terminal shows it.
	const short = (path: string) => path.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');

	async function pick(key: string) {
		menu = false;
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
</script>

<div class="picker">
	<div class="row">
		<span class="lbl">{t('shell.startPicker.project')}</span>
		<span class="anchor">
			<button class="proj" onclick={() => (menu = !menu)} aria-haspopup="menu" aria-expanded={menu}>
				<FolderIcon size={15} />
				<span class="pname">{current?.name ?? ''}</span>
				{#if current}<span class="ppath" title={current.path}>{short(current.path)}</span>{/if}
				<CaretDownIcon size={12} />
			</button>
			{#if menu}
				<PopMenu
					placement="down-left"
					items={[
						...projects.map((p) => ({ key: p.id, label: p.name, desc: short(p.path), icon: FolderIcon, checked: p.id === current?.id })),
						{ key: OPEN_FOLDER, label: t('shell.startPicker.openFolder'), icon: FolderPlusIcon }
					]}
					onSelect={pick}
					onClose={() => (menu = false)}
				/>
			{/if}
		</span>
	</div>
	<div class="row">
		<span class="lbl">{t('shell.startPicker.backend')}</span>
		<div class="backends" role="radiogroup" aria-label={t('shell.startPicker.backend')}>
			{#each NATIVE_BACKEND_IDS as id (id)}
				<button
					class="be"
					class:on={session.backendId === id}
					role="radio"
					aria-checked={session.backendId === id}
					onclick={() => store.switchBackend(session.id, id)}
				>
					<BackendIcon backend={id} size={14} />
					<span>{BACKEND_LABELS[id]}</span>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.picker {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 10px 14px;
		width: min(460px, 100%);
		padding: 14px 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		text-align: left;
	}
	.row {
		display: contents;
	}
	.lbl {
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
	}
	.anchor {
		position: relative;
		display: flex;
		min-width: 0;
	}
	.proj {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		max-width: 100%;
		padding: 5px 9px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.proj:hover {
		background: var(--surface2);
	}
	.proj > :global(svg) {
		flex: none;
		color: var(--dim);
	}
	.pname {
		flex: none;
		max-width: 50%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.ppath {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.backends {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 3px;
		border-radius: var(--r-md);
		background: var(--surface2);
		justify-self: start;
	}
	.be {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.be:hover {
		color: var(--text);
	}
	.be.on {
		background: var(--panel);
		color: var(--text);
		font-weight: 500;
		box-shadow: var(--shadow-float);
	}
	.proj:focus-visible,
	.be:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
</style>
