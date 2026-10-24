<script lang="ts">
	// The session list, as t3code lays it out: every project's sessions at once
	// (or one project's, picked in the filter), each a card with its project,
	// title, state and when it last moved; under them, two shelves that open:
	// the settled sessions (settled by hand when done, or on their own after a
	// few idle days, see sidebar/autoArchive.ts; stored as `archived`) and the
	// projects, each with all its sessions under it, settled ones too.
	// Deleting a session takes it out of the app only; its conversation stays.
	import { tick } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwClockIcon from '@lucide/svelte/icons/rotate-ccw-clock';
	import XIcon from '@lucide/svelte/icons/x';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import GitForkIcon from '@lucide/svelte/icons/git-fork';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SearchIcon from '@lucide/svelte/icons/search';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import { rowIn, rowOut } from '$lib/ui/motion';
	import Collapse from '$lib/ui/Collapse.svelte';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import { t } from '$lib/i18n';
	import { withShortcut } from '$lib/shortcuts';
	import { BACKEND_LABELS } from '$lib/backends';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import SessionMark from '$lib/SessionMark.svelte';
	import Elapsed from '$lib/agents/Elapsed.svelte';
	import DiffStat from '$lib/DiffStat.svelte';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import { cardInfo } from '$lib/sidebar/cardInfo';
	import ProjectBadge from '$lib/sidebar/ProjectBadge.svelte';
	import { sessionStatus } from '$lib/sessionStatus';
	import { ago } from '$lib/time';
	import { CHATS_ENABLED, type Project, type Session } from '$lib/types';
	import { railDrop } from '$lib/workbench/railDrop.svelte';
	import { prefs } from '$lib/prefs.svelte';

	let {
		projects,
		activeId,
		selectedId,
		width,
		resizing = false,
		onSelect,
		onOpenProject = () => {},
		openProject = null,
		onNewProject,
		onNewSession,
		onNewChat,
		onNewTask,
		onDeleteSession,
		onCloseProject,
		onSettleSession,
		onUnsettleSession,
		onPinSession,
		onMoveProject,
		onMoveProjectToWorkspace,
		onRenameSession,
		onSessionMenu,
		onProjectMenu,
		onHistory,
		pendingCount = 0,
		onDesk = () => {},
		terminals = {},
		onOpenTerminal = () => {}
	}: {
		projects: Project[];
		activeId: string;
		/** The one session shown as selected: the one in front ('' when a
		 *  project page is). */
		selectedId: string;
		width: number;
		/** True while the user drags the resizer — disables the width transition. */
		resizing?: boolean;
		onSelect: (id: string) => void;
		/** A project row clicked: its page. */
		onOpenProject?: (p: Project) => void;
		/** The project whose page is shown. */
		openProject?: string | null;
		onNewProject: () => void;
		onNewSession: (p: Project) => void;
		onNewChat: () => void;
		onNewTask: (p: Project) => void;
		/** Takes a session out of the app (its conversation stays). */
		onDeleteSession: (id: string) => void;
		onCloseProject: (p: Project) => void;
		/** Done with it: off the cards, still under its project. */
		onSettleSession: (id: string) => void;
		onUnsettleSession: (id: string) => void;
		onPinSession: (id: string, pinned: boolean) => void;
		/** A project and its sessions dropped before or after another project. */
		onMoveProject: (id: string, target: string, after: boolean) => void;
		/** A project dropped on another workspace in the rail. */
		onMoveProjectToWorkspace: (id: string, workspace: string) => void;
		/** Inline rename committed on a session (dblclick the title). */
		onRenameSession: (id: string, title: string) => void;
		/** Right-click on a session: the page opens the chrome popover. */
		onSessionMenu: (id: string, ev: MouseEvent) => void;
		/** Right-click on a project folder: the page opens the chrome popover. */
		onProjectMenu: (p: Project, ev: MouseEvent) => void;
		onHistory: (p: Project) => void;
		/** Approvals waiting for the user. */
		pendingCount?: number;
		/** Opens the workbench. */
		onDesk?: () => void;
		/** Per session, its terminals running a command (terminals.svelte). */
		terminals?: Record<string, { count: number; tab: string }>;
		/** The terminal mark clicked: that session's terminal. */
		onOpenTerminal?: (id: string) => void;
	} = $props();

	const codeProjects = $derived(projects.filter((p) => !p.chats && !p.loose));

	// The project filter: every project's sessions (''), or one project's.
	// Kept across restarts; a project that went away shows them all again.
	const SCOPE_KEY = 'jucode-sidebar-scope';
	let scopeId = $state(localStorage.getItem(SCOPE_KEY) ?? '');
	const scope = $derived(codeProjects.find((p) => p.id === scopeId));
	let scopeMenu = $state<{ x: number; y: number } | null>(null);
	function toggleScopeMenu(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		scopeMenu = scopeMenu ? null : { x: r.left, y: r.bottom };
	}
	const scopeItems = $derived<PopMenuItem[]>([
		{ key: '', label: t('shell.sidebar.allProjects'), icon: LayersIcon, checked: !scope },
		...codeProjects.map((p) => ({ key: p.id, label: p.name, checked: scope?.id === p.id }))
	]);
	function pickScope(id: string) {
		scopeId = id;
		localStorage.setItem(SCOPE_KEY, id);
		scopeMenu = null;
	}

	// Session filter: case-insensitive substring over session title + project name.
	let searchQuery = $state('');
	let searchEl = $state<HTMLInputElement | null>(null);
	const query = $derived(searchQuery.trim().toLowerCase());
	/** ⌘K: into the filter, its text selected. */
	export function focusSearch() {
		tick().then(() => searchEl?.select());
	}
	function searchKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			searchQuery = '';
			searchEl?.blur();
		}
	}
	const matches = (p: Project, s: Session) => !query || s.chat.title.toLowerCase().includes(query) || p.name.toLowerCase().includes(query);

	const recency = (s: Session) => Math.max(s.updatedAt ?? 0, s.keptAt ?? 0);
	/** Sessions in the filter's projects, with their project, the latest first. */
	function sessionsWhere(keep: (s: Session) => boolean): { s: Session; p: Project }[] {
		return projects
			.filter((p) => !scope || p === scope)
			.flatMap((p) => p.sessions.filter((s) => keep(s) && matches(p, s)).map((s) => ({ s, p })))
			.sort((a, b) => recency(b.s) - recency(a.s));
	}
	/** The cards: what is not settled, pinned first. */
	const cards = $derived(sessionsWhere((s) => !s.archived).sort((a, b) => Number(!!b.s.pinned) - Number(!!a.s.pinned)));
	const settled = $derived(sessionsWhere((s) => !!s.archived));

	// The shelves, open or not across restarts.
	const SHELVES_KEY = 'jucode-sidebar-shelves';
	let shelves = $state<{ settled?: boolean; projects?: boolean }>(
		(() => {
			try {
				return JSON.parse(localStorage.getItem(SHELVES_KEY) ?? '{}') ?? {};
			} catch {
				return {};
			}
		})()
	);
	function toggleShelf(key: 'settled' | 'projects') {
		shelves[key] = !shelves[key];
		localStorage.setItem(SHELVES_KEY, JSON.stringify(shelves));
	}
	// Each shelf shows a page at a time (and scrolls within its own height):
	// settled sessions, projects, and the sessions of each project.
	const PAGE = 10;
	const PROJECT_PAGE = 8;
	const SESSION_PAGE = 6;
	let settledShown = $state(PAGE);
	let projectsShown = $state(PROJECT_PAGE);
	let sessionsShown = $state<Record<string, number>>({});
	// A new search starts from the first page again.
	$effect(() => {
		void query;
		settledShown = PAGE;
		projectsShown = PROJECT_PAGE;
		sessionsShown = {};
	});
	/** The projects shelf: while searching, the projects whose name or a
	 *  session matches. */
	const shelfProjects = $derived(query ? codeProjects.filter((p) => p.name.toLowerCase().includes(query) || p.sessions.some((s) => matches(p, s))) : codeProjects);
	const projectsOpen = $derived(!!shelves.projects || (!!query && shelfProjects.length > 0));

	// Projects open in the projects shelf (closed by default; kept across
	// restarts), and those showing every session instead of the first few.
	const EXPANDED_KEY = 'jucode-sidebar-expanded';
	let expanded = $state<Record<string, boolean>>(
		(() => {
			try {
				return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') ?? {};
			} catch {
				return {};
			}
		})()
	);
	function toggleExpanded(id: string) {
		if (expanded[id]) delete expanded[id];
		else expanded[id] = true;
		localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
	}

	// Inline rename (dblclick a session title).
	let renaming = $state<string | null>(null);
	let renameVal = $state('');
	let renameEl = $state<HTMLInputElement | null>(null);
	function startRename(s: Session) {
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

	// "New session" starts where you are: in the filtered project, else in
	// the project of the active session, else in the first project (or asks
	// for one).
	function newHere() {
		const owner = projects.find((pr) => pr.sessions.some((s) => s.id === activeId));
		const p = scope ?? (owner && !owner.chats ? owner : undefined) ?? codeProjects.find((pr) => !pr.stale);
		if (p) onNewSession(p);
		else if (CHATS_ENABLED) onNewChat();
		else onNewProject();
	}

	// Drag a project in the projects shelf: to reorder it, or onto another
	// workspace in the rail. Pointer events (HTML drag and drop is not reliable
	// in the macOS webview): a press stays a click until the pointer travels,
	// then the row follows it and the others slide aside to show where it lands.
	let listEl = $state<HTMLElement | null>(null);
	let drag = $state<{ id: string; live: boolean; dy: number; from: number; at: number; size: number; others: string[] } | null>(null);
	function projectDown(e: PointerEvent, p: Project) {
		if (e.button !== 0 || !listEl) return;
		const list = listEl;
		const id = p.id;
		const startX = e.clientX;
		const startY = e.clientY;
		let y = startY;
		let frame = 0;
		let centres: number[] = [];
		let startScroll = 0;
		drag = { id, live: false, dy: 0, from: 0, at: 0, size: 0, others: [] };
		const begin = () => {
			const rows = [...list.querySelectorAll<HTMLElement>('[data-project-row]')];
			const rects = rows.map((el) => el.getBoundingClientRect());
			const from = rows.findIndex((el) => el.dataset.projectRow === id);
			if (!drag || from < 0) return false;
			const next = rects[from + 1] ?? null;
			const prev = rects[from - 1] ?? null;
			const size = next ? next.top - rects[from]!.top : prev ? rects[from]!.bottom - prev.bottom : rects[from]!.height;
			const others = rows.filter((_, i) => i !== from);
			centres = rects.filter((_, i) => i !== from).map((r) => r.top + r.height / 2);
			startScroll = list.scrollTop;
			Object.assign(drag, { live: true, from, at: from, size, others: others.map((el) => el.dataset.projectRow!) });
			return true;
		};
		const update = () => {
			if (!drag?.live) return;
			const scrolled = list.scrollTop - startScroll;
			drag.dy = y - startY + scrolled;
			drag.at = centres.filter((c) => c < y + scrolled).length;
		};
		const scroll = () => {
			const r = list.getBoundingClientRect();
			const step = y < r.top + 32 ? -8 : y > r.bottom - 32 ? 8 : 0;
			if (step) {
				list.scrollTop += step;
				update();
			}
			frame = requestAnimationFrame(scroll);
		};
		const noSelect = (ev: Event) => ev.preventDefault();
		const move = (ev: PointerEvent) => {
			y = ev.clientY;
			if (!drag?.live) {
				if (!drag || Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5 || !begin()) return;
				frame = requestAnimationFrame(scroll);
			}
			update();
			railDrop.id = railTarget(ev);
		};
		const end = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', end);
			window.removeEventListener('selectstart', noSelect);
			cancelAnimationFrame(frame);
			const d = drag;
			const ws = railDrop.id;
			drag = null;
			railDrop.id = null;
			if (!d?.live) return;
			// The release ends the drag; it does not open the row.
			const swallow = (c: Event) => c.stopPropagation();
			window.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
			if (ev.type === 'pointerup' && ws) return onMoveProjectToWorkspace(id, ws);
			if (ev.type !== 'pointerup' || d.at === d.from || !d.others.length) return;
			const to = d.at < d.others.length ? { id: d.others[d.at]!, after: false } : { id: d.others[d.others.length - 1]!, after: true };
			onMoveProject(id, to.id, to.after);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
		window.addEventListener('selectstart', noSelect);
	}
	/** The workspace in the rail under the pointer, other than this one. */
	function railTarget(ev: PointerEvent): string | null {
		const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-ws-id]');
		return el && el.getAttribute('aria-selected') !== 'true' ? (el.dataset.wsId ?? null) : null;
	}
	function shiftStyle(id: string) {
		if (!drag?.live) return undefined;
		if (id === drag.id) return `translateY(${drag.dy}px)`;
		const k = drag.others.indexOf(id);
		const dy = k >= drag.from && k < drag.at ? -drag.size : k >= drag.at && k < drag.from ? drag.size : 0;
		return dy ? `translateY(${dy}px)` : undefined;
	}

	// The cards' times move on once a minute.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(id);
	});

	// Width the content lays out at; kept while the panel closes.
	let openWidth = $state(292);
	$effect(() => {
		if (width > 0) openWidth = width;
	});
