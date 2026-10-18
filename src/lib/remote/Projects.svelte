<script lang="ts">
	import ActiveIcon from '$lib/icons/ActiveIcon.svelte';
	// The remote app's list, laid out like the desktop sidebar: chats, then
	// projects with their sessions nested and an archived section each.
	// Sessions come from the daemon's list, the one the desktop shows too, so
	// titles, archive state and removals are the same on every device.
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import RotateCcwClockIcon from '@lucide/svelte/icons/rotate-ccw-clock';
	import FilesIcon from '@lucide/svelte/icons/files';
	import GitCompareIcon from '@lucide/svelte/icons/git-compare';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import { normalizeColor, parseTabIcon } from '$lib/workbench/tabChrome';
	import type { DaemonSessionView } from '$lib/daemonState.svelte';
	import { baseName, type ProjectView } from './store.svelte';
	import { useHost } from './connection.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { CHATS_ENABLED } from '$lib/types';
	import { listable } from './engines';

	let {
		current,
		onOpenSession,
		onNewSession,
		onAddProject,
		onHistory,
		onFiles,
		onChanges
	}: {
		/** The session shown next to the list (wide screens). */
		current?: string;
		onOpenSession: (s: DaemonSessionView, project?: ProjectView) => void;
		onNewSession: (project?: ProjectView) => void;
		onAddProject: () => void;
		onHistory: (project: ProjectView) => void;
		onFiles: (project: ProjectView) => void;
		onChanges: (project: ProjectView) => void;
	} = $props();

	const { daemonState, projects: remoteProjects } = useHost();
	const SHOW_LIMIT = 6;
	const trim = (path: string) => path.replace(/[\\/]+$/, '');

	const projects = $derived(remoteProjects.active?.projects ?? []);
	const chats = $derived(CHATS_ENABLED ? projects.find((p) => p.chats) : undefined);
	const code = $derived(projects.filter((p) => !p.chats));
	/** The daemon's sessions, newest first. A closed session of a registered
	 *  ACP agent reopens on the desktop only, so it is not listed; nor are
	 *  chats while they are hidden. */
	const listed = $derived(
		daemonState.sessions
			.filter((s) => listable(s) && (CHATS_ENABLED || !s.chat))
			.sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at))
	);
	const sessionsOf = (p: ProjectView) => listed.filter((s) => trim(s.cwd) === trim(p.path));
	/** Sessions in no project of any workspace (those of another workspace
	 *  show there). */
	const loose = $derived.by(() => {
		const all = remoteProjects.workspaces.flatMap((w) => w.projects);
		return listed.filter((s) => !all.some((p) => trim(s.cwd) === trim(p.path)));
	});

	let collapsed = $state<Record<string, boolean>>({});
	let showAll = $state<Record<string, boolean>>({});
	let showArchived = $state<Record<string, boolean>>({});

	const waiting = (s: DaemonSessionView) => daemonState.actions.some((a) => a.session_id === s.session);
	/** The daemon labels a session with no title yet by its id. */
	const title = (s: DaemonSessionView) => (s.title && s.title !== s.session ? s.title : t('shell.untitled'));

	// A current daemon sends its workspaces right after connecting; only
	// call it outdated when none arrived in a while.
	let waited = $state(false);
	$effect(() => {
		if (daemonState.status !== 'on') return;
		waited = false;
		const timer = setTimeout(() => (waited = true), 3000);
		return () => clearTimeout(timer);
	});

	// The actions sheet of a session or a project.
	let wsMenu = $state(false);
	let menu = $state<{ session: DaemonSessionView } | { project: ProjectView } | null>(null);
	let renaming = $state(false);
	let name = $state('');
	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

	/** The store shows the change at once and puts it back on failure. */
	async function setMeta(s: DaemonSessionView, changes: { title?: string; archived?: boolean; hidden?: boolean }) {
		try {
			await remoteProjects.setMeta(s.session, changes);
		} catch (e) {
			toast.error(message(e));
		}
	}

	/** Closes the sheet, then acts; the arguments are read while it is open. */
	function closeThen<A extends unknown[]>(action: (...args: A) => unknown, ...args: A) {
		menu = null;
		action(...args);
	}

	function openMenu(target: typeof menu) {
		renaming = false;
		menu = target;
	}

	async function rename(s: DaemonSessionView) {
		menu = null;
		const next = name.trim();
		if (next && next !== s.title) await setMeta(s, { title: next });
	}

	async function remove(s: DaemonSessionView) {
		menu = null;
		if (!confirm(t('shell.remote.removeSessionConfirm', { title: title(s) }))) return;
		await setMeta(s, { hidden: true });
	}

	async function removeProject(p: ProjectView) {
		menu = null;
		if (!confirm(t('shell.remote.removeProjectConfirm', { name: p.name }))) return;
		try {
			await remoteProjects.removeProject(p.id);
		} catch (e) {
			toast.error(message(e));
		}
	}
