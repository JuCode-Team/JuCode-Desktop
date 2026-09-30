<script lang="ts">
	// The remote app's list, laid out like the desktop sidebar: agents, chats,
	// then projects with their sessions nested and an archived section each.
	// Sessions come from the daemon's list, the one the desktop shows too, so
	// titles, archive state and removals are the same on every device.
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import BoxArrowUpIcon from 'phosphor-svelte/lib/BoxArrowUpIcon';
	import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import FilesIcon from 'phosphor-svelte/lib/FilesIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { agentDirectory, type AgentView, type DaemonSessionView } from '$lib/agents.svelte';
	import { baseName, remoteProjects, type ProjectView } from './store.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';

	let {
		current,
		onOpenSession,
		onNewSession,
		onAddProject,
		onHistory,
		onFiles,
		onChanges,
		onOpenAgent
	}: {
		/** The session shown next to the list (wide screens). */
		current?: string;
		onOpenSession: (s: DaemonSessionView, project?: ProjectView) => void;
		onNewSession: (project?: ProjectView) => void;
		onAddProject: () => void;
		onHistory: (project: ProjectView) => void;
		onFiles: (project: ProjectView) => void;
		onChanges: (project: ProjectView) => void;
		onOpenAgent: (agent: AgentView) => void;
	} = $props();

	const SHOW_LIMIT = 6;
	const trim = (path: string) => path.replace(/[\\/]+$/, '');

	const projects = $derived(remoteProjects.active?.projects ?? []);
	const chats = $derived(projects.find((p) => p.chats));
	const code = $derived(projects.filter((p) => !p.chats));
	/** The daemon's sessions, newest first. A closed ACP session cannot be
	 *  reopened, so it is not listed (the desktop does the same). */
	const listed = $derived(
		agentDirectory.sessions
			.filter((s) => !s.agent && (s.engine !== 'acp' || s.open))
			.sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at))
	);
	const sessionsOf = (p: ProjectView) => listed.filter((s) => trim(s.cwd) === trim(p.path));
	/** Sessions in no project of this workspace. */
	const loose = $derived(listed.filter((s) => !projects.some((p) => trim(s.cwd) === trim(p.path))));

	let collapsed = $state<Record<string, boolean>>({});
	let showAll = $state<Record<string, boolean>>({});
	let showArchived = $state<Record<string, boolean>>({});

	const waiting = (s: DaemonSessionView) =>
		agentDirectory.questions.some((q) => q.session === s.session) ||
		agentDirectory.actions.some((a) => a.session_id === s.session);
	/** The daemon labels a session with no title yet by its id. */
	const title = (s: DaemonSessionView) => (s.title && s.title !== s.session ? s.title : t('shell.untitled'));

	// A current daemon sends its workspaces right after connecting; only
	// call it outdated when none arrived in a while.
	let waited = $state(false);
	$effect(() => {
		if (agentDirectory.status !== 'on') return;
		waited = false;
		const timer = setTimeout(() => (waited = true), 3000);
		return () => clearTimeout(timer);
	});

	// The actions sheet of a session or a project.
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
				<span class="chip"><BackendIcon backend={s.engine as 'claude'} size={12} /></span>
			{/if}
			{#if waiting(s)}<span class="tag">{t('shell.awaitShort')}</span>{/if}
		</button>
		<button
			class="act hover"
			onclick={() => setMeta(s, { archived: !s.archived })}
			aria-label={s.archived ? t('shell.unarchive') : t('shell.archive')}
			title={s.archived ? t('shell.unarchive') : t('shell.archive')}
		>
			{#if s.archived}<BoxArrowUpIcon size={16} />{:else}<ArchiveIcon size={16} />{/if}
		</button>
		<button class="act" onclick={() => openMenu({ session: s })} aria-label={t('shell.remote.more')}>
			<DotsThreeIcon size={16} weight="bold" />
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
			<span class="chev" class:open={showArchived[p.id]}><CaretRightIcon size={14} /></span>
			{t('shell.archived')} · {arch.length}
		</button>
		{#if showArchived[p.id]}
			{#each arch as s (s.session)}{@render row(s, p, nested)}{/each}
		{/if}
	{/if}
{/snippet}

{#if agentDirectory.status === 'on' && waited && !remoteProjects.supported}
	<Notice tone="warn">{t('shell.remote.outdated')}</Notice>
{:else}
	{#if remoteProjects.workspaces.length > 1}
		<div class="workspaces">
			{#each remoteProjects.workspaces as ws (ws.id)}
				<button class:on={remoteProjects.active?.id === ws.id} onclick={() => (remoteProjects.activeId = ws.id)}>{ws.name}</button>
			{/each}
		</div>
	{/if}

	{#if agentDirectory.agents.length}
		<section>
			<div class="head"><span>{t('shell.remote.agents')}</span></div>
			{#each agentDirectory.agents as a (a.id)}
				<div class="sess">
					<button class="sess-main" onclick={() => onOpenAgent(a)}>
						{#if a.busy}<CircleNotchIcon size={16} class="spin" />{:else}<RobotIcon size={16} />{/if}
						<span class="agent-text">
							<span class="sess-title">{a.name}</span>
							{#if a.summary}<span class="summary">{a.summary}</span>{/if}
						</span>
					</button>
				</div>
			{/each}
		</section>
	{/if}

	{#if chats}
		<section>
			<div class="head">
				<span>{t('shell.chats')}</span>
				<button class="act" onclick={() => onHistory(chats)} aria-label={t('shell.history')} title={t('shell.history')}>
					<ClockCounterClockwiseIcon size={16} />
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
			{@const w = sessionsOf(p).some((s) => s.session === current) ? 'fill' : 'regular'}
			<div class="folder">
				<button class="folder-row" onclick={() => (collapsed[p.id] = !collapsed[p.id])} title={p.path}>
					{#if open}<FolderOpenIcon size={18} weight={w} />{:else}<FolderIcon size={18} weight={w} />{/if}
					<span class="folder-name">{p.name}</span>
				</button>
				<button class="act" onclick={() => onNewSession(p)} aria-label={t('shell.remote.newSession')} title={t('shell.remote.newSession')}>
					<PlusIcon size={16} />
				</button>
				<button class="act" onclick={() => openMenu({ project: p })} aria-label={t('shell.remote.more')}>
					<DotsThreeIcon size={16} weight="bold" />
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
				<button onclick={() => ((name = s.title ?? ''), (renaming = true))}><PencilSimpleIcon size={16} />{t('shell.remote.rename')}</button>
				<button onclick={() => closeThen(setMeta, s, { archived: !s.archived })}>
					{#if s.archived}<BoxArrowUpIcon size={16} />{t('shell.unarchive')}{:else}<ArchiveIcon size={16} />{t('shell.archive')}{/if}
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
			<button onclick={() => closeThen(onChanges, p)}><GitDiffIcon size={16} />{t('shell.remote.changes')}</button>
			<button onclick={() => closeThen(onHistory, p)}><ClockCounterClockwiseIcon size={16} />{t('shell.history')}</button>
			<button class="danger" onclick={() => removeProject(p)}><XIcon size={16} />{t('shell.remote.removeProject')}</button>
		</div>
	</Modal>
{/if}

<style>
	.workspaces {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		margin-bottom: 8px;
		padding-bottom: 2px;
	}
	.workspaces button {
		flex-shrink: 0;
		padding: 6px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.workspaces button.on {
		border-color: var(--accent);
		color: var(--text);
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
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
	}
	.folder,
	.sess {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: var(--r-md);
		transition: background var(--t-fast) var(--ease-out);
		animation: fade var(--t-med) var(--ease-out);
	}
	/* Press feedback on every tappable row and button. */
	.folder-row,
	.sess-main,
	.act,
	.more,
	.menu button,
	.workspaces button {
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
	.act:active,
	.workspaces button:active {
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
	.folder-row :global(svg),
	.sess-main :global(svg) {
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
		border-radius: var(--r-full);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.agent-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.summary {
		color: var(--dim2);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
		.sess .act,
		.folder .act {
			visibility: hidden;
		}
		.sess:hover .act,
		.sess:focus-within .act,
		.folder:hover .act,
		.folder:focus-within .act {
			visibility: visible;
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
		border-radius: var(--r-md);
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
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		outline: none;
	}
</style>
