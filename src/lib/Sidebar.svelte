<script lang="ts">
	import { tick } from 'svelte';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import GitForkIcon from 'phosphor-svelte/lib/GitForkIcon';
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import BoxArrowUpIcon from 'phosphor-svelte/lib/BoxArrowUpIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import IdentificationCardIcon from 'phosphor-svelte/lib/IdentificationCardIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import ChatsIcon from 'phosphor-svelte/lib/ChatsIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	import { BACKEND_LABELS } from '$lib/backends';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import type { Project } from '$lib/types';
	import type { AgentView } from '$lib/agents.svelte';

	let {
		projects,
		activeId,
		width,
		resizing = false,
		onSelect,
		onNewProject,
		onNewSession,
		onNewChat,
		onNewTask,
		onCloseSession,
		onCloseProject,
		onArchiveSession,
		onUnarchiveSession,
		onRenameSession,
		onSessionMenu,
		onHistory,
		agents = [],
		agentsStatus = 'off',
		onOpenAgent = () => {},
		onNewAgent = () => {},
		onAgentPage = () => {},
		pendingCount = 0,
		onDesk = () => {}
	}: {
		projects: Project[];
		activeId: string;
		width: number;
		/** True while the user drags the resizer — disables the width transition. */
		resizing?: boolean;
		onSelect: (id: string) => void;
		onNewProject: () => void;
		onNewSession: (p: Project) => void;
		onNewChat: () => void;
		onNewTask: (p: Project) => void;
		onCloseSession: (id: string) => void;
		onCloseProject: (p: Project) => void;
		onArchiveSession: (id: string) => void;
		onUnarchiveSession: (id: string) => void;
		/** Inline rename committed on a session row (dblclick the title). */
		onRenameSession: (id: string, title: string) => void;
		/** Right-click on a session row: the page opens the chrome popover. */
		onSessionMenu: (id: string, ev: MouseEvent) => void;
		onHistory: (p: Project) => void;
		/** Long-lived agents of the local jucode daemon (background service on). */
		agents?: AgentView[];
		agentsStatus?: 'off' | 'connecting' | 'on' | 'unreachable';
		onOpenAgent?: (agent: AgentView) => void;
		onNewAgent?: () => void;
		onAgentPage?: (agent: AgentView) => void;
		/** Questions and pending actions waiting for the user. */
		pendingCount?: number;
		onDesk?: () => void;
	} = $props();

	// Which projects have their archived section expanded (collapsed by default).
	let showArchived = $state<Record<string, boolean>>({});
	// Bulk restore: the project whose archived list is in selection mode, and
	// the picked session ids.
	let selecting = $state('');
	let picked = $state<string[]>([]);
	function toggleSelecting(id: string) {
		selecting = selecting === id ? '' : id;
		picked = [];
	}
	function togglePick(id: string) {
		picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
	}
	function restorePicked() {
		for (const id of picked) onUnarchiveSession(id);
		selecting = '';
		picked = [];
	}
	// Collapsed project folders, and folders showing all of their sessions
	// instead of the first SHOW_LIMIT.
	let collapsed = $state<Record<string, boolean>>({});
	let showAll = $state<Record<string, boolean>>({});
	const SHOW_LIMIT = 6;
	const chats = $derived(projects.find((p) => p.chats));
	const codeProjects = $derived(projects.filter((p) => !p.chats));

	// Session filter: case-insensitive substring over session title + project
	// name; empty project groups are hidden while a query is set.
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let searchEl = $state<HTMLInputElement | null>(null);
	const query = $derived(searchQuery.trim().toLowerCase());
	function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) tick().then(() => searchEl?.focus());
		else searchQuery = '';
	}
	function searchKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			searchQuery = '';
			searchOpen = false;
		}
	}
	const sessionMatches = (p: Project, s: Project['sessions'][number]) =>
		!query || s.chat.title.toLowerCase().includes(query) || p.name.toLowerCase().includes(query);

	// Inline rename (dblclick a session title).
	let renaming = $state<string | null>(null);
	let renameVal = $state('');
	let renameEl = $state<HTMLInputElement | null>(null);
	function startRename(s: Project['sessions'][number]) {
		renaming = s.id;
		renameVal = s.chat.title;
		tick().then(() => renameEl?.select());
	}
	function commitRename() {
		if (renaming && renameVal.trim()) onRenameSession(renaming, renameVal);
		renaming = null;
	}
	function renameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renaming = null;
		}
	}

	// "New chat" starts where you are: in the project of the active session,
	// or as a chat when the active session is a chat (or nothing is open).
	function newHere() {
		const p = projects.find((pr) => pr.sessions.some((s) => s.id === activeId));
		if (p && !p.chats) onNewSession(p);
		else onNewChat();
	}
	// Width the content lays out at; kept while the panel closes.
	let openWidth = $state(292);
	$effect(() => {
		if (width > 0) openWidth = width;
	});