</script>

{#snippet row(s: DaemonSessionView, p: ProjectView | undefined, nested: boolean)}
	<div class="sess" class:nested class:on={s.session === current} class:arch={s.archived}>
		<button class="sess-main" onclick={() => onOpenSession(s, p)}>
			<span class="sess-title">{title(s)}</span>
			<!-- A session outside the projects names its folder. -->
			{#if !p}<span class="where" title={s.cwd}>{baseName(s.cwd)}</span>{/if}
			{#if s.engine && s.engine !== 'jucode'}
				<span class="chip"><BackendIcon backend={s.engine as 'claude'} agent={s.agent ?? undefined} size={12} /></span>
			{/if}
			{#if waiting(s)}<span class="tag">{t('shell.awaitShort')}</span>{/if}
		</button>
		<button
			class="act hover"
			onclick={() => setMeta(s, { archived: !s.archived })}
			aria-label={s.archived ? t('shell.unarchive') : t('shell.archive')}
			title={s.archived ? t('shell.unarchive') : t('shell.archive')}
		>
			{#if s.archived}<ArchiveRestoreIcon size={16} />{:else}<ArchiveIcon size={16} />{/if}
		</button>
		<button class="act" onclick={() => openMenu({ session: s })} aria-label={t('shell.remote.more')}>
			<EllipsisIcon size={16} />
		</button>
	</div>
{/snippet}

{#snippet group(p: ProjectView, nested: boolean)}
	{@const all = sessionsOf(p)}
	{@const active = all.filter((s) => !s.archived)}
	{@const arch = all.filter((s) => s.archived)}
	{#each showAll[p.id] ? active : active.slice(0, SHOW_LIMIT) as s (s.session)}{@render row(s, p, nested)}{/each}
	{#if active.length > SHOW_LIMIT}
		<button class="more" class:nested onclick={() => (showAll[p.id] = !showAll[p.id])}>
			{showAll[p.id] ? t('shell.showLess') : t('shell.showMore')}
		</button>
	{/if}
	{#if all.length === 0}
		<button class="more ghost" class:nested onclick={() => onNewSession(p)}>{t('shell.remote.newSession')}</button>
	{/if}
	{#if arch.length}
		<button class="more" class:nested onclick={() => (showArchived[p.id] = !showArchived[p.id])}>
			<span class="chev" class:open={showArchived[p.id]}><ChevronRightIcon size={14} /></span>
			{t('shell.archived')} · {arch.length}
		</button>
		{#if showArchived[p.id]}
			{#each arch as s (s.session)}{@render row(s, p, nested)}{/each}
		{/if}
	{/if}
{/snippet}

{#if daemonState.status === 'on' && waited && !remoteProjects.supported}
	<Notice tone="warn">{t('shell.remote.outdated')}</Notice>
{:else}
	<!-- The open workspace (a menu of the others), then a new session, as the
	     desktop's sidebar starts. -->
	<nav class="primary">
		{#if remoteProjects.workspaces.length > 1}
			<div class="ws-anchor">
				<button class="primary-row" class:on={wsMenu} onclick={() => (wsMenu = !wsMenu)} aria-haspopup="menu" aria-expanded={wsMenu}>
					<LayersIcon size={16} />
					<span class="primary-name">{remoteProjects.active?.name ?? ''}</span>
					<ChevronDownIcon size={14} />
				</button>
				{#if wsMenu}
					<PopMenu
						placement="down-left"
						title={t('shell.remote.workspaces')}
						items={remoteProjects.workspaces.map((ws) => ({ key: ws.id, label: ws.name, icon: LayersIcon, checked: ws.id === remoteProjects.active?.id }))}
						onSelect={(id) => ((wsMenu = false), (remoteProjects.activeId = id))}
						onClose={() => (wsMenu = false)}
					/>
				{/if}
			</div>
		{/if}
		<button class="primary-row" onclick={() => onNewSession()}>
			<SquarePenIcon size={16} />
			<span class="primary-name">{t('shell.remote.newSession')}</span>
		</button>
	</nav>


	{#if chats}
		<section>
			<div class="head">
				<span>{t('shell.chats')}</span>
				<button class="act" onclick={() => onHistory(chats)} aria-label={t('shell.history')} title={t('shell.history')}>
					<RotateCcwClockIcon size={16} />
				</button>
				<button class="act" onclick={() => onNewSession(chats)} aria-label={t('shell.newChat')} title={t('shell.newChat')}>
					<PlusIcon size={16} />
				</button>
			</div>
			{@render group(chats, false)}
		</section>
	{/if}

	<section>
		<div class="head">
			<span>{t('shell.projects')}</span>
			<button class="act" onclick={onAddProject} aria-label={t('shell.remote.addProject')} title={t('shell.remote.addProject')}>
				<PlusIcon size={16} />
			</button>
		</div>
		{#each code as p (p.id)}
			{@const open = !collapsed[p.id]}
			{@const holdsActive = sessionsOf(p).some((s) => s.session === current)}
			{@const icon = parseTabIcon(p.icon)}
			{@const color = normalizeColor(p.color)}
			<div class="folder">
				<button class="folder-row" onclick={() => (collapsed[p.id] = !collapsed[p.id])} title={p.path}>
					{#if icon}<TabGlyph {icon} color={color ?? 'var(--dim)'} active={holdsActive} size={16} />{:else if open}<ActiveIcon icon={FolderOpenIcon} size={16} active={holdsActive} {color} />{:else}<ActiveIcon icon={FolderIcon} size={16} active={holdsActive} {color} />{/if}
					<span class="folder-name">{p.name}</span>
				</button>
				<button class="act" onclick={() => onNewSession(p)} aria-label={t('shell.remote.newSession')} title={t('shell.remote.newSession')}>
					<PlusIcon size={16} />
				</button>
				<button class="act" onclick={() => openMenu({ project: p })} aria-label={t('shell.remote.more')}>
					<EllipsisIcon size={16} />
				</button>
			</div>
			{#if open}{@render group(p, true)}{/if}
		{:else}
			<p class="empty">{t('shell.remote.noProjects')}</p>
			<Button onclick={onAddProject}><PlusIcon size={14} /> {t('shell.remote.addProject')}</Button>
		{/each}
	</section>

	{#if loose.length}
		<section>
			<div class="head"><span>{t('shell.remote.otherSessions')}</span></div>
			{#each loose as s (s.session)}{@render row(s, undefined, false)}{/each}
		</section>
	{/if}
{/if}

{#if menu && 'session' in menu}
	{@const s = menu.session}
	<Modal title={title(s)} width={360} onClose={() => (menu = null)}>
		{#if renaming}
			<form class="rename" onsubmit={(e) => (e.preventDefault(), rename(s))}>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={name} placeholder={t('shell.remote.renamePrompt')} autofocus />
				<Button type="submit" variant="primary">{t('common.save')}</Button>
			</form>
		{:else}
			<div class="menu">
				<button onclick={() => ((name = s.title ?? ''), (renaming = true))}><PencilIcon size={16} />{t('shell.remote.rename')}</button>
				<button onclick={() => closeThen(setMeta, s, { archived: !s.archived })}>
					{#if s.archived}<ArchiveRestoreIcon size={16} />{t('shell.unarchive')}{:else}<ArchiveIcon size={16} />{t('shell.archive')}{/if}
				</button>
				<button class="danger" onclick={() => remove(s)}><XIcon size={16} />{t('shell.remote.removeSession')}</button>
			</div>
		{/if}
	</Modal>
{:else if menu && 'project' in menu}
	{@const p = menu.project}
	<Modal title={p.name} width={360} onClose={() => (menu = null)}>
		<p class="path">{p.path}</p>
		<div class="menu">
			<button onclick={() => closeThen(onFiles, p)}><FilesIcon size={16} />{t('shell.remote.files')}</button>
			<button onclick={() => closeThen(onChanges, p)}><GitCompareIcon size={16} />{t('shell.remote.changes')}</button>
			<button onclick={() => closeThen(onHistory, p)}><RotateCcwClockIcon size={16} />{t('shell.history')}</button>
			<button class="danger" onclick={() => removeProject(p)}><XIcon size={16} />{t('shell.remote.removeProject')}</button>
		</div>
	</Modal>
{/if}

<style>
	.primary {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-bottom: 14px;
	}
	.ws-anchor {
		position: relative;
	}
	.primary-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 40px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
	}
	.primary-row > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.primary-row:hover,
	.primary-row.on {
		background: var(--surface2);
	}
	.primary-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	section + section {
		margin-top: 20px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 34px;
		padding: 0 0 0 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.head span {
		flex: 1;
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim2);
	}
	.folder,
	.sess {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: var(--r);
		transition: background var(--t-fast) var(--ease-out);
		animation: fade var(--t-med) var(--ease-out);
	}
	/* Press feedback on every tappable row and button. */
	.folder-row,
	.sess-main,
	.act,
	.more,
	.menu button,
	.primary-row {
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.folder:has(.folder-row:active),
	.sess:has(.sess-main:active) {
		background: var(--surface2);
	}
	.folder-row:active,
	.sess-main:active,
	.menu button:active {
		transform: scale(0.985);
	}
	.act:active {
		transform: scale(0.9);
	}
	.more:hover {
		color: var(--text);
	}
	.folder-row,
	.sess-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding: 0 12px;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
	}
	.folder-row > :global(svg),
	.sess-main > :global(svg) {
		color: var(--dim);
		flex-shrink: 0;
	}
	.folder-name,
	.sess-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess.nested .sess-main {
		padding-left: 40px;
	}
	.sess.on {
		background: var(--surface2);
	}
	.sess.arch .sess-title {
		color: var(--dim2);
	}
	.where {
		flex-shrink: 0;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.chip {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.tag {
		flex-shrink: 0;
		padding: 1px 7px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.more {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-height: 32px;
		padding: 0 12px;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		text-align: left;
	}
	.more.nested {
		padding-left: 40px;
	}
	.more.ghost {
		color: var(--dim2);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.empty {
		margin: 4px 12px 12px;
		color: var(--dim2);
		font-size: var(--fs-md);
	}
	/* Pointer devices: row actions show on hover, as on the desktop. Touch
	   devices keep the actions sheet button and reach archive through it. */
	@media (hover: hover) {
		.folder:hover,
		.sess:hover {
			background: var(--surface);
		}
		.sess.on:hover {
			background: var(--surface2);
		}
		.act:hover {
			background: var(--surface2);
			color: var(--text);
		}
		/* Out of the layout until hover, as on the desktop, so the backend
		   mark sits at the row's end instead of before empty space. */
		.sess .act,
		.folder .act {
			display: none;
		}
		.sess:hover .act,
		.sess:focus-within .act,
		.folder:hover .act,
		.folder:focus-within .act {
			display: inline-flex;
		}
	}
	@media (hover: none) {
		.act.hover {
			display: none;
		}
	}
	.menu {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 42px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		text-align: left;
	}
	.menu button:hover {
		background: var(--surface2);
	}
	.menu button :global(svg) {
		color: var(--dim);
	}
	.menu .danger,
	.menu .danger :global(svg) {
		color: var(--err);
	}
	.path {
		margin: -4px 0 10px;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		word-break: break-all;
	}
	.rename {
		display: flex;
		gap: 8px;
	}
	.rename input {
		flex: 1;
		min-width: 0;
		height: 38px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		outline: none;
	}
</style>
