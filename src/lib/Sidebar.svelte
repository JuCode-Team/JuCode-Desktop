<script lang="ts">
	import { tick } from 'svelte';
	import { Plus, History, X, LoaderCircle, GitBranch, GitBranchPlus, Archive, ArchiveRestore, ChevronRight, Search, Settings, Inbox, IdCard, SquarePen, SquareTerminal, Bot, Folder, FolderOpen, MessagesSquare, CircleAlert } from 'lucide-svelte';
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
		loggedIn,
		providerName,
		updateAvailable = false,
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
		onSettings,
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
		loggedIn: boolean;
		providerName: string;
		updateAvailable?: boolean;
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
		onSettings: () => void;
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

	// "New session" targets the active session's project (fallback: first project);
	// with no project open it falls through to the new-project flow.
	function newSessionHere() {
		const p = projects.find((pr) => pr.sessions.some((s) => s.id === activeId)) ?? projects[0];
		if (p) onNewSession(p);
		else onNewProject();
	}
</script>

<aside class="sidebar" class:resizing style:width="{width}px">
	<div class="brand" data-tauri-drag-region>
		<span class="word">JuCode</span>
	</div>

	<nav class="primary">
		<button class="row" onclick={onNewChat}><SquarePen size={16} strokeWidth={1.5} /><span>{t('shell.newChat')}</span></button>
		<button class="row" onclick={newSessionHere}><SquareTerminal size={16} strokeWidth={1.5} /><span>{t('shell.agentSession')}</span></button>
		<button class="row" class:on={searchOpen} onclick={toggleSearch}><Search size={16} strokeWidth={1.5} /><span>{t('shell.searchSessions')}</span></button>
		{#if agentsStatus !== 'off'}
			<button class="row" onclick={onDesk}>
				<Inbox size={16} strokeWidth={1.5} /><span>{t('shell.desk.title')}</span>
				{#if pendingCount > 0}<span class="count">{pendingCount}</span>{/if}
			</button>
		{/if}
	</nav>

	{#if searchOpen}
		<div class="search">
			<input bind:this={searchEl} bind:value={searchQuery} placeholder={t('shell.searchSessions')} onkeydown={searchKey} />
		</div>
	{/if}

	{#snippet sessRow(s: Project['sessions'][number], nested = false)}
		<button
			class="sess"
			class:nested
			class:on={s.id === activeId}
			class:arch={s.archived}
			style:box-shadow={s.color ? `inset 2px 0 0 ${s.color}` : undefined}
			onclick={() => onSelect(s.id)}
			oncontextmenu={(e) => onSessionMenu(s.id, e)}
		>
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
			{#if s.backendId && s.backendId !== 'jucode'}
				<span class="backend-chip" title={BACKEND_LABELS[s.backendId]}><BackendIcon backend={s.backendId} size={12} /></span>
			{/if}
			{#if s.chat.pendingApproval || s.chat.trustPrompt}
				<span class="tag" title={t('shell.awaitConfirm')}>{t('shell.awaitShort')}</span>
			{:else if s.chat.busy}
				<LoaderCircle size={14} strokeWidth={1.5} class="spin state" />
			{:else if s.chat.engineState === 'exited'}
				<span class="state err"><CircleAlert size={14} strokeWidth={1.5} /></span>
			{:else if s.chat.unseen}
				<!-- A reply arrived while this session was not in view: the one place a dot is used. -->
				<span class="unread" aria-label={t('shell.unread')}></span>
			{/if}
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
				{#if s.archived}<ArchiveRestore size={14} strokeWidth={1.5} />{:else}<Archive size={14} strokeWidth={1.5} />{/if}
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
				aria-label="close"><X size={14} strokeWidth={1.5} /></span
			>
		</button>
	{/snippet}

	{#snippet archived(p: Project, arch: Project['sessions'], nested: boolean)}
		{#if arch.length}
			<button class="more" class:nested onclick={() => (showArchived[p.id] = !showArchived[p.id])}>
				<span class="chev" class:open={showArchived[p.id]}><ChevronRight size={14} strokeWidth={1.5} /></span>
				<span>{t('shell.archived')} · {arch.length}</span>
			</button>
			{#if showArchived[p.id] || query}
				{#each arch as s (s.id)}{@render sessRow(s, nested)}{/each}
			{/if}
		{/if}
	{/snippet}

	<div class="list">
		<!-- Agents: long-lived workers of the local daemon. -->
		<section>
			<div class="head">
				<span>{t('shell.agents.title')}</span>
				<button class="head-act" onclick={onNewAgent} aria-label={t('shell.agents.add')} title={t('shell.agents.add')}><Plus size={14} strokeWidth={1.5} /></button>
			</div>
			{#if agentsStatus === 'unreachable'}
				<div class="note">{t('shell.agents.unreachable')}</div>
			{:else if agentsStatus === 'off' || agents.length === 0}
				<button class="sess ghost" onclick={onNewAgent}><Plus size={14} strokeWidth={1.5} /><span class="sess-title">{t('shell.agents.add')}</span></button>
			{/if}
			{#each agents as a (a.id)}
				<button class="sess agent" onclick={() => onOpenAgent(a)} title={t('shell.agents.open', { name: a.name })}>
					<Bot size={16} strokeWidth={1.5} />
					<span class="agent-text">
						<span class="sess-title">{a.name}</span>
						{#if a.summary}<span class="agent-summary">{a.summary}</span>{/if}
					</span>
					{#if a.busy}<LoaderCircle size={14} strokeWidth={1.5} class="spin state" />{/if}
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
						title={t('shell.agents.details')}><IdCard size={14} strokeWidth={1.5} /></span
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
						<button class="head-act" onclick={() => onHistory(chats)} aria-label="history" title={t('shell.history')}><History size={14} strokeWidth={1.5} /></button>
						<button class="head-act" onclick={onNewChat} aria-label={t('shell.newChat')} title={t('shell.newChat')}><Plus size={14} strokeWidth={1.5} /></button>
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
				<button class="head-act" onclick={onNewProject} aria-label="new project" title={t('shell.newProjectTitle')}><Plus size={14} strokeWidth={1.5} /></button>
			</div>
			{#each codeProjects as p (p.id)}
				{@const active = p.sessions.filter((s) => !s.archived && sessionMatches(p, s))}
				{@const arch = p.sessions.filter((s) => s.archived && sessionMatches(p, s))}
				{@const open = !collapsed[p.id] || !!query}
				{#if !query || active.length || arch.length}
					<div class="folder" class:stale={p.stale}>
						<button class="folder-row" onclick={() => (collapsed[p.id] = !collapsed[p.id])} title={p.worktree ? t('shell.task.worktreeTip', { branch: p.worktree.branch, base: p.worktree.baseBranch || '?' }) : p.path}>
							{#if p.worktree}<GitBranch size={16} strokeWidth={1.5} />{:else if open}<FolderOpen size={16} strokeWidth={1.5} />{:else}<Folder size={16} strokeWidth={1.5} />{/if}
							<span class="folder-name">{p.name}</span>
						</button>
						{#if p.stale}
							<span class="tag" title={p.path}>{t('shell.task.stale')}</span>
						{:else}
							<button class="act" onclick={() => onHistory(p)} aria-label="history" title={t('shell.history')}><History size={14} strokeWidth={1.5} /></button>
							{#if !p.worktree}
								<button class="act" onclick={() => onNewTask(p)} aria-label="new parallel task" title={t('shell.newTask')}><GitBranchPlus size={14} strokeWidth={1.5} /></button>
							{/if}
							<button class="act" onclick={() => onNewSession(p)} aria-label="new session" title={t('shell.newSessionInProject')}><Plus size={14} strokeWidth={1.5} /></button>
						{/if}
						{#if codeProjects.length > 1 || p.stale}
							<button class="act" class:always={p.stale} onclick={() => onCloseProject(p)} aria-label="close project" title={p.stale ? t('shell.task.staleRemove') : t('shell.closeProject')}><X size={14} strokeWidth={1.5} /></button>
						{/if}
					</div>
					{#if open}
						{#each showAll[p.id] || query ? active : active.slice(0, SHOW_LIMIT) as s (s.id)}{@render sessRow(s, true)}{/each}
						{#if active.length > SHOW_LIMIT && !query}
							<button class="more nested" onclick={() => (showAll[p.id] = !showAll[p.id])}>{showAll[p.id] ? t('shell.showLess') : t('shell.showMore')}</button>
						{/if}
						{#if active.length === 0 && arch.length === 0 && !p.stale && !query}
							<button class="sess ghost nested" onclick={() => onNewSession(p)}><span class="sess-title">{t('shell.agentSession')}</span></button>
						{/if}
						{@render archived(p, arch, true)}
					{/if}
				{/if}
			{/each}
		</section>
	</div>

	<button class="account" onclick={onSettings} title={t('shell.accountSettings')}>
		<span class="acc-name">{loggedIn ? providerName : t('shell.notLoggedIn')}</span>
		{#if updateAvailable}<span class="tag">{t('shell.updateShort')}</span>{/if}
		<Settings size={16} strokeWidth={1.5} />
	</button>
</aside>

<style>
	.sidebar {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--sidebar);
		min-width: 0;
		overflow: hidden;
		transition: width var(--t-med) var(--ease-out);
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
		align-items: flex-end;
		height: 56px;
		padding: 0 20px 10px;
		flex-shrink: 0;
	}
	.word {
		font-family: var(--font-serif);
		font-size: var(--fs-lg);
		font-weight: 500;
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
		min-height: 34px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-sm);
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
	.row.on {
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
	.search {
		padding: 0 12px 8px;
	}
	.search input {
		width: 100%;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.search input:focus {
		border-color: var(--border-strong);
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 10px 12px;
	}
	section + section {
		margin-top: 18px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 28px;
		padding: 0 4px 0 10px;
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
		width: 26px;
		height: 26px;
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
		background: var(--bg);
		box-shadow: var(--shadow-sm);
	}
	.sess.nested {
		padding-left: 36px;
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
	.more.nested {
		padding-left: 36px;
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}

	.account {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 6px 10px 10px;
		min-height: 38px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.account:hover {
		background: var(--surface2);
	}
	.account :global(svg) {
		color: var(--dim);
	}
	.acc-name {
		flex: 1;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