</script>

<aside class="sidebar" class:resizing class:closed={width === 0} style:width="{width}px">
<!-- The content keeps the open width while the panel animates, so it slides
     out of view instead of re-wrapping at every intermediate width. -->
<div class="sb-inner" style:width="{openWidth}px">
	<!-- Header: the wordmark, or the session filter in its place while searching. -->
	<div class="brand" data-tauri-drag-region>
		{#if searchOpen}
			<MagnifyingGlassIcon size={18} />
			<input
				class="filter"
				bind:this={searchEl}
				bind:value={searchQuery}
				placeholder={t('shell.searchSessions')}
				onkeydown={searchKey}
				onblur={() => !searchQuery && toggleSearch()}
			/>
			<button class="head-act" onclick={toggleSearch} aria-label={t('shell.closeSearch')} title={t('shell.closeSearch')}><XIcon size={18} /></button>
		{:else}
			<span class="word">JuCode</span>
			<button class="head-act" onclick={toggleSearch} aria-label={t('shell.searchSessions')} title={t('shell.searchSessions')}><MagnifyingGlassIcon size={18} /></button>
		{/if}
	</div>

	<nav class="primary">
		<button class="row" onclick={newHere}><NotePencilIcon size={18} /><span>{t('shell.newChat')}</span></button>
		{#if agentsStatus !== 'off'}
			<button class="row" onclick={onDesk}>
				<TrayIcon size={18} /><span>{t('shell.desk.title')}</span>
				{#if pendingCount > 0}<span class="count">{pendingCount}</span>{/if}
			</button>
		{/if}
	</nav>


	{#snippet sessRow(s: Project['sessions'][number], nested = false, selectable = false)}
		<button
			class="sess"
			class:nested
			class:on={!selectable && s.id === activeId}
			class:arch={s.archived}
			class:selectable
			aria-pressed={selectable ? picked.includes(s.id) : undefined}
			style:box-shadow={s.color ? `inset 2px 0 0 ${s.color}` : undefined}
			onclick={() => (selectable ? togglePick(s.id) : onSelect(s.id))}
			oncontextmenu={(e) => onSessionMenu(s.id, e)}
		>
			{#if selectable}
				<span class="pick" class:on={picked.includes(s.id)} aria-hidden="true">
					{#if picked.includes(s.id)}<CheckIcon size={12} weight="bold" />{/if}
				</span>
			{/if}
			{#if s.icon}
				<TabGlyph icon={s.icon} color={s.color} size={14} />
			{/if}
			{#if renaming === s.id}
				<!-- svelte-ignore a11y_no_static_element_interactions (keep row clicks out of the editor) -->
				<input
					class="sess-edit"
					bind:this={renameEl}
					bind:value={renameVal}
					onblur={commitRename}
					onkeydown={renameKey}
					onclick={(e) => e.stopPropagation()}
					ondblclick={(e) => e.stopPropagation()}
				/>
			{:else}
				<span class="sess-title" ondblclick={(e) => { e.stopPropagation(); startRename(s); }} role="presentation">{s.chat.title}</span>
			{/if}
			<!-- A draft belongs to no backend until its first message. -->
			{#if s.backendId && s.backendId !== 'jucode' && !s.draft}
				<span class="backend-chip" title={BACKEND_LABELS[s.backendId]}><BackendIcon backend={s.backendId} size={12} /></span>
			{/if}
			{#if s.chat.pendingApproval || s.chat.trustPrompt}
				<span class="tag" title={t('shell.awaitConfirm')}>{t('shell.awaitShort')}</span>
			{:else if s.chat.busy}
				<CircleNotchIcon size={16} class="spin state" />
			{:else if s.chat.engineState === 'exited'}
				<span class="state err"><WarningCircleIcon size={16} /></span>
			{:else if s.chat.unseen}
				<!-- A reply arrived while this session was not in view: the one place a dot is used. -->
				<span class="unread" aria-label={t('shell.unread')}></span>
			{/if}
			{#if !selectable}
			<span
				class="act"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					s.archived ? onUnarchiveSession(s.id) : onArchiveSession(s.id);
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), s.archived ? onUnarchiveSession(s.id) : onArchiveSession(s.id))}
				aria-label={s.archived ? 'unarchive' : 'archive'}
				title={s.archived ? t('shell.unarchive') : t('shell.archive')}
			>
				{#if s.archived}<BoxArrowUpIcon size={16} />{:else}<ArchiveIcon size={16} />{/if}
			</span>
			<span
				class="act"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					onCloseSession(s.id);
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onCloseSession(s.id))}
				aria-label="close"><XIcon size={16} /></span
			>
			{/if}
		</button>
	{/snippet}

	{#snippet archived(p: Project, arch: Project['sessions'], nested: boolean)}
		{#if arch.length}
			{@const open = showArchived[p.id] || !!query}
			{@const sel = selecting === p.id && open}
			<div class="more-line" class:nested>
				<button class="more" onclick={() => (showArchived[p.id] = !showArchived[p.id])}>
					<span class="chev" class:open={showArchived[p.id]}><CaretRightIcon size={16} /></span>
					<span>{t('shell.archived')} · {arch.length}</span>
				</button>
				{#if open && arch.length > 1}
					<button class="more-act" onclick={() => toggleSelecting(p.id)}>
						{sel ? t('shell.archiveSelectCancel') : t('shell.archiveSelect')}
					</button>
				{/if}
			</div>
			{#if open}
				{#each arch as s (s.id)}{@render sessRow(s, nested, sel)}{/each}
				{#if sel}
					{@const all = arch.every((s) => picked.includes(s.id))}
					<div class="bulk" class:nested>
						<button class="more-act" onclick={() => (picked = all ? [] : arch.map((s) => s.id))}>
							{all ? t('shell.archiveSelectNone') : t('shell.archiveSelectAll')}
						</button>
						<span class="grow"></span>
						<Button size="sm" variant="primary" disabled={!picked.length} onclick={restorePicked}>
							{t('shell.archiveRestore', { n: picked.length })}
						</Button>
					</div>
				{/if}
			{/if}
		{/if}
	{/snippet}

	<div class="list">
		<!-- Agents: long-lived workers of the local daemon. -->
		<section>
			<div class="head">
				<span>{t('shell.agents.title')}</span>
				<button class="head-act" onclick={onNewAgent} aria-label={t('shell.agents.add')} title={t('shell.agents.add')}><PlusIcon size={16} /></button>
			</div>
			{#if agentsStatus === 'unreachable'}
				<div class="note">{t('shell.agents.unreachable')}</div>
			{:else if agentsStatus === 'off' || agents.length === 0}
				<button class="sess ghost" onclick={onNewAgent}><PlusIcon size={16} /><span class="sess-title">{t('shell.agents.add')}</span></button>
			{/if}
			{#each agents as a (a.id)}
				<button class="sess agent" onclick={() => onOpenAgent(a)} title={t('shell.agents.open', { name: a.name })}>
					<RobotIcon size={18} />
					<span class="agent-text">
						<span class="sess-title">{a.name}</span>
						{#if a.summary}<span class="agent-summary">{a.summary}</span>{/if}
					</span>
					{#if a.busy}<CircleNotchIcon size={16} class="spin state" />{/if}
					<span
						class="act"
						role="button"
						tabindex="0"
						onclick={(e) => {
							e.stopPropagation();
							onAgentPage(a);
						}}
						onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onAgentPage(a))}
						aria-label={t('shell.agents.details')}
						title={t('shell.agents.details')}><IdentificationCardIcon size={16} /></span
					>
				</button>
			{/each}
		</section>

		<!-- Chats: conversations without a project. -->
		{#if chats}
			{@const active = chats.sessions.filter((s) => !s.archived && sessionMatches(chats, s))}
			{@const arch = chats.sessions.filter((s) => s.archived && sessionMatches(chats, s))}
			{#if !query || active.length || arch.length}
				<section>
					<div class="head">
						<span>{chats.name}</span>
						<button class="head-act" onclick={() => onHistory(chats)} aria-label="history" title={t('shell.history')}><ClockCounterClockwiseIcon size={16} /></button>
						<button class="head-act" onclick={onNewChat} aria-label={t('shell.newChat')} title={t('shell.newChat')}><PlusIcon size={16} /></button>
					</div>
					{#each showAll[chats.id] || query ? active : active.slice(0, SHOW_LIMIT) as s (s.id)}{@render sessRow(s)}{/each}
					{#if active.length > SHOW_LIMIT && !query}
						<button class="more" onclick={() => (showAll[chats.id] = !showAll[chats.id])}>{showAll[chats.id] ? t('shell.showLess') : t('shell.showMore')}</button>
					{/if}
					{@render archived(chats, arch, false)}
				</section>
			{/if}
		{/if}

		<!-- Projects: folders with their coding sessions nested. -->
		<section>
			<div class="head">
				<span>{t('shell.projects')}</span>
				<button class="head-act" onclick={onNewProject} aria-label="new project" title={t('shell.newProjectTitle')}><PlusIcon size={16} /></button>
			</div>
			{#each codeProjects as p (p.id)}
				{@const active = p.sessions.filter((s) => !s.archived && sessionMatches(p, s))}
				{@const arch = p.sessions.filter((s) => s.archived && sessionMatches(p, s))}
				{@const open = !collapsed[p.id] || !!query}
				{@const w = p.sessions.some((s) => s.id === activeId) ? 'fill' : 'regular'}
				{#if !query || active.length || arch.length}
					<div class="folder" class:stale={p.stale}>
						<button class="folder-row" onclick={() => (collapsed[p.id] = !collapsed[p.id])} title={p.worktree ? t('shell.task.worktreeTip', { branch: p.worktree.branch, base: p.worktree.baseBranch || '?' }) : p.path}>
							{#if p.worktree}<GitBranchIcon size={18} weight={w} />{:else if open}<FolderOpenIcon size={18} weight={w} />{:else}<FolderIcon size={18} weight={w} />{/if}
							<span class="folder-name">{p.name}</span>
						</button>
						{#if p.stale}
							<span class="tag" title={p.path}>{t('shell.task.stale')}</span>
						{:else}
							<button class="act" onclick={() => onHistory(p)} aria-label="history" title={t('shell.history')}><ClockCounterClockwiseIcon size={16} /></button>
							{#if !p.worktree}
								<button class="act" onclick={() => onNewTask(p)} aria-label="new parallel task" title={t('shell.newTask')}><GitForkIcon size={16} /></button>
							{/if}
							<button class="act" onclick={() => onNewSession(p)} aria-label="new session" title={t('shell.newSessionInProject')}><PlusIcon size={16} /></button>
						{/if}
						{#if codeProjects.length > 1 || p.stale}
							<button class="act" class:always={p.stale} onclick={() => onCloseProject(p)} aria-label="close project" title={p.stale ? t('shell.task.staleRemove') : t('shell.closeProject')}><XIcon size={16} /></button>
						{/if}
					</div>
					{#if open}
						{#each showAll[p.id] || query ? active : active.slice(0, SHOW_LIMIT) as s (s.id)}{@render sessRow(s, true)}{/each}
						{#if active.length > SHOW_LIMIT && !query}
							<button class="more nested" onclick={() => (showAll[p.id] = !showAll[p.id])}>{showAll[p.id] ? t('shell.showLess') : t('shell.showMore')}</button>
						{/if}
						{#if active.length === 0 && arch.length === 0 && !p.stale && !query}
							<button class="sess ghost nested" onclick={() => onNewSession(p)}><span class="sess-title">{t('shell.newChat')}</span></button>
						{/if}
						{@render archived(p, arch, true)}
					{/if}
				{/if}
			{/each}
		</section>
	</div>

</div>
</aside>

<style>
	.sidebar {
		flex-shrink: 0;
		display: flex;
		background: var(--sidebar);
		min-width: 0;
		overflow: hidden;
		transition: width var(--t-med) var(--ease-out);
	}
	.sb-inner {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		min-height: 0;
		transition: opacity var(--t-med) var(--ease-out);
	}
	.sidebar.closed .sb-inner {
		opacity: 0;
	}
	.sidebar.resizing {
		transition: none;
	}
	/* Under macOS vibrancy the sidebar becomes translucent so the native frost
	 * shows through; everywhere else it stays fully opaque. */
	:global(:root[data-vibrancy='on']) .sidebar {
		background: var(--vibrancy-tint);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 40px;
		margin: 14px 12px 10px;
		padding: 0 4px 0 10px;
		flex-shrink: 0;
	}
	.brand > :global(svg) {
		color: var(--dim);
		flex-shrink: 0;
	}
	.filter {
		flex: 1;
		min-width: 0;
		height: 28px;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.word {
		flex: 1;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 700;
		letter-spacing: -0.005em;
		color: var(--text);
	}
	.primary {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 10px 8px;
	}
	.row,
	.sess,
	.more,
	.folder-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 38px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.row :global(svg),
	.sess > :global(svg),
	.folder-row :global(svg) {
		color: var(--dim);
		flex-shrink: 0;
	}
	.row:hover,
	.sess:hover,
	.more:hover,
	.folder-row:hover {
		background: var(--surface2);
	}
	.row span:first-of-type {
		flex: 1;
	}
	.count {
		flex: none !important;
		min-width: 20px;
		padding: 1px 7px;
		border-radius: var(--r-full);
		background: var(--accent);
		color: var(--on-accent);
		font-size: var(--fs-2xs);
		font-weight: 600;
		text-align: center;
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 10px 12px;
	}
	section + section {
		margin-top: 22px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 32px;
		padding: 0 4px 0 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.head span {
		flex: 1;
	}
	.head-act,
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.head-act:hover,
	.act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	/* Row actions appear on hover / keyboard focus only. */
	.sess .act,
	.folder .act {
		display: none;
	}
	.sess:hover .act,
	.sess:focus-within .act,
	.folder:hover .act,
	.folder .act.always {
		display: inline-flex;
	}

	.sess.on {
		background: var(--surface2);
	}
	.sess.nested {
		padding-left: 42px;
	}
	.more-line {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.more-line .more {
		flex: 1;
		min-width: 0;
	}
	.more-act {
		flex-shrink: 0;
		padding: 4px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.more-act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.bulk {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px 8px 12px;
		animation: rise var(--t-fast) var(--ease-out);
	}
	.bulk.nested {
		padding-left: 28px;
	}
	.grow {
		flex: 1;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		background: var(--surface);
		color: var(--on-accent);
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.pick.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.sess.arch .sess-title {
		color: var(--dim2);
	}
	.sess.ghost {
		color: var(--dim2);
	}
	.sess-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess-edit {
		flex: 1;
		min-width: 0;
		height: 24px;
		padding: 0 6px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.sess :global(.state) {
		color: var(--dim);
		flex-shrink: 0;
	}
	.state.err {
		display: inline-flex;
		color: var(--err);
	}
	.unread {
		width: 7px;
		height: 7px;
		margin: 0 4px;
		border-radius: 50%;
		background: var(--text);
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
	.backend-chip {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}

	.agent-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.agent-summary {
		color: var(--dim2);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.note {
		padding: 6px 10px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}

	.folder {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: var(--r-sm);
	}
	.folder:hover {
		background: var(--surface);
	}
	.folder-row {
		flex: 1;
		min-width: 0;
	}
	.folder-row:hover {
		background: none;
	}
	.folder.stale .folder-name {
		color: var(--dim2);
	}
	.folder-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.more {
		min-height: 30px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.more-line.nested .more {
		padding-left: 42px;
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}

</style>