</script>

{#snippet title(s: Session, status: ReturnType<typeof sessionStatus>)}
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
		<span
			class="sess-title"
			class:running={status?.kind === 'running'}
			class:unread={status?.kind === 'unread'}
			ondblclick={(e) => {
				e.stopPropagation();
				startRename(s);
			}}
			role="presentation">{s.draft ? t('shell.sidebar.newSession') : s.chat.title || t('shell.untitled')}</span
		>
	{/if}
{/snippet}

<!-- What a session is doing: working (for how long, this turn), waiting on
     the user, failed; else when it last moved (with the unread dot). -->
{#snippet state(s: Session, status: ReturnType<typeof sessionStatus>)}
	{#if status}<SessionMark {status} />{/if}
	{#if status?.kind === 'running' && s.chat.busy && s.chat.turnStartedAt > 0}
		<Elapsed row={{ state: 'running', startedAt: s.chat.turnStartedAt, durationMs: 0, endedAt: 0 }} />
	{:else if status?.kind !== 'input' && status?.kind !== 'running' && s.updatedAt}
		<span class="when">{ago(recency(s), now)}</span>
	{/if}
{/snippet}

{#snippet action(label: string, run: () => void, icon: typeof XIcon)}
	{@const Icon = icon}
	<span
		class="act"
		role="button"
		tabindex="0"
		onclick={(e) => {
			e.stopPropagation();
			run();
		}}
		onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), run())}
		aria-label={label}
		title={label}><Icon size={14} /></span
	>
{/snippet}

<!-- A session as a card: project, state or time; title; where it works. -->
{#snippet card(s: Session, p: Project)}
	{@const status = sessionStatus(s.chat)}
	{@const info = cardInfo(s.chat)}
	{@const tree = s.worktree ?? p.worktree}
	{@const term = terminals[s.id]?.count ?? 0}
	<button
		in:rowIn
		out:rowOut
		class="card"
		class:on={s.id === selectedId}
		data-sid={s.id}
		onclick={() => onSelect(s.id)}
		oncontextmenu={(e) => onSessionMenu(s.id, e)}
	>
		<span class="line top">
			<ProjectBadge project={p} size={16} />
			<span class="proj">{p.name}</span>
			{#if s.pinned}<span class="mark" title={t('shell.pin')}><PinIcon size={11} fill="currentColor" /></span>{/if}
			<span class="right">
				<span class="idle">{@render state(s, status)}</span>
				<span class="acts">
					{@render action(s.pinned ? t('shell.unpin') : t('shell.pin'), () => onPinSession(s.id, !s.pinned), s.pinned ? PinOffIcon : PinIcon)}
					{@render action(t('shell.sidebar.settle'), () => onSettleSession(s.id), CheckIcon)}
					{@render action(t('shell.sidebar.delete'), () => onDeleteSession(s.id), Trash2Icon)}
				</span>
			</span>
		</span>
		<span class="line">
			{#if s.icon}<TabGlyph icon={s.icon} color={s.color} size={14} />{:else if s.color}<span class="tag-dot" style:background={s.color}></span>{/if}
			{@render title(s, status)}
			<!-- A draft belongs to no backend until its first message. -->
			{#if prefs.sessionAgentIcon && s.backendId && !s.draft}
				<span class="backend-chip" title={BACKEND_LABELS[s.backendId]}><BackendIcon backend={s.backendId} agent={s.chat.acpAgentId} size={13} mono /></span>
			{/if}
		</span>
		{#if tree || s.forkedFrom || term || info.diff || info.plan || info.tasks || info.queued}
			<span class="line meta">
				<!-- A session in a worktree: which one (none for the main checkout). -->
				{#if tree}<span class="branch" title={t('shell.task.worktreeTip', { branch: tree.branch, base: tree.baseBranch || '?' })}><FolderGit2Icon size={12} /><span>{tree.slug}</span></span>{/if}
				{#if s.forkedFrom}<span class="mark" title={t('chat.fork.from', { title: s.forkedFrom.title })}><GitForkIcon size={12} /></span>{/if}
				<span class="info">
					{#if term}
						<span
							class="term"
							role="button"
							tabindex="0"
							title={t('shell.sidebar.terminals', { n: term })}
							aria-label={t('shell.sidebar.terminals', { n: term })}
							onclick={(e) => {
								e.stopPropagation();
								onOpenTerminal(s.id);
							}}
							onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onOpenTerminal(s.id))}><SquareTerminalIcon size={13} /></span
						>
					{/if}
					{#if info.plan}<span class="fact" title={t('shell.sidebar.plan', info.plan)}><ListChecksIcon size={12} />{info.plan.done}/{info.plan.total}</span>{/if}
					{#if info.tasks}<span class="fact" title={t('shell.sidebar.tasks', { n: info.tasks })}><NetworkIcon size={12} />{info.tasks}</span>{/if}
					{#if info.queued}<span class="fact" title={t('shell.sidebar.queued', { n: info.queued })}><ClockIcon size={12} />{info.queued}</span>{/if}
					{#if info.diff}<span title={t('shell.sidebar.diff')}><DiffStat {...info.diff} /></span>{/if}
				</span>
			</span>
		{/if}
	</button>
{/snippet}

<!-- A session as one slim row (settled, or under its project). -->
{#snippet row(s: Session, p: Project, nested: boolean)}
	{@const status = sessionStatus(s.chat)}
	<button
		in:rowIn
		out:rowOut
		class="sess"
		class:nested
		class:arch={s.archived}
		class:on={s.id === selectedId}
		data-sid={s.id}
		onclick={() => onSelect(s.id)}
		oncontextmenu={(e) => onSessionMenu(s.id, e)}
	>
		{#if !nested}<ProjectBadge project={p} size={14} />{/if}
		{@render title(s, status)}
		<span class="right">
			<span class="idle">{@render state(s, status)}</span>
			<span class="acts">
				{#if s.archived}
					{@render action(t('shell.sidebar.unsettle'), () => onUnsettleSession(s.id), Undo2Icon)}
				{:else}
					{@render action(t('shell.sidebar.settle'), () => onSettleSession(s.id), CheckIcon)}
				{/if}
				{@render action(t('shell.sidebar.delete'), () => onDeleteSession(s.id), Trash2Icon)}
			</span>
		</span>
	</button>
{/snippet}

<!-- "Load more": the next `step` of `left` rows not shown yet. -->
{#snippet more(left: number, step: number, onMore: () => void, nested = false)}
	{#if left > 0}
		<button class="more" class:nested onclick={onMore}>{t('shell.sidebar.showMore', { n: Math.min(step, left) })}</button>
	{/if}
{/snippet}

{#snippet shelfHead(key: 'settled' | 'projects', label: string, open: boolean)}
	<button class="shelf-head" onclick={() => toggleShelf(key)} aria-expanded={open}>
		<span>{label}</span>
		<span class="rule"></span>
		<span class="chev" class:open><ChevronDownIcon size={14} /></span>
	</button>
{/snippet}

<aside class="sidebar" class:resizing class:closed={width === 0} style:width="{width}px">
<!-- The content keeps the open width while the panel animates, so it slides
     out of view instead of re-wrapping at every intermediate width. -->
<div class="sb-inner" style:width="{openWidth}px">
	<div class="tools">
		<label class="search">
			<SearchIcon size={15} />
			<input
				class="filter"
				bind:this={searchEl}
				bind:value={searchQuery}
				placeholder={t('shell.searchSessions')}
				aria-label={t('shell.searchSessions')}
				title={withShortcut(t('shell.searchSessions'), 'searchSessions')}
				onkeydown={searchKey}
			/>
			{#if searchQuery}
				<button class="clear" onclick={() => ((searchQuery = ''), searchEl?.focus())} aria-label={t('shell.closeSearch')} title={t('shell.closeSearch')}><XIcon size={14} /></button>
			{/if}
		</label>
		<span class="anchor">
			<button class="tool" class:scoped={!!scope} onclick={toggleScopeMenu} aria-label={t('shell.sidebar.filter')} title={scope ? scope.name : t('shell.sidebar.filter')}>
				{#if scope}<ProjectBadge project={scope} size={16} />{:else}<ListFilterIcon size={16} />{/if}
			</button>
			{#if scopeMenu}
				<!-- Fixed at the button, so the sidebar (which clips what overflows
				     it) does not cut the menu off. -->
				<span class="menu-at" style:left="{scopeMenu.x}px" style:top="{scopeMenu.y}px">
					<PopMenu items={scopeItems} title={t('shell.sidebar.filter')} placement="down-left" onSelect={pickScope} onClose={() => (scopeMenu = null)} />
				</span>
			{/if}
		</span>
		<button class="tool" onclick={onNewProject} aria-label={t('shell.newProjectTitle')} title={t('shell.newProjectTitle')}><FolderPlusIcon size={16} /></button>
		<button class="tool" onclick={newHere} aria-label={t('shell.newChat')} title={withShortcut(t('shell.newChat'), 'newSession')}><SquarePenIcon size={16} /></button>
	</div>
	{#if pendingCount > 0}
		<nav class="primary">
			<button class="row" onclick={onDesk}>
				<InboxIcon size={16} /><span>{t('shell.desk.title')}</span>
				<span class="count">{pendingCount}</span>
			</button>
		</nav>
	{/if}

	<div class="list" class:dragging={drag?.live} bind:this={listEl}>
		<div class="cards">
			{#each cards as { s, p } (s.id)}{@render card(s, p)}{/each}
			{#if !cards.length}
				<p class="empty">{query ? t('shell.sidebar.noMatch') : t('shell.sidebar.empty')}</p>
			{/if}
		</div>

		<div class="shelves">
			{#if settled.length}
				{@const open = !!shelves.settled || !!query}
				{@render shelfHead('settled', open ? t('shell.sidebar.settled') : `${t('shell.sidebar.settled')} (${settled.length})`, open)}
				<Collapse {open}>
					<div class="shelf-body">
						{#each settled.slice(0, settledShown) as { s, p } (s.id)}{@render row(s, p, false)}{/each}
						{@render more(settled.length - settledShown, PAGE, () => (settledShown += PAGE))}
					</div>
				</Collapse>
			{/if}

			{@render shelfHead('projects', projectsOpen ? t('shell.projects') : `${t('shell.projects')} (${codeProjects.length})`, projectsOpen)}
			<Collapse open={projectsOpen}>
				<div class="shelf-body">
				{#each shelfProjects.slice(0, projectsShown) as p (p.id)}
					{@const all = p.sessions.filter((s) => matches(p, s)).sort((a, b) => recency(b) - recency(a))}
					{@const open = !!expanded[p.id] || (!!query && all.length > 0)}
					{@const shown = sessionsShown[p.id] ?? SESSION_PAGE}
					<div class="project" class:held={drag?.live && drag.id === p.id} style:transform={shiftStyle(p.id)} data-project-row={p.id}>
						<div class="folder" class:stale={p.stale} class:on={openProject === p.id}>
							<button class="caret" class:open aria-expanded={open} aria-label={t('shell.projectPage.toggle')} title={t('shell.projectPage.toggle')} onclick={() => toggleExpanded(p.id)}><ChevronRightIcon size={12} /></button>
							<button
								class="folder-row"
								onpointerdown={(e) => projectDown(e, p)}
								onclick={() => onOpenProject(p)}
								oncontextmenu={(e) => onProjectMenu(p, e)}
								title={p.worktree ? t('shell.task.worktreeTip', { branch: p.worktree.branch, base: p.worktree.baseBranch || '?' }) : p.path}
							>
								{#if p.worktree}<GitBranchIcon size={14} />{:else}<ProjectBadge project={p} size={16} />{/if}
								<span class="folder-name">{p.name}</span>
							</button>
							{#if p.stale}
								<span class="tag" title={p.path}>{t('shell.task.stale')}</span>
							{:else}
								<button class="act" onclick={() => onHistory(p)} aria-label="history" title={withShortcut(t('shell.history'), 'history')}><RotateCcwClockIcon size={14} /></button>
								{#if !p.worktree}
									<button class="act" onclick={() => onNewTask(p)} aria-label="new parallel task" title={t('shell.newTask')}><GitForkIcon size={14} /></button>
								{/if}
								<button class="act" onclick={() => onNewSession(p)} aria-label="new session" title={withShortcut(t('shell.newSessionInProject'), 'newSession')}><PlusIcon size={14} /></button>
							{/if}
							{#if codeProjects.length > 1 || p.stale}
								<button class="act" class:always={p.stale} onclick={() => onCloseProject(p)} aria-label="close project" title={p.stale ? t('shell.task.staleRemove') : t('shell.closeProject')}><XIcon size={14} /></button>
							{/if}
						</div>
						<Collapse {open}>
							{#each all.slice(0, shown) as s (s.id)}{@render row(s, p, true)}{/each}
							{@render more(all.length - shown, PAGE, () => (sessionsShown[p.id] = shown + PAGE), true)}
							{#if !all.length && !p.stale && !query}
								<button class="sess ghost nested" onclick={() => onNewSession(p)}><span class="sess-title">{t('shell.newChat')}</span></button>
							{/if}
						</Collapse>
					</div>
				{/each}
				{@render more(shelfProjects.length - projectsShown, PROJECT_PAGE, () => (projectsShown += PROJECT_PAGE))}
				</div>
			</Collapse>
		</div>
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
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 6px 10px 10px;
		flex-shrink: 0;
	}
	.search {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		margin-right: 4px;
		padding: 0 8px 0 10px;
		border-radius: var(--r);
		background: var(--surface2);
		cursor: text;
	}
	.search > :global(svg) {
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
	.clear {
		display: inline-flex;
		flex-shrink: 0;
		padding: 3px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.clear:hover {
		color: var(--text);
	}
	.anchor {
		position: relative;
		display: inline-flex;
	}
	.menu-at {
		position: fixed;
		z-index: 80;
		width: 0;
		height: 0;
	}
	.menu-at :global(.pm) {
		max-height: 60vh;
		overflow-y: auto;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tool:hover,
	.tool.scoped {
		background: var(--surface2);
		color: var(--text);
	}
	.primary {
		display: flex;
		flex-direction: column;
		padding: 0 10px 6px;
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
		border-radius: var(--r);
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
	.folder-row > :global(svg) {
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
		border-radius: var(--r);
		background: var(--accent);
		color: var(--on-accent);
		font-size: var(--fs-2xs);
		font-weight: 600;
		text-align: center;
	}

	/* The cards on top, the shelves kept at the bottom while the cards leave
	   room; it all scrolls together once they do not. */
	.list {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 2px 8px 10px;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.shelves {
		margin-top: auto;
		padding-top: 12px;
	}
	/* An open shelf takes at most this much of the list and scrolls inside. */
	.shelf-body {
		max-height: 40vh;
		overflow-y: auto;
	}
	.empty {
		margin: 8px 10px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 7px;
		width: 100%;
		padding: 13px 14px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.card:hover {
		background: var(--surface);
	}
	.card.on {
		background: var(--surface2);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		width: 100%;
		font-size: var(--fs-sm);
	}
	.line.top,
	.line.meta {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	/* As tall as the actions that replace the time on hover: no jump. */
	.line.top {
		height: 22px;
	}
	.proj {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.right {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		margin-left: auto;
		flex-shrink: 0;
		min-width: 24px;
	}
	.idle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.when {
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	/* Room for the actions, kept while they are hidden, so the hover changes
	   no size and they cover nothing but the time. */
	.card .right {
		min-width: 72px;
	}
	.sess .right {
		min-width: 48px;
	}
	/* On hover the time gives way to the actions: they fade in over it from
	   the right, one after another. */
	.acts {
		position: absolute;
		top: 50%;
		right: 0;
		display: inline-flex;
		align-items: center;
		opacity: 0;
		visibility: hidden;
		transform: translate(6px, -50%);
		transition:
			opacity var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out),
			visibility 0s linear var(--t-fast);
	}
	.acts > :global(.act) {
		opacity: 0;
		transform: translateX(4px);
		transition:
			opacity var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.idle {
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.card:hover .acts,
	.card:focus-within .acts,
	.sess:hover .acts,
	.sess:focus-within .acts {
		opacity: 1;
		visibility: visible;
		transform: translate(0, -50%);
		transition:
			opacity var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out),
			visibility 0s;
	}
	.card:hover .acts > :global(.act),
	.card:focus-within .acts > :global(.act),
	.sess:hover .acts > :global(.act),
	.sess:focus-within .acts > :global(.act) {
		opacity: 1;
		transform: none;
	}
	.card:hover .acts > :global(.act:nth-child(2)),
	.sess:hover .acts > :global(.act:nth-child(2)) {
		transition-delay: 30ms;
	}
	.card:hover .acts > :global(.act:nth-child(3)),
	.sess:hover .acts > :global(.act:nth-child(3)) {
		transition-delay: 60ms;
	}
	.card:hover .idle,
	.card:focus-within .idle,
	.sess:hover .idle,
	.sess:focus-within .idle {
		opacity: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.acts,
		.acts > :global(.act) {
			transform: translate(0, -50%);
		}
		.acts > :global(.act) {
			transform: none;
		}
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 22px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.folder .act {
		display: none;
		width: 26px;
		height: 26px;
	}
	.folder:hover .act,
	.folder .act.always {
		display: inline-flex;
	}
	/* A folder's actions fade in one after another as they appear. */
	.folder:hover .act:not(.always) {
		animation: act-in var(--t-fast) var(--ease-out) both;
	}
	.folder:hover .act:nth-of-type(2) {
		animation-delay: 25ms;
	}
	.folder:hover .act:nth-of-type(3) {
		animation-delay: 50ms;
	}
	.folder:hover .act:nth-of-type(4) {
		animation-delay: 75ms;
	}
	@keyframes act-in {
		from {
			opacity: 0;
			transform: translateX(4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.folder:hover .act:not(.always) {
			animation: none;
		}
	}
	.mark {
		display: inline-flex;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.info {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin-left: auto;
		flex-shrink: 0;
	}
	.term {
		display: inline-flex;
		padding: 1px;
		border-radius: var(--r);
		color: var(--ok);
		cursor: pointer;
	}
	.term:hover {
		background: var(--surface2);
	}
	.fact {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.branch {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		color: var(--dim2);
	}
	.branch span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag-dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.backend-chip {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.backend-chip :global(.mark) {
		color: inherit;
	}

	.shelf-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 32px;
		padding: 0 6px 0 10px;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		font-weight: 500;
		cursor: pointer;
	}
	.shelf-head:hover {
		color: var(--dim);
	}
	.rule {
		flex: 1;
		height: 1px;
		background: var(--hairline);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
		transform: rotate(180deg);
	}
	.chev.open {
		transform: none;
	}

	.sess.on {
		background: var(--surface2);
	}
	.sess.nested {
		padding-left: 36px;
	}
	.sess.arch .sess-title {
		color: var(--dim);
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
	.card .sess-title {
		font-weight: 500;
	}
	.sess-edit {
		flex: 1;
		min-width: 0;
		height: 24px;
		padding: 0 6px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r);
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	/* A reply not seen yet: the title stands out with the dot. */
	.sess-title.unread {
		color: var(--text);
		font-weight: 600;
	}
	/* Working: a highlight sweeps across the title. */
	.sess-title.running {
		/* Only as wide as the text, so the sweep crosses it. */
		flex: 0 1 auto;
		margin-right: auto;
		background: linear-gradient(100deg, var(--dim) 42%, var(--text) 50%, var(--dim) 58%) 0 0 / 250% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: title-sweep 2.2s linear infinite;
	}
	@keyframes title-sweep {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -150% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sess-title.running {
			animation: none;
		}
	}
	.more {
		min-height: 28px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.more.nested {
		padding-left: 36px;
	}

	.project {
		position: relative;
	}
	.list.dragging {
		cursor: grabbing;
		user-select: none;
	}
	.list.dragging .project {
		pointer-events: none;
		transition: transform 150ms var(--ease-out);
	}
	.list.dragging .project.held {
		z-index: 2;
		border-radius: var(--r);
		background: var(--panel);
		box-shadow: var(--shadow-sm);
		transition: none;
	}
	.folder {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: var(--r);
	}
	.folder:hover {
		background: var(--surface);
	}
	.folder.on {
		background: var(--surface2);
	}
	.folder-row {
		flex: 1;
		min-width: 0;
		padding-left: 2px;
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
	.caret {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 24px;
		margin-left: 4px;
		padding: 0;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.caret:hover {
		color: var(--text);
	}
	.caret :global(svg) {
		transition: transform var(--t-med) var(--ease-out);
	}
	.caret.open :global(svg) {
		transform: rotate(90deg);
	}
	.tag {
		flex-shrink: 0;
		padding: 1px 7px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
</style>
