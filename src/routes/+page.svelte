<script lang="ts">
	import { DaemonSync } from '$lib/daemonSync.svelte';
	import { onMount, untrack } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import SessionMark from '$lib/SessionMark.svelte';
	import { sessionStatus } from '$lib/sessionStatus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import TargetIcon from '@lucide/svelte/icons/target';
	import FilesIcon from '@lucide/svelte/icons/files';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import Toaster from '$lib/ui/Toaster.svelte';
	import CornerNotices from '$lib/ui/CornerNotices.svelte';
	import ModelSetup from '$lib/ModelSetup.svelte';
	import { modelSetup } from '$lib/modelSetupState.svelte';
	import ConfirmHost from '$lib/ui/ConfirmHost.svelte';
	import ConnectRequestDialog from '$lib/ConnectRequestDialog.svelte';
	import { connectRequests } from '$lib/connectRequests.svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import { toast } from '$lib/ui/toast.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { cycleTheme } from '$lib/theme.svelte';
	import {
		isPermissionGranted,
		requestPermission,
		sendNotification
	} from '@tauri-apps/plugin-notification';
	import { ChatState } from '$lib/chat.svelte';
	import { needsClaudeYoloRespawn } from '$lib/approval';
	import {
		readAuthProviders,
		listProviders,
		listDir,
		gitCheckpointCapture,
		generateText,
		git,
		daemon
	} from '$lib/protocol';
	import { dispatch, isAsleep } from '$lib/backends/router';
	import { caps } from '$lib/backends';
	import { loadBackendSettings } from '$lib/backends/settings';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { updater } from '$lib/updater.svelte';
	import { checkDaemonVersion } from '$lib/daemonVersion';
	import UpdatePrompt from '$lib/UpdatePrompt.svelte';
	import { browser, type WebRef } from '$lib/browser.svelte';
	import { devServers } from '$lib/devServers.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { playChime, unlockChimes, type Chime } from '$lib/chime';
	import { fmtTokens } from '$lib/usageStats';
	import { cloudSync } from '$lib/cloudSync.svelte';
	import { t } from '$lib/i18n';
	import { SessionStore, listedSessions } from '$lib/session.svelte';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import { autoRetry } from '$lib/autoRetry.svelte';
	import { limitResume } from '$lib/limitResume.svelte';
	import { refreshJucodeModels } from '$lib/jucodeModels';
	import { bare, canDrop, FRONT, keep, openTool, restoreView, saveView as savedView, viewKey, type View } from '$lib/workbench/view';
	import { closeTab, leafOfTab, leavesOf, type TileLayout, type TileTab } from '$lib/workbench/tiles';
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import { staleSessions } from '$lib/sidebar/autoArchive';
	import { terminals, watchTerminals } from '$lib/terminals.svelte';
	import { agentCatalog } from '$lib/agentCatalog.svelte';
	import { probeEngine } from '$lib/engineProbe';
	import WorkspaceDialog from '$lib/workbench/WorkspaceDialog.svelte';
	import { tuiBackendOf, tuiTabTitle } from '$lib/workbench/tuiTab';
	import { canHandOffToTui, isValidResumeSessionId, presetOf } from '$lib/tuiHandoff';
	import { activityOf, inWorkspace, workspaceSessions, type ActivityKind, type WorkspaceEntry } from '$lib/workbench/workspaces';
	import WorkspaceRail from '$lib/workbench/WorkspaceRail.svelte';
	import TitleBar from '$lib/shell/TitleBar.svelte';
	import ProjectMenu from '$lib/shell/ProjectMenu.svelte';
	import { fade } from 'svelte/transition';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import TabChromePopover from '$lib/workbench/TabChromePopover.svelte';
	import ChatPane, { type ChatPaneApi, type ProviderOption } from '$lib/ChatPane.svelte';
	import { llmTarget as llmTargetOf } from '$lib/llmTarget';
	import SettingsPage from '$lib/settings/SettingsPage.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import { folderName } from '$lib/agentImport';
	import Welcome from '$lib/welcome/Welcome.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import ProjectPickDialog from '$lib/ProjectPickDialog.svelte';
	import ShortcutsDialog from '$lib/ShortcutsDialog.svelte';
	import { matches } from '$lib/shortcuts';
	import DeskPage from '$lib/DeskPage.svelte';
	import ProjectPage from '$lib/ProjectPage.svelte';
	import FeedbackDialog from '$lib/FeedbackDialog.svelte';
	import { telemetry } from '$lib/telemetry.svelte';
	import { sendTelemetry } from '$lib/protocol';
	import { BACKEND_LABELS, type BackendId } from '$lib/backends';
	import Modal from '$lib/ui/Modal.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { daemonState } from '$lib/daemonState.svelte';
	import { CHATS_ENABLED, LOOSE_ID, type Project, type WorktreeMeta } from '$lib/types';
	import PlanPanel from '$lib/PlanPanel.svelte';
	import ProposalPane from '$lib/ProposalPane.svelte';
	import { planPages, proposalOf, proposalPanel } from '$lib/planPages.svelte';
	import type { ApprovalMode } from '$lib/approval';
	import GoalPanel from '$lib/GoalPanel.svelte';
	import FilesPanel from '$lib/FilesPanel.svelte';
	import GitPanel from '$lib/GitPanel.svelte';
	import TerminalPanel from '$lib/TerminalPanel.svelte';
	import BrowserPanel from '$lib/BrowserPanel.svelte';
	import TuiPanel from '$lib/TuiPanel.svelte';
	import EditorPane from '$lib/editor/EditorPane.svelte';
	import QuickOpen from '$lib/editor/QuickOpen.svelte';
	import { editorStore } from '$lib/editor/editorStore.svelte';

	// Project/session tree + lifecycle lives in the store; the page keeps thin
	// reactive aliases so templates and handlers read it naturally.
	const store = new SessionStore();
	const projects = $derived(store.projects);
	const allSessions = $derived(store.allSessions);
	const active = $derived(store.active);
	const chat = $derived(store.chat);
	const activeProject = $derived(store.activeProject);
	/** Where the active session works (its own folder, else its project's). */
	const activeCwd = $derived(store.activeId ? store.cwdOf(store.activeId) : undefined);
	const activeId = $derived(store.activeId);
	// A session by id, read from the store each time. A derived map of them
	// went stale twice after the app had run a while (even a new tab's first
	// read got the old map, so its new conversation showed as closed); a scan
	// of a few hundred sessions per lookup costs nothing next to that.
	const sessionById = (id: string) => store.allSessions.find((s) => s.id === id);

	let providers = $state<string[]>([]);

	async function notify(title: string, body: string) {
		try {
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (granted) sendNotification({ title, body });
		} catch {
			/* ignore */
		}
	}
	const chime = (kind: Chime) => {
		if (prefs.sounds) playChime(kind);
	};
	const notifyDone = (title: string) =>
		notify('JuCode', t('shell.notifyDone', { title: title || t('shell.untitled') }));
	// An approval a session deferred while nobody watched it, and a
	// scheduled run that needs the user: an OS notification while the window
	// is in the background, else a notice that leads there.
	function tell(title: string, message: string, open: () => void) {
		chime('attention');
		if (!document.hasFocus()) void notify(title, message);
		else toast.info(`${title} · ${message}`, { action: { label: t('shell.notify.open'), run: open } });
	}
	daemonState.onAction = (a) =>
		tell(t('shell.notify.action'), a.summary || a.name, () => openDesk('pending'));
	// A phone or browser of the account asks to connect: the dialog shows
	// over everything, and an OS notification while the window is elsewhere.
	connectRequests.onRequest = (r) => {
		chime('attention');
		if (!document.hasFocus()) void notify(t('shell.connectRequest.notifyTitle'), t('shell.connectRequest.notifyBody', { name: r.name || t('shell.connectRequest.device') }));
	};
	daemonState.onScheduleEvent = (e) =>
		tell(t(`shell.notify.schedule.${e.kind}`, { name: e.name }), e.detail, () =>
			e.session ? openDaemonSession(e.session) : openDesk('schedules')
		);
	let showSettings = $state(false);
	let settingsSection = $state<SectionKey>('general');
	function openSettings(section: SectionKey = 'general') {
		settingsSection = section;
		showDesk = false;
		showSettings = true;
	}
	function closeSettings() {
		showSettings = false;
		loadProviders();
	}
	let showMarket = $state(false);
	let showSetup = $state(false);
	// The welcome page's first view when opened from the palette (sign-in on request).
	let setupView = $state<'login' | undefined>();
	let showPalette = $state(false);
	let showShortcuts = $state(false);
	let showFeedback = $state(false);
	// The workbench page: what waits for the user, the scheduled tasks.
	let showDesk = $state(false);
	let deskPage = $state<'pending' | 'schedules'>('pending');
	/** `page`: the one to show; the last one shown otherwise. */
	function openDesk(page?: typeof deskPage) {
		if (page) deskPage = page;
		showSettings = false;
		showDesk = true;
	}
	// What is shown right of the sidebar (see "what is shown" below).
	let view = $state<View>(null);
	/** Each conversation's and project page's panes (by viewKey): the main
	 *  one (FRONT) and up to two of tool tabs. */
	let layouts = $state<Record<string, TileLayout>>({});
	/** Per view, the tool pane last used, where tools open (view.openTool). */
	const toolLeaf: Record<string, string> = {};
	/** The panes of a view that has opened no tool yet (one per view, so its
	 *  ids stay put until it does). */
	const bares = new Map<string, TileLayout>();
	function layoutOf(key: string): TileLayout {
		const own = layouts[key];
		if (own) return own;
		if (!bares.has(key)) bares.set(key, bare());
		return bares.get(key)!;
	}
	let viewReady = $state(false);
	/** Conversations kept mounted behind the one in front (view.keep). */
	let kept = $state<string[]>([]);
	// A project's page comes to the front like a conversation.
	function openProjectPage(p: Project) {
		showDesk = false;
		showSettings = false;
		if (viewReady) show({ kind: 'project', id: p.id });
	}
	/** The project whose page is in front, if any. */
	const shownProject = $derived(view?.kind === 'project' ? store.projects.find((p) => p.id === view!.id) : undefined);
	/** The session the sidebar shows as selected: the one in front. */
	const selectedSession = $derived(view?.kind === 'chat' ? view.id : '');
	const workspaceProjects = $derived(
		store.workspaceProjects.filter((p) => !p.worktree).map((p) => ({ id: p.id, path: p.path, name: p.name }))
	);

	/** Show a daemon session in a tab; one of another workspace (of a
	 *  project there, or saved there) opens there. */
	async function openDaemonSession(session: string) {
		const listed = daemonState.sessions.find((s) => s.session === session);
		const here = store.allSessions.some((s) => s.chat.sessionId === session) || (!!listed?.project && store.workspaceProjects.some((p) => p.id === listed.project));
		const elsewhere = here
			? undefined
			: workspaces.workspaces.find(
					(w) => w.id !== workspaces.activeId && ((!!listed?.project && w.projects.some((p) => p.id === listed.project)) || inWorkspace(w, session))
				);
		if (elsewhere) await switchWorkspace(elsewhere.id);
		store.openDaemonSession(listed?.cwd ?? '', session, listed?.title, listed?.engine, listed?.gateway, listed?.agent, true, listed?.project);
		showDesk = false;
	}
	let showQuickOpen = $state(false);

	function refreshAuth() {
		readAuthProviders()
			.then(async (p) => {
				if (p.includes('jucode') && !providers.includes('jucode')) {
					try {
						await refreshJucodeModels();
						loadProviders();
					} catch (e) {
						toast.error(t('settings.page.saveFailed', { msg: String(e) }));
					}
				}
				providers = p;
			})
			.catch(() => {});
	}

	// All configured providers (builtin + custom) with their models, so the in-chat
	// model picker can list every provider's models — not just the active one's.
	let providersList = $state<ProviderOption[]>([]);
	function loadProviders() {
		listProviders()
			.then((bs) => {
				let custom: ProviderOption[] = [];
				try {
					custom = JSON.parse(localStorage.getItem('jucode-custom-providers') || '[]');
				} catch (e) {
					console.error('failed to restore jucode-custom-providers', e);
					custom = [];
				}
				providersList = [
					...bs.map((b) => ({ id: b.id, base_url: b.base_url, format: b.protocol, models: b.models })),
					...custom
				];
			})
			.catch(() => {});
	}
	// Target endpoint for one-shot AI text (commit / PR), on the active session's provider.
	const llmTarget = $derived(llmTargetOf(providersList, chat));

	let sidebarWidth = $state(320);
	let showSidebar = $state(true);
	let sbResizing = $state(false);

	let sidebar = $state<ReturnType<typeof Sidebar>>();
	/** ⌘K: the sidebar's session filter, opening the sidebar if it is hidden. */
	function searchSessions() {
		if (showSettings) closeSettings();
		showDesk = false;
		if (!showSidebar) toggleSidebar();
		sidebar?.focusSearch();
	}
	function toggleSidebar() {
		showSidebar = !showSidebar;
		localStorage.setItem('jucode-sidebar-visible', showSidebar ? '1' : '0');
	}

	function startSidebarResize(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startW = sidebarWidth;
		sbResizing = true;
		const move = (ev: PointerEvent) => {
			sidebarWidth = Math.min(460, Math.max(240, startW + (ev.clientX - startX)));
		};
		const up = () => {
			sbResizing = false;
			localStorage.setItem('jucode-sidebar-width', String(sidebarWidth));
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---------- what is shown: one thing in front, tools beside it ----------
	// The sidebar picks what is in front: a conversation or a project's page,
	// in the main pane. Tool panels (plan, goal, files, git, terminal, browser,
	// a plan's page, the editor, a backend's TUI) are tabs of up to two more
	// panes, which the user arranges by dragging tabs. It is workspace state,
	// loaded from and saved to the active workspace's entry (view.ts).

	const ALL_PANELS = ['plan', 'goal', 'files', 'git', 'term', 'browser'] as const;
	// Plan/Goal are engine features. Goal stays gated by the backend cap; the plan
	// panel also appears whenever there's an actual plan (e.g. claude's TodoWrite),
	// even on backends that don't advertise goals.
	const panelKeys = $derived(
		ALL_PANELS.filter((k) => {
			if (k === 'goal') return caps(chat).goals;
			if (k === 'plan') return caps(chat).goals || (chat?.plan ?? []).length > 0;
			return true;
		})
	);
	const PANEL_ICONS: Record<(typeof ALL_PANELS)[number], typeof PlusIcon> = {
		plan: ListChecksIcon, goal: TargetIcon,
		files: FilesIcon, git: GitBranchIcon, term: SquareTerminalIcon, browser: GlobeIcon
	};
	const addOptions = $derived([
		{ key: 'chat', label: t('shell.agentSession'), icon: MessageSquareTextIcon, primary: true },
		...panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`), icon: PANEL_ICONS[k] }))
	]);

	function toolLabel(panel: string): string {
		const tui = tuiBackendOf(panel);
		if (tui) return tuiTabTitle(tui);
		if (panel === 'audit') return t('editor.title');
		if (panel === 'setup') return t('dock.tabs.setup');
		const proposal = proposalOf(panel);
		if (proposal) return planOf(proposal.sessionId, proposal.planId)?.title || t('chat.planCard.label');
		return (ALL_PANELS as readonly string[]).includes(panel) ? t(`dock.tabs.${panel}`) : panel;
	}
	function tuiReady(sid: string): boolean {
		const session = sessionById(sid);
		return !!session &&
			isValidResumeSessionId(session.chat.sessionId) &&
			(session.chat.resumable || !!session.restored) &&
			!session.chat.switching;
	}
	/** A new conversation: in the chat, or (the TUI by default) in the TUI of
	 *  the backend the user picks. */
	let tuiPick = $state<Project | null>(null);
	function newSession(p: Project) {
		if (prefs.defaultSurface === 'tui' && !p.chats) tuiPick = p;
		else store.addSession(p, undefined, undefined, undefined, looseCwd(p));
	}
	/** A new session of no project works where the active one does. */
	function looseCwd(p: Project) {
		return p.loose ? (activeCwd ?? store.workspaceProjects[0]?.path) : undefined;
	}
	/** A new conversation, from any of its entries (⌘N, the title bar, the
	 *  palette, the tray, the sidebar): its project is asked first, with the
	 *  one the entry belongs to (else the active one) picked. */
	let pickingProject = $state<{ current?: string } | null>(null);
	function askProject(p?: Project) {
		pickingProject = { current: p?.id ?? activeProject?.id };
	}
	function pickProject(p: Project | null) {
		newSession(p ?? store.looseGroup());
	}
	function pickTuiBackend(backend: BackendId) {
		const p = tuiPick;
		tuiPick = null;
		if (p) store.addTuiSession(p, backend, looseCwd(p));
	}
	// The TUI panel of each conversation in its TUI, for the title bar's way back.
	const tuiPanels: Record<string, TuiPanel | undefined> = $state({});
	/** Into the TUI. A running reply or background task ends with the engine,
	 *  so the user confirms that first. */
	async function continueInTui(sid: string) {
		const chat = sessionById(sid)?.chat;
		if (!chat) return;
		if (chat.busy || chat.bgTasks.length) {
			const ok = await confirm({
				title: t('chat.tuiInterruptTitle'),
				message: t('chat.tuiInterruptMessage'),
				confirmLabel: t('chat.tuiContinue'),
				danger: true
			});
			if (!ok) return;
		}
		store.openInTui(sid);
	}
	// "Open in the TUI" by default: an existing conversation moves there once,
	// when it first can; back in the chat, it stays.
	const openedInTui = new Set<string>();
	$effect(() => {
		if (prefs.defaultSurface !== 'tui') return;
		for (const session of store.allSessions) {
			const sid = session.id;
			if (openedInTui.has(sid) || !session.restored || !canHandOffToTui(session.backendId, presetOf(session.acpAgent))) continue;
			if (!tuiReady(sid) || !daemon.sessionOf(sid)) continue;
			openedInTui.add(sid);
			if (!session.chat.busy && !session.chat.bgTasks.length) store.openInTui(sid);
		}
	});

	function saveView() {
		if (viewReady) workspaces.updateLayout(savedView(view, layouts));
	}
	/** Puts `next` in front. */
	function show(next: View) {
		view = next;
		if (next?.kind === 'chat') kept = keep(kept, next.id);
		saveView();
	}
	/** Build what is shown for the current workspace from its saved view. */
	function initView() {
		const restored = restoreView(
			workspaces.active?.layout ?? null,
			store.shownSessions.map((s) => s.id),
			store.projects.map((p) => p.id),
			store.activeId || null
		);
		view = restored.view;
		layouts = restored.layouts;
		kept = view?.kind === 'chat' ? [view.id] : [];
		if (view?.kind === 'chat') store.activeId = view.id;
		viewReady = true;
		saveView();
	}
	/** The panes of what is in front. */
	const frontKey = $derived(view ? viewKey(view) : '');

	/** A change to view `key`'s panes (a tab moved, closed, a pane resized).
	 *  Closing the editor's tab hides it, so ⌘E can show it again. */
	function applyTiles(key: string, next: TileLayout) {
		if (!key || next === layoutOf(key)) return;
		layouts[key] = next;
		if (editorStore.visible && !leafOfTab(next.root, 'audit') && key === frontKey) editorStore.visible = false;
		saveView();
	}
	function onLeafFocus(key: string, leafId: string) {
		if (!leafOfTab(layoutOf(key).root, FRONT) || leafOfTab(layoutOf(key).root, FRONT)!.id !== leafId) toolLeaf[key] = leafId;
	}
	/** One browser and one editor in the window: opening either in a view
	 *  takes it out of the others'. */
	const SINGLE = new Set(['browser', 'audit']);
	/** Tool `panel` as a tab of view `key` (what is in front by default), in
	 *  its tool pane last used (view.openTool). */
	function openSide(panel: string, key = frontKey) {
		if (!key) return;
		if (SINGLE.has(panel))
			for (const other of Object.keys(layouts)) if (other !== key && leafOfTab(layouts[other]!.root, panel)) layouts[other] = closeTab(layouts[other]!, panel);
		const next = openTool(layoutOf(key), panel, toolLeaf[key] ?? null);
		applyTiles(key, next);
		const leaf = leafOfTab(next.root, panel);
		if (leaf) toolLeaf[key] = leaf.id;
	}
	/** Toggles: the tool in front of its pane closes, else it shows. */
	function toggleSide(panel: string) {
		const leaf = leafOfTab(layoutOf(frontKey).root, panel);
		if (leaf?.active === panel) applyTiles(frontKey, closeTab(layoutOf(frontKey), panel));
		else openSide(panel);
	}

	// A session's new worktree (SessionStore.#makeWorktree): named by a
	// one-shot model call from its first message, then set up by its
	// project's script, in a terminal tab of that session (run once).
	const WORKTREE_NAME_SYSTEM =
		'Name a git branch for the coding task the user describes: 2 to 4 lowercase English words joined by hyphens, like fix-login-redirect. Output the name only.';
	SessionStore.nameWorktree = async (message) => {
		const llm = llmTarget;
		if (!llm) return '';
		return (await generateText(llm.provider, llm.baseUrl, llm.format, llm.model, WORKTREE_NAME_SYSTEM, message.slice(0, 2000))).trim().split('\n')[0] ?? '';
	};
	/** Setup commands waiting for their session's terminal, by session id. */
	const setupRuns = new Map<string, string>();
	const quoted = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
	SessionStore.onWorktree = (s, project) => {
		if (!project.setup?.trim() || !s.cwd) return;
		const windows = document.documentElement.dataset.os === 'windows';
		const env = windows
			? `$env:JUCODE_PROJECT_ROOT=${quoted(project.path)}; $env:JUCODE_WORKTREE_PATH=${quoted(s.cwd)}; `
			: `export JUCODE_PROJECT_ROOT=${quoted(project.path)} JUCODE_WORKTREE_PATH=${quoted(s.cwd)}; `;
		setupRuns.set(s.id, env + project.setup.trim());
		openSide('setup', `chat:${s.id}`);
	};

	/** The title bar's + menu: a new conversation, or a tool beside. */
	function addFromTitle(key: string) {
		if (key !== 'chat') return openSide(key);
		askProject();
	}

	/** The approval mode a plan runs in once approved: the one before plan mode. */
	function planModeOf(sessionId: string): ApprovalMode {
		const before = sessionById(sessionId)?.chat.modeBeforePlan;
		return before && before !== 'plan' ? before : 'edits';
	}
		/** A plan message of a session, for its page. */
	function planOf(sessionId: string, planId: string) {
		const m = sessionById(sessionId)?.chat.messages.find((x) => x.kind === 'plan' && x.id === planId);
		return m?.kind === 'plan' ? m : undefined;
	}
	/** A plan's page beside its session's conversation. */
	function openPlanPage(sessionId: string, planId: string) {
		openSide(proposalPanel(sessionId, planId), `chat:${sessionId}`);
	}
	$effect(() => {
		const request = planPages.request;
		if (!request || !viewReady) return;
		untrack(() => openPlanPage(request.sessionId, request.planId));
	});

	/** A subagent's name, for the title bar while its page is shown. */
	function agentLabel(c: ChatState, id: string): string {
		const run = [...c.agentRuns.agents, ...c.agentRuns.workflows.flatMap((w) => w.agents)].find((a) => a.id === id);
		return run?.label || c.subagents[id]?.label || id;
	}

	/** A sidebar click: the session becomes active and comes to the front,
	 *  also when it already was the active one behind a project page. */
	function showSession(id: string) {
		store.activeId = id;
		show({ kind: 'chat', id });
	}

	// The active session is the one in front: activating one (⌘N, resume,
	// deep link, archiving the one in front…) shows it.
	$effect(() => {
		const id = store.activeId;
		if (!viewReady || !id) return;
		untrack(() => {
			if (view?.kind !== 'chat' || view.id !== id) show({ kind: 'chat', id });
		});
	});

	// A closed (or hidden) session leaves the front and the kept ones, a
	// removed project's page goes with it, and a plan page with its session.
	$effect(() => {
		const ids = new Set(store.shownSessions.map((s) => s.id));
		const projectIds = new Set(store.projects.map((p) => p.id));
		if (!viewReady) return;
		untrack(() => {
			if (kept.some((id) => !ids.has(id))) kept = kept.filter((id) => ids.has(id));
			const gone = (view?.kind === 'chat' && !ids.has(view.id)) || (view?.kind === 'project' && !projectIds.has(view.id));
			if (gone) show(store.activeId && ids.has(store.activeId) ? { kind: 'chat', id: store.activeId } : null);
			// A closed conversation's panes and project page's go with them.
			let pruned = false;
			for (const key of Object.keys(layouts)) {
				const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
				if ((kind === 'chat' && !ids.has(id)) || (kind === 'project' && !projectIds.has(id))) {
					delete layouts[key];
					pruned = true;
				}
			}
			if (pruned) saveView();
		});
	});

	// Opening a page in the embedded browser (agent tool / element pick / typed
	// URL) must show the browser, or the webview has nowhere to render.
	$effect(() => {
		if (browser.openSignal === 0) return;
		untrack(() => {
			if (viewReady) openSide('browser');
		});
	});

	// The audit pane (CodeMirror diff review) follows editorStore.visible: ⌘E /
	// chat file links / quick-open show it, its own close button (and closing
	// its tab, via applyTiles) hides it.
	$effect(() => {
		const want = editorStore.visible;
		if (!viewReady) return;
		untrack(() => {
			const holder = Object.keys(layouts).find((key) => leafOfTab(layouts[key]!.root, 'audit'));
			if (want && holder !== frontKey) openSide('audit');
			else if (!want && holder) applyTiles(holder, closeTab(layouts[holder]!, 'audit'));
		});
	});

	// Sessions idle past prefs.autoArchiveDays settle themselves: checked
	// when the setting changes and every ten minutes (sidebar/autoArchive.ts).
	$effect(() => {
		const days = prefs.autoArchiveDays;
		if (!viewReady || !days) return;
		const sweep = () =>
			untrack(() => {
				for (const s of staleSessions(store.shownSessions, days, view?.kind === 'chat' ? view.id : '')) store.archiveSession(s.id);
			});
		sweep();
		const timer = setInterval(sweep, 10 * 60_000);
		return () => clearInterval(timer);
	});

	// ---------- pane registry ----------
	// Global flows always target the active session's pane: palette commands,
	// ⌘F find, file drops and browser element picks.
	const panes = new Map<string, ChatPaneApi>();
	function registerPane(id: string, api: ChatPaneApi) {
		panes.set(id, api);
	}
	function unregisterPane(id: string, api: ChatPaneApi) {
		if (panes.get(id) === api) panes.delete(id);
	}
	// Palette command → the active pane (claude /resume etc. live there); with
	// no tile open the op still reaches the engine directly.
	function runCommand(cmd: string) {
		const pane = panes.get(store.activeId);
		if (pane) pane.runCommand(cmd);
		else if (store.activeId) dispatch(store.activeId, { op: 'command', input: cmd });
	}

	// Native child webviews always paint above the DOM, so any modal overlay
	// would appear underneath the browser — collapse it while a modal is open.
	$effect(() => {
		const modalOpen =
			showSettings ||
			showMarket ||
			showSetup ||
			showPalette ||
			showQuickOpen ||
			// The model picker is an in-composer popover (like effort/approval),
			// not a centered overlay, so it needn't collapse the browser webview.
			(!!chat?.picker && chat.picker.kind !== 'model') ||
			!!chat?.trustPrompt ||
			!!chat?.pendingRewind;
		browser.setSuspended(modalOpen);
	});

	// The editor confines opens / resolves relative engine paths against the
	// active project's root.
	$effect(() => {
		if (activeCwd) editorStore.root = activeCwd;
	});

	// ⌘E audits the current change instead of opening a blank IDE: it reveals
	// the audit tile on the session's most recently changed file (or re-shows /
	// hides files already under review). With nothing changed and nothing open
	// it does nothing — the pane has no empty-editor mode.
	function toggleAudit() {
		editorStore.visible = !editorStore.visible;
	}

	// ⌘K in the editor: forward the structured instruction to the active session
	// engine. Returns false when there's no live session to receive it.
	function sendAiEdit(content: string): boolean {
		const c = chat;
		if (!c || c.engineState === 'exited') return false;
		if (!c.busy) {
			// Snapshot the working tree before the turn (codex/claude rewinds
			// restore files from it; jucode checkpoints engine-side).
			const cwd = activeCwd;
			if (cwd && (c.backendId === 'codex' || c.backendId === 'claude')) {
				const idx = c.userTurns;
				gitCheckpointCapture(cwd, activeId, idx)
					.then((sha) => {
						if (sha) c.fileCheckpoints[idx] = sha;
					})
					.catch(() => {});
			}
			c.optimisticUser(content);
		}
		if (active?.archived) store.unarchiveSession(activeId);
		return dispatch(activeId, { op: 'user_message', content });
	}

	const loggedIn = $derived(!!chat?.provider && providers.includes(chat.provider));

	// Persist the project layout + open tabs (engine session id + title) into the
	// active workspace (app-data file, not localStorage) whenever they change.
	// Gated on `loaded` so it can't clobber the saved data before the initial
	// restore has run; untracked write so the effect only follows the session tree.
	$effect(() => {
		if (!store.loaded) return;
		const saved = store.serialize();
		const loose = store.serializeLoose();
		untrack(() => workspaces.updateProjects(saved, loose));
	});

	// One list of projects and sessions with the daemon (and so with paired
	// devices): the desktop's edits go to it, other clients' come back.
	const sync = new DaemonSync(store, workspaces, () => store.loaded && !wsBusy);
	// A new session may name a project just added: the daemon hears of it first.
	store.projectsSynced = () => sync.push();
	$effect(() => {
		if (!store.loaded || wsBusy) return;
		// A list that came while the tree was being restored or swapped.
		untrack(() => sync.flush());
		void sync.local();
		// Coalesce bursts of edits (a restore, a drag) into one save.
		const timer = setTimeout(() => sync.push(), 600);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		const list = daemonState.sessions;
		void workspaces.activeId;
		if (!store.loaded || wsBusy) return;
		untrack(() => sync.reconcile(list));
	});
	// The active session is always one the canvas shows.
	let lastShown = '';
	$effect(() => {
		const id = store.activeId;
		const shown = store.shownSessions.some((s) => s.id === id);
		if (shown) lastShown = id;
		else if (id)
			untrack(() => {
				const back = store.shownSessions.find((s) => s.id === lastShown) ?? store.shownSessions[0];
				store.activeId = back?.id ?? '';
			});
	});
	// A session listed from the daemon opens when it is first shown; one the
	// daemon closed for idleness waits for the user to send something.
	$effect(() => {
		const s = store.active;
		if (s?.dormant && !isAsleep(s.id)) untrack(() => store.wake(s.id));
	});

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

	// The engine announced its startup approval mode and it diverges from the
	// desktop's persisted mode (fresh start, crash auto-restart or provider
	// switch): push ours. Runs off the agent-event stream, per session.
	function flushModeSync(c: ChatState, sid: string) {
		if (!c.pendingModeSync) return;
		const mode = c.pendingModeSync;
		c.pendingModeSync = null;
		// A persisted claude yolo mode can't be pushed over the wire (runtime
		// bypassPermissions is ignored) — respawn with the flag instead.
		if (needsClaudeYoloRespawn(c.backendId, mode)) {
			// Spawned with the bypass flag and still not in bypass: the CLI
			// refused it (e.g. a managed policy). Respawning again would kill
			// every first turn in a loop; follow the engine's mode instead.
			if (store.allSessions.find((x) => x.id === sid)?.spawnedMode === 'bypassPermissions') {
				c.messages.push({ kind: 'error', text: t('shell.claudeYoloRefused') });
				return;
			}
			store.respawnClaudeYolo(sid);
			return;
		}
		dispatch(sid, { op: 'set_approval_mode', mode });
	}

	// ---------- workspaces ----------
	// A workspace is a saved set of projects + its canvas layout. Switching
	// swaps the whole session tree: snapshot the current one into its
	// workspace, detach its sessions (they keep running in the daemon), then
	// restore the target's projects (reopened by id) and rebuild the canvas. Swaps must never
	// overlap: `wsBusy` rejects (and disables in the tab bar) new transitions
	// while one is in flight; the generation token is belt-and-braces so a
	// stale restore can never persist its tree over a newer one.
	let wsGen = 0;
	let wsBusy = $state(false);
	/** Swap the live session tree to `entry`'s projects and rebuild the canvas. */
	async function swapToWorkspace(entry: WorkspaceEntry) {
		const gen = ++wsGen;
		wsBusy = true;
		try {
			viewReady = false; // gate the view effects during the swap
			for (const p of [...store.projects]) store.detachProject(p);
			store.loaded = false; // re-gate the persist effect during the swap
			await store.restore(entry.projects, entry.loose);
			if (gen !== wsGen) return;
			initView();
		} finally {
			if (gen === wsGen) wsBusy = false;
		}
	}
	// Daemon sessions of the workspaces in the back that finished a reply
	// since theirs was left: counted on the rail, unread once it is back.
	let finishedInBack = $state<string[]>([]);
	daemonState.onFinished = (sid) => {
		const back = workspaces.workspaces.some((w) => w.id !== workspaces.activeId && inWorkspace(w, sid));
		if (back && !finishedInBack.includes(sid)) finishedInBack = [...finishedInBack, sid];
	};
	// What each workspace's sessions are doing, for the rail: the one in
	// front from its live sessions, the others from the daemon (waiting,
	// failed, running) and the replies they finished since they were left.
	const wsActivity = $derived.by(() => {
		const waiting = new Set(daemonState.actions.map((a) => a.session_id));
		const view = new Map(daemonState.sessions.map((d) => [d.session, d]));
		const done = new Set(finishedInBack);
		const back = (sid: string): ActivityKind | null => {
			const d = view.get(sid);
			if (waiting.has(sid)) return 'input';
			if (d?.failed) return 'failed';
			if (d?.busy || d?.background) return 'running';
			return done.has(sid) ? 'done' : null;
		};
		const live = store.allSessions.filter((s) => !s.archived && s.chat.sessionId);
		const liveKind = new Map(
			live.map((s): [string, ActivityKind | null] => {
				const status = sessionStatus(s.chat);
				const kind = status?.kind;
				return [
					s.chat.sessionId,
					kind === 'input' || kind === 'failed' ? kind : kind === 'running' || kind === 'background' ? 'running' : kind === 'unread' ? 'done' : null
				];
			})
		);
		const front = live.map((s) => ({ sid: s.chat.sessionId, title: s.chat.title }));
		return Object.fromEntries(
			workspaces.workspaces.map((w) => [
				w.id,
				w.id === workspaces.activeId ? activityOf(front, (sid) => liveKind.get(sid) ?? null) : activityOf(workspaceSessions(w), back)
			])
		);
	});

	// Switching workspace: a plain mask with the target's name covers the
	// panel, the sessions swap under it, and it lifts. A beat heavier than
	// switching a session, on purpose: what belongs together goes in one
	// workspace.
	// About a second in all: in, the name held to be read, out.
	const WS_MASK_IN_MS = 300;
	/** Files being dragged over the window, for a chat to take (0: none). */
	let dragFiles = $state(0);
	const WS_MASK_HOLD_MS = 400;
	const WS_MASK_OUT_MS = 300;
	let wsMask = $state<WorkspaceEntry | null>(null);

	async function switchWorkspace(id: string) {
		if (id === workspaces.activeId || wsBusy) return;
		workspaces.updateProjects(store.serialize(), store.serializeLoose());
		const entry = workspaces.setActive(id);
		if (!entry) return;
		wsBusy = true; // the mask is coming down: no second switch meanwhile
		wsMask = entry;
		const covered = Date.now() + WS_MASK_IN_MS;
		await new Promise((done) => setTimeout(done, WS_MASK_IN_MS));
		try {
			await swapToWorkspace(entry);
			// The swap is quick: the name stays long enough to be read.
			const left = covered + WS_MASK_HOLD_MS - Date.now();
			if (left > 0) await new Promise((done) => setTimeout(done, left));
		} finally {
			// Lifts whatever the swap did: the panel is never left covered.
			wsMask = null;
		}
		const done = finishedInBack.filter((sid) => inWorkspace(entry, sid));
		for (const s of store.allSessions)
			if (s.chat.sessionId && done.includes(s.chat.sessionId) && s.id !== store.activeId) s.chat.unseen = true;
		finishedInBack = finishedInBack.filter((sid) => !done.includes(sid));
	}
	/** A session in a workspace's alert card: that workspace, then the session. */
	async function openWorkspaceAlert(id: string, sid: string) {
		await switchWorkspace(id);
		const s = store.allSessions.find((x) => x.chat.sessionId === sid);
		if (s) showSession(s.id);
	}
	// A new workspace takes a step on purpose (WorkspaceDialog): a few, not one
	// per project.
	let creatingWorkspace = $state(false);
	function newWorkspace() {
		if (!wsBusy) creatingWorkspace = true;
	}
	async function createWorkspace(name: string, move: Project[]) {
		creatingWorkspace = false;
		if (wsBusy) return;
		const entry = workspaces.create(name);
		if (!entry) return;
		for (const p of move) moveProjectToWorkspace(p, entry.id, true);
		await switchWorkspace(entry.id);
	}
	/** Delete a workspace (confirmed). Deleting the active one swaps the live
	 *  session tree to the default workspace returned by the store. */
	async function deleteWorkspace(id: string) {
		if (wsBusy) return;
		const ws = workspaces.workspaces.find((w) => w.id === id);
		if (!ws) return;
		if (ws.isDefault) {
			toast.warn(t('shell.workspace.cannotDeleteDefault'));
			return;
		}
		const ok = await confirm({
			title: t('shell.workspace.delete'),
			message: t('shell.workspace.deleteConfirm', { name: ws.name }),
			confirmLabel: t('shell.workspace.delete'),
			danger: true
		});
		if (!ok || wsBusy) return; // a swap may have started under the dialog
		const next = workspaces.remove(id);
		if (!next) return; // removed an inactive workspace — nothing to swap
		await swapToWorkspace(next);
	}

	// ---------- session chrome (color / icon / rename) ----------
	// One shared popover serves the sidebar's session rows.
	let sessionChromeFor = $state<{ sid: string; x: number; y: number } | null>(null);
	const chromeSession = $derived(sessionChromeFor ? (sessionById(sessionChromeFor.sid) ?? null) : null);

	function openSessionMenu(sid: string, ev: MouseEvent) {
		if (!!!sessionById(sid)) return;
		ev.preventDefault();
		sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY };
	}
	// The same popover colours a sidebar project folder and sets its icon.
	let projectChromeFor = $state<{ id: string; x: number; y: number } | null>(null);
	const chromeProject = $derived(projectChromeFor ? (projects.find((p) => p.id === projectChromeFor!.id) ?? null) : null);
	function openProjectMenu(p: Project, ev: MouseEvent) {
		ev.preventDefault();
		projectChromeFor = { id: p.id, x: ev.clientX, y: ev.clientY };
	}
	/** Where a session can move (移到项目): this workspace's other projects,
	 *  and out of any. Chats stay chats. */
	function projectTargets(id: string) {
		const owner = store.ownerOf(id);
		if (!owner || owner.chats) return [];
		const list = store.workspaceProjects.filter((p) => p !== owner && !p.stale).map((p) => ({ id: p.id, name: p.name }));
		return owner.loose ? list : [...list, { id: LOOSE_ID, name: t('shell.noProject') }];
	}
	/** The workspaces other than the open one, for 移到工作区. */
	const otherWorkspaces = $derived(workspaces.workspaces.filter((w) => w.id !== workspaces.activeId).map((w) => ({ id: w.id, name: w.name })));
	/** A project, its tabs with it, moves to another workspace. Its sessions
	 *  keep running in the daemon and open there. */
	function moveProjectToWorkspace(p: Project, wsId: string, quiet = false) {
		const saved = store.serialize().find((x) => x.id === p.id);
		const target = workspaces.workspaces.find((w) => w.id === wsId);
		if (!saved || !target) return;
		// Replacing it would take that project's sessions out of it.
		if (target.projects.some((x) => x.id !== p.id && normPath(x.path) === normPath(p.path))) {
			return toast.warn(t('shell.workspace.moveConflict', { ws: target.name }));
		}
		workspaces.setProjects(wsId, [...target.projects.filter((x) => x.id !== p.id), saved]);
		store.detachProject(p);
		workspaces.updateProjects(store.serialize(), store.serializeLoose());
		if (!quiet) toast.info(t('shell.workspace.moved', { name: p.name, ws: target.name }));
	}
	/** A session of no project moves to another workspace's; it keeps
	 *  running in the daemon and opens there. */
	function moveLooseToWorkspace(id: string, wsId: string) {
		const tab = store.serializeLoose().find((x) => x.id === id);
		const target = workspaces.workspaces.find((w) => w.id === wsId);
		if (!tab || !target) return;
		workspaces.setLoose(wsId, [tab, ...(target.loose ?? []).filter((x) => x.id !== id)]);
		store.park(id);
		toast.info(t('shell.workspace.moved', { name: tab.title || t('shell.untitled'), ws: target.name }));
	}
	/** Settings → 导入: the folders of imported conversations become projects
	 *  (without a chat; their conversations are in the project's 历史). */
	function addImportedFolders(paths: string[]): number {
		let added = 0;
		for (const path of paths) {
			if (store.projects.some((p) => normPath(p.path) === normPath(path))) continue;
			store.addProjectShell({ id: store.uid(), name: folderName(path), path });
			added++;
		}
		return added;
	}
	async function addProject() {
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		store.createProject(path);
	}
	async function removeProject(p: Project) {
		const ok = await confirm({
			title: t('shell.closeProjectTitle'),
			message: p.sessions.length
				? t('shell.closeProjectConfirm', { name: p.name, count: p.sessions.length })
				: t('shell.closeProjectEmptyConfirm', { name: p.name }),
			confirmLabel: t('shell.closeProjectTitle'),
			danger: true,
			dontAskKey: 'remove-project'
		});
		if (!ok) return;
		// Best-effort dirty-tab guard: closing a project with unsaved editor
		// buffers under its root discards them — confirm first.
		const projRoot = p.path.replace(/\/+$/, '');
		const dirtyTabs = editorStore.tabs.filter((tb) => tb.dirty && tb.path.startsWith(projRoot + '/'));
		if (dirtyTabs.length) {
			const ok = await confirm({
				title: t('editor.unsavedTitle'),
				message: t('editor.dirtyProjectConfirm'),
				danger: true
			});
			if (!ok) return;
			for (const tb of dirtyTabs) editorStore.close(tb.path, true);
		}
		store.removeProject(p);
	}

	/** A pane's render error: logged with the session for the logs folder. */
	function reportUiError(error: unknown, sid: string) {
		telemetry.track('error:pane');
		const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
		invoke('log_ui_error', { message: `pane ${sid}: ${text}` }).catch(() => {});
	}

	async function removeSession(id: string) {
		const s = sessionById(id);
		// A draft that never started has nothing to lose.
		if (s && !s.draft) {
			const ok = await confirm({
				title: t('shell.removeSessionTitle'),
				message: t('shell.removeSessionConfirm', { title: s.chat.title || t('shell.untitled') }),
				confirmLabel: t('shell.removeSessionTitle'),
				danger: true,
				dontAskKey: 'remove-session'
			});
			if (!ok) return;
		}
		// Its own worktree, which no other session works in: kept or removed
		// with it (its branch stays either way, as t3code does).
		const tree = s?.worktree && s.cwd ? { path: s.cwd, ...s.worktree } : null;
		const shared = !!tree && store.allSessions.some((x) => x.id !== id && x.cwd && normPath(x.cwd) === normPath(tree.path));
		const drop =
			!!tree &&
			!shared &&
			(await confirm({
				title: t('shell.worktreeDelete.title'),
				message: t('shell.worktreeDelete.message', { name: tree.slug, branch: tree.branch }),
				confirmLabel: t('shell.worktreeDelete.confirm'),
				cancelLabel: t('shell.worktreeDelete.keep')
			}));
		store.removeSession(id);
		if (drop && tree) git(['worktree', 'remove', '--force', tree.path], tree.mainRepoPath).catch((e) => toast.error(String(e)));
	}

	// ---------- 并行任务（git worktree） ----------
	/** 把任务 worktree 作为项目打开（已在列表中则聚焦），可携带首条消息（任务描述）。 */
	/** A worktree from the Git panel's list: the session working there, else
	 *  a new one in it, of the project of its main repository. */
	function openTaskProject(path: string, meta: WorktreeMeta) {
		const working = store.allSessions.find((s) => s.cwd && normPath(s.cwd) === normPath(path) && !s.archived);
		if (working) return showSession(working.id);
		const main = store.projects.find((p) => !p.worktree && normPath(p.path) === normPath(meta.mainRepoPath));
		if (!main) return void store.createProject(path, meta);
		const id = store.addSession(main);
		store.useWorktree(id, path, meta);
	}
	/** A worktree removed in the Git panel: a project of it (made before
	 *  worktrees were sessions') closes, sessions working in it settle. */
	function closeTaskProject(path: string) {
		const p = store.projects.find((x) => normPath(x.path) === normPath(path));
		if (p) store.removeProject(p);
		for (const s of store.allSessions) if (s.cwd && normPath(s.cwd) === normPath(path) && !s.archived) store.archiveSession(s.id);
	}
	/** 新建并行任务: a new session that will work in a new worktree of the
	 *  project's main repository, from its current branch (the session's
	 *  "where to work" menu changes it). */
	async function newTask(p: Project | undefined) {
		if (!p) return;
		const main = p.worktree ? store.projects.find((x) => !x.worktree && normPath(x.path) === normPath(p.worktree!.mainRepoPath)) : p;
		if (!main) return;
		const id = store.addSession(main);
		const branch = (await git(['branch', '--show-current'], main.path).catch(() => '')).trim();
		if (branch) store.setDraftWorktree(id, branch);
	}

	// ---------- 深链（jucode://） ----------
	const normPath = (p: string) => p.replace(/\/+$/, '');
	/** 打开（或聚焦）路径对应的项目；不存在则在目录有效时创建。 */
	async function openProjectPath(path: string, focusSession = true): Promise<Project | null> {
		const existing = store.projects.find((p) => normPath(p.path) === normPath(path));
		if (existing) {
			if (focusSession) store.activeId = existing.sessions[0]?.id ?? store.addSession(existing);
			return existing;
		}
		// 目录存在才创建项目（listDir 失败说明路径无效/不可访问）。
		try {
			await listDir(path, path); // confine to itself: just an existence check
		} catch {
			toast.error(t('shell.deepLinkBadPath', { path }));
			return null;
		}
		return store.createProject(path);
	}
	/**
	 * 深链路由：
	 *   jucode://open?project=<绝对路径(urlencoded)>          打开/聚焦该项目（目录存在则创建）
	 *   jucode://session/<会话id>?project=<绝对路径>          打开项目并恢复该会话
	 */
	async function handleDeepLink(raw: string) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return;
		}
		if (url.protocol !== 'jucode:') return;
		const route = url.host || url.pathname.replace(/^\/+/, '').split('/')[0];
		const projectPath = url.searchParams.get('project') ?? '';
		if (route === 'open') {
			if (projectPath) await openProjectPath(projectPath);
		} else if (route === 'session') {
			const sid = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
			if (!sid) return;
			const proj = projectPath ? await openProjectPath(projectPath, false) : (activeProject ?? store.shownProjects[0]);
			if (!proj) return;
			// 恢复的会话开在新标签里，不覆盖当前会话。
			store.activeId = store.restoreSession(proj, sid, '');
		}
	}

	// A zoom step shows the new size at the top right for a moment.
	let zoomNote = $state(false);
	let zoomNoteTimer: ReturnType<typeof setTimeout> | undefined;
	function stepZoom(dir: 1 | -1 | 0) {
		prefs.stepZoom(dir);
		zoomNote = true;
		clearTimeout(zoomNoteTimer);
		zoomNoteTimer = setTimeout(() => (zoomNote = false), 1200);
	}

	function onWindowKey(e: KeyboardEvent) {
		// Something closer to the target already claimed this key (e.g. the code
		// editor's own ⌘K / ⌘S keymap, or a pane's picker) — never double-fire.
		if (e.defaultPrevented) return;
		// The setup wizard is a blocking first-run modal — don't fire app shortcuts
		// under it (e.g. Cmd+K opening the palette behind it).
		if (showSetup) return;
		const act = (fn: () => void) => {
			e.preventDefault();
			fn();
		};
		const pane = panes.get(activeId);
		if (matches(e, 'palette')) return act(() => (showPalette = !showPalette));
		if (matches(e, 'searchSessions')) return act(searchSessions);
		if (matches(e, 'shortcuts')) return act(() => (showShortcuts = !showShortcuts));
		if (matches(e, 'zoomIn')) return act(() => stepZoom(1));
		if (matches(e, 'zoomOut')) return act(() => stepZoom(-1));
		if (matches(e, 'zoomReset')) return act(() => stepZoom(0));
		if (matches(e, 'find') && chat) return act(() => pane?.toggleFind());
		if (matches(e, 'newSession')) return act(() => askProject());
		if (matches(e, 'settings')) return act(() => !showSettings && openSettings());
		if (matches(e, 'sidebar')) return act(toggleSidebar);
		if (matches(e, 'audit')) return act(toggleAudit);
		if (matches(e, 'quickOpen')) return act(() => activeProject && (showQuickOpen = !showQuickOpen));
		if (matches(e, 'terminal')) return act(() => toggleSide('term'));
		if (matches(e, 'history')) return act(() => activeProject && !activeProject.loose && store.openHistory(activeProject));
		if (matches(e, 'focusComposer') && pane) return act(pane.focusComposer);
		if (matches(e, 'stop') && pane) return act(pane.stop);
		if (matches(e, 'model') && pane) return act(pane.openModelMenu);
		// Sessions as the sidebar lists them under the current project.
		const listed = activeProject ?? store.shownProjects[0];
		const list = listed ? listedSessions(listed) : [];
		const n = matches(e, 'sessionN');
		if (typeof n === 'number' && n > 0) return act(() => list[n - 1] && (store.activeId = list[n - 1].id));
		const step = matches(e, 'nextSession') ? 1 : matches(e, 'prevSession') ? -1 : 0;
		if (step && list.length) {
			const i = list.findIndex((s) => s.id === activeId);
			act(() => (store.activeId = list[(i + step + list.length) % list.length].id));
		}
	}

	onMount(() => {
		cloudSync.start();
		unlockChimes();
		// Anonymous usage counts; told once, off in Settings → General.
		if (telemetry.start(sendTelemetry))
			toast.info(t('settings.help.notice'), {
				duration: 15000,
				action: { label: t('settings.help.noticeAction'), run: () => openSettings('general') }
			});
		const onUiError = (e: Event) => {
			// (window-level errors; a pane's own are caught by its boundary)
			telemetry.track('error:ui');
			const err = e instanceof ErrorEvent ? e.error ?? e.message : (e as PromiseRejectionEvent).reason;
			const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
			invoke('log_ui_error', { message: text }).catch(() => {});
		};
		window.addEventListener('error', onUiError);
		window.addEventListener('unhandledrejection', onUiError);
		const savedSb = Number(localStorage.getItem('jucode-sidebar-width'));
		if (savedSb >= 240 && savedSb <= 460) sidebarWidth = savedSb;
		if (localStorage.getItem('jucode-sidebar-visible') === '0') showSidebar = false;
		const cleanups: Array<() => void> = [];
		let disposed = false;
		(async () => {
			// Load the workspaces file first (migrating a pre-workspace
			// localStorage layout on first run): it has no dependency on the
			// event listeners below, and the sidebar switcher can show early.
			const wsEntry = await workspaces.load(t('shell.workspace.default'));
			// One engine frame from the daemon into its session's adapter and
			// ChatState.
			const deliver = (sessionId: string, data: string) => {
				const s = sessionById(sessionId);
				if (!s) return;
				const wasBusy = s.chat.busy;
				const hadApproval = s.chat.pendingApproval?.callId ?? null;
				const hadPlan = s.chat.messages.findLast((m) => m.kind === 'plan' && m.status === 'pending');
				const lastPlan = s.chat.messages.findLast((m) => m.kind === 'plan');
				// Route the raw line through the session's adapter (the daemon already
				// speaks the jucode dialect for every engine). Parse, translate and
				// each handle() are isolated so one bad frame or event
				// can't silently drop the sibling events that follow it (e.g. a tool's
				// completion riding in the same frame as something that threw).
				let frame: unknown;
				try {
					frame = JSON.parse(data);
				} catch (err) {
					console.error('[agent-event] JSON parse failed', err, data.slice(0, 300));
					return;
				}
				let translated: ReturnType<typeof s.adapter.translate>;
				try {
					translated = s.adapter.translate(frame);
				} catch (err) {
					console.error('[agent-event] adapter.translate threw', err, frame);
					return;
				}
				for (const ev of translated) {
					try {
						s.chat.handle(ev);
					} catch (err) {
						console.error('[agent-event] chat.handle threw', (ev as { type?: string })?.type, err);
					}
				}
				flushModeSync(s.chat, s.id);
				if (s.chat.wantsCatalog) {
					s.chat.wantsCatalog = false;
					s.chat.catalogQuiet = true;
					dispatch(s.id, { op: 'command', input: '/model' });
				}
				const miss = s.chat.cacheMiss;
				if (miss) {
					s.chat.cacheMiss = null;
					if (prefs.cacheMissAlert) {
						toast.warn(
							t('shell.cacheMiss.message', {
								title: s.chat.title || t('shell.untitled'),
								input: fmtTokens(miss.input),
								cached: fmtTokens(miss.cached)
							}),
							{ duration: 5000, action: { label: t('shell.cacheMiss.stop'), run: () => dispatch(s.id, { op: 'interrupt' }) } }
						);
					}
				}
				// Read the current active session at call time (store.activeId is
				// reactive) — not a value snapshotted when the listener was mounted —
				// so unseen/notification target the right session after tab switches.
				const curActive = store.activeId;
				if (wasBusy && !s.chat.busy && s.id !== curActive) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
				// A sound unless the user is looking at this session: its turn
				// ended, or an action, a question or a plan waits on them.
				if (!document.hasFocus() || s.id !== curActive) {
					const asking = s.chat.pendingApproval;
					const planning = s.chat.messages.findLast((m) => m.kind === 'plan' && m.status === 'pending');
					if ((asking && asking.callId !== hadApproval) || (planning && planning !== hadPlan)) chime('attention');
					else if (wasBusy && !s.chat.busy) chime('done');
				}
				// Something waits on the user while the window is in the
				// background: an action to allow, or a plan to approve.
				if (!document.hasFocus()) {
					const ask = s.chat.pendingApproval;
					if (ask && ask.callId !== hadApproval && !ask.questions?.length)
						void notify(s.chat.title, t('shell.notifyApproval', { what: ask.summary.slice(0, 120) }));
					const plan = s.chat.messages.findLast((m) => m.kind === 'plan' && m.status === 'pending');
					if (plan && plan !== hadPlan && plan.kind === 'plan')
						void notify(s.chat.title, t('shell.notifyPlan', { title: plan.title }));
				}
				// A plan the model starts writing (or proposes whole) opens in its
				// page beside this session's chat.
				const newPlan = s.chat.messages.findLast((m) => m.kind === 'plan');
				if (newPlan && newPlan !== lastPlan && newPlan.kind === 'plan' && (newPlan.status === 'drafting' || newPlan.status === 'pending') && viewReady && view?.kind === 'chat' && view.id === s.id)
					openPlanPage(s.id, newPlan.id);
								// This session's tile (if any) sticks to the bottom while streaming.
				panes.get(s.id)?.scrollToEnd();
			};
			daemon.onFrame = deliver;
			daemon.onExit = (id) => store.handleExit(id);
			daemon.onIdleClose = (id) => store.sleep(id);
			daemon.onEvent = (frame) => {
				if (frame.type === 'session_reopened' && typeof frame.session === 'string') store.followReopened(frame.session);
				daemonState.handle(frame);
				sync.handle(frame);
				devServers.handle(frame);
				connectRequests.handle(frame);
			};
			daemon.onDisconnect = () => {
				connectRequests.open = [];
				daemonState.disconnected();
				sync.reset();
				devServers.disconnected();
			};
			daemon.onHello = (version) => {
				// Requests made while this window was not connected.
				void connectRequests.sync();
				checkDaemonVersion(version).then((outcome) => {
					if (outcome.kind === 'restart-when-idle')
						toast.info(t('shell.daemonUpdate.idle', { version: outcome.version }));
					else if (outcome.kind === 'failed') toast.error(t('shell.daemonUpdate.failed', { error: outcome.error }));
				});
			};
			// The client outlives this page: release the sessions it claimed for
			// this page's tabs when the page goes (see detachAll).
			cleanups.push(() => daemon.detachAll());
			daemonState.start();
			// Files dragged over the window: the whole window takes them (the
			// overlay), for the chat in front.
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				const p = e.payload;
				// Settings or the desk over the chats: no chat in front to take them.
				const pane = showSettings || showDesk ? undefined : panes.get(store.activeId);
				if (p.type === 'enter') dragFiles = pane ? p.paths.length : 0;
				else if (p.type === 'leave') dragFiles = 0;
				else if (p.type === 'drop') {
					dragFiles = 0;
					for (const path of p.paths) pane?.addAttachment(path);
				}
			});
			// Embedded-browser events: element picks become composer chips in the
			// active chat pane; nav/state updates flow into the browser store.
			const unbrowser = await listen<Record<string, unknown>>('browser-event', (e) => {
				const p = e.payload;
				if (p.kind === 'element') {
					browser.picking = false;
					const ref: WebRef = {
						url: typeof p.url === 'string' ? p.url : '',
						title: typeof p.title === 'string' ? p.title : '',
						selector: typeof p.selector === 'string' ? p.selector : '',
						tag: typeof p.tag === 'string' ? p.tag : '',
						text: typeof p.text === 'string' ? p.text : '',
						html: typeof p.html === 'string' ? p.html : ''
					};
					panes.get(store.activeId)?.insertWebRef(ref);
				} else {
					browser.handleEvent(p);
				}
			});
			// 托盘菜单「新建会话」：先选项目，再开新会话。
			const untray = await listen('tray-new-session', () => askProject());
			// Quitting (tray menu, Cmd+Q): save the workspaces first; the app
			// waits for this (see begin_quit in src-tauri).
			const unquit = await listen('app-quit', async () => {
				await workspaces.flush();
				await invoke('quit_app');
			});
			cleanups.push(undrop, unbrowser, untray, unquit);
			// Successful edit-tool completions auto-reload matching editor tabs
			// (and resolve pending ⌘K AI edits).
			ChatState.onFilesEdited = (paths) => editorStore.handleEngineEdit(paths);
			cleanups.push(() => (ChatState.onFilesEdited = null));
			// A session another started joins the list, without taking the view.
			ChatState.onSessionStarted = (cwd, started) => {
				const id = String(started.session);
				const listed = daemonState.sessions.find((s) => s.session === id);
				store.openDaemonSession(listed?.cwd ?? cwd, id, listed?.title ?? String(started.title ?? ''), String(started.engine ?? ''), listed?.gateway, listed?.agent, false, listed?.project);
			};
			cleanups.push(() => (ChatState.onSessionStarted = null));
			// A turn that failed on the connection is picked back up (autoRetry.ts).
			autoRetry.store = store;
			limitResume.store = store;
			ChatState.onTurnFailed = (c, message, started) => autoRetry.failed(c, message, started);
			cleanups.push(() => (ChatState.onTurnFailed = null));
			cleanups.push(watchTerminals());
			if (disposed) {
				cleanups.forEach((f) => f());
				return;
			}
			// Restore the active workspace's projects + their open conversations
			// (resume by id), or seed a default project on first run — then build
			// the canvas from the persisted layout.
			await store.restore(wsEntry.projects, wsEntry.loose);
			initView();
			// 深链在项目恢复完成后再注册，冷启动携带的链接（onOpenUrl 会补发当前
			// 深链）才能作用于已恢复的项目列表。
			const undeep = await onOpenUrl((urls) => {
				for (const u of urls) handleDeepLink(u);
			});
			cleanups.push(undeep);
			// Updates install in the background shortly after startup and every
			// 10 minutes after that; the relaunch is the user's (UpdatePrompt),
			// unless the server requires the version.
			const updateTimer = setTimeout(() => updater.check(true, true), 5000);
			const updateEvery = setInterval(() => updater.check(true, true), 10 * 60 * 1000);
			cleanups.push(() => clearTimeout(updateTimer), () => clearInterval(updateEvery));
			loadProviders();
			// The agents, then what each offers (its models before any session
			// of it: engineProbe), one at a time in the background.
			void agentCatalog.refresh().then(async () => {
				for (const id of ['claude', 'codex'] as const) if (agentCatalog.native[id]?.found) await probeEngine(id);
				for (const p of agentCatalog.presets) if (p.status === 'ready') await probeEngine('acp', { id: p.id, name: p.name, preset: true });
				for (const a of agentCatalog.agents) await probeEngine('acp', { id: a.id, name: a.name });
			});
			readAuthProviders()
				.then(async (p) => {
					if (p.includes('jucode')) {
						try {
							if (await refreshJucodeModels()) loadProviders();
						} catch (e) {
							toast.error(t('settings.page.saveFailed', { msg: String(e) }));
						}
					}
					providers = p;
					// A configured provider is not proof that onboarding was completed.
					if (!localStorage.getItem('jucode-setup-done')) showSetup = true;
				})
				.catch(() => {});
		})();
		return () => {
			disposed = true;
			window.removeEventListener('error', onUiError);
			window.removeEventListener('unhandledrejection', onUiError);
			cleanups.forEach((f) => f());
		};
	});
</script>

<!-- A tool tab's content, for the view it belongs to: that conversation's
     directory and state, or the project page's directory. -->
{#snippet tool(kind: string, cwd: string, c: ChatState | undefined, worktree: WorktreeMeta | null, sid?: string)}
	{#if kind === 'plan'}<PlanPanel plan={c?.plan ?? []} />
	{:else if proposalOf(kind)}
		{@const p = proposalOf(kind)!}
		{@const plan = planOf(p.sessionId, p.planId)}
		{@const lastPlan = sessionById(p.sessionId)?.chat.messages.findLast((m) => m.kind === 'plan')}
		<ProposalPane
			{plan}
			actionable={!!plan && plan === lastPlan}
			defaultMode={planModeOf(p.sessionId)}
			onAction={(id, action) => {
				panes.get(p.sessionId)?.planAction(id, action);
				if (action.decision === 'revise') panes.get(p.sessionId)?.focusComposer();
			}}
		/>
	{:else if kind === 'goal'}<GoalPanel goal={c?.goal ?? null} />
	{:else if kind === 'files'}<FilesPanel rootDir={cwd} />
	{:else if kind === 'git'}<GitPanel cwd={cwd} worktree={worktree} llm={llmTarget} onOpenTask={(path, meta) => openTaskProject(path, meta)} onTaskRemoved={closeTaskProject} />
	{:else if kind === 'term'}<TerminalPanel cwd={cwd} owner={sid ? { session: sid, tab: 'term' } : undefined} />
	{:else if kind === 'setup'}<TerminalPanel cwd={cwd} run={sid ? setupRuns.get(sid) : undefined} onRan={() => sid && setupRuns.delete(sid)} owner={sid ? { session: sid, tab: 'setup' } : undefined} />
	{:else if kind === 'browser'}<BrowserPanel />
	{:else if kind === 'audit'}<EditorPane onAiSend={sendAiEdit} />
	{:else if tuiBackendOf(kind)}<TuiPanel backend={tuiBackendOf(kind)!} cwd={cwd} onOpenSettings={() => openSettings('agents')} />
	{/if}
{/snippet}

<svelte:window onkeydown={onWindowKey} />

<Toaster />
{#if zoomNote}
	<div class="zoom-note" role="status" transition:fade={{ duration: 160 }}>{Math.round(prefs.zoom * 100)}%</div>
{/if}
<CornerNotices />
<ConfirmHost />
<ConnectRequestDialog />

<div class="app">
	<!-- TOP: one title bar across the window (traffic lights, sidebar toggle,
	     the title of what is in front centred on the window, panel actions). -->
	<TitleBar
		sidebarOpen={showSidebar}
		onToggleSidebar={toggleSidebar}
		title={showSettings ? t('settings.title') : showDesk ? t('shell.desk.title') : shownProject ? shownProject.name : active?.chat.agentPage ? agentLabel(active.chat, active.chat.agentPage) : (active?.chat.title ?? '')}
		subtitle={showSettings || showDesk || shownProject ? '' : active?.chat.agentPage ? [activeProject?.name, active.chat.title].filter(Boolean).join(' / ') : (activeProject?.name ?? '')}
		addOptions={showSettings || showDesk ? [] : addOptions}
		onAdd={addFromTitle}
	>
		{#snippet actions()}
			{@const editorPath = showSettings || showDesk ? undefined : shownProject ? shownProject.path : activeProject && !activeProject.chats && !activeProject.stale ? activeCwd : undefined}
			{#if editorPath}<ProjectMenu path={editorPath} name={(shownProject ?? activeProject)?.name ?? ''} onOpenGit={() => openSide('git')} />{/if}
			{#if !showSettings && !showDesk && active && active.surface === 'tui'}
				<button class="tile-action" title={t('dock.tui.backToGui')} aria-label={t('dock.tui.backToGui')} onclick={() => active && tuiPanels[active.id]?.backToGui()}>
					<MessageSquareTextIcon size={16} />
				</button>
			{:else if !showSettings && !showDesk && active && canHandOffToTui(active.backendId, presetOf(active.acpAgent))}
				<button
					class="tile-action"
					disabled={!tuiReady(active.id)}
					title={tuiReady(active.id) ? t('chat.tuiContinueTitle') : t('chat.tuiContinueUnavailable')}
					aria-label={t('chat.tuiContinue')}
					onclick={() => active && continueInTui(active.id)}
				>
					<SquareTerminalIcon size={16} />
				</button>
			{/if}
		{/snippet}
	</TitleBar>
	<div class="body">
		<!-- FAR LEFT: the workspace rail (top-level context). -->
		<WorkspaceRail
			workspaces={workspaces.workspaces}
			activeId={workspaces.activeId}
			busy={wsBusy}
			activity={wsActivity}
			onSwitch={switchWorkspace}
			onOpenAlert={openWorkspaceAlert}
			onNew={newWorkspace}
			onRename={(id, name) => workspaces.rename(id, name)}
			onChrome={(id, chrome) => workspaces.setChrome(id, chrome)}
			onDelete={deleteWorkspace}
			onMove={(id, target, after) => workspaces.move(id, target, after)}
			loggedIn={providers.includes('jucode')}
			updateAvailable={updater.available}
			settingsOpen={showSettings}
			onManageAccount={() => openSettings('account')}
			onSettings={() => (showSettings ? closeSettings() : openSettings())}
			onUpdate={() => openSettings('updates')}
		/>
		<!-- The content panel: session list + canvas, inset in the window chrome
		     with a rounded top-left corner. Settings covers it as a page; the
		     session list and canvas stay mounted (hidden) underneath so chats,
		     terminals and TUI tiles keep their state. -->
		<div
			class="panel"
			class:covered={showSettings || showDesk}
		>
			<!-- LEFT: the navigator — workspace / projects / sessions. Clicking a session
			     opens or focuses its chat tile on the canvas. -->
			<Sidebar
				bind:this={sidebar}
				{projects}
				{activeId}
				selectedId={selectedSession}
				width={showSidebar ? sidebarWidth : 0}
				resizing={sbResizing}
				onSelect={showSession}
				onOpenProject={openProjectPage}
				openProject={shownProject?.id ?? null}
				onNewProject={addProject}
				onNewTask={newTask}
				onNewSession={(p) => askProject(p)}
				onNewChat={() => store.newChat()}
				onDeleteSession={removeSession}
				onCloseProject={removeProject}
				onSettleSession={(id) => store.archiveSession(id)}
				onUnsettleSession={(id) => store.unarchiveSession(id)}
				onPinSession={(id, pinned) => store.setPinned(id, pinned)}
				onMoveProject={(id, target, after) => store.moveProject(id, target, after)}
				onMoveProjectToWorkspace={(id, ws) => {
					const p = store.workspaceProjects.find((x) => x.id === id);
					if (p) moveProjectToWorkspace(p, ws);
				}}
				onRenameSession={(id, title) => store.renameSession(id, title)}
				onSessionMenu={openSessionMenu}
				onProjectMenu={openProjectMenu}
				onHistory={(p) => store.openHistory(p)}
				pendingCount={daemonState.actions.length}
				terminals={terminals.busy}
				onOpenTerminal={(id) => {
					showSession(id);
					openSide(terminals.busy[id]?.tab ?? 'term', `chat:${id}`);
				}}
				onDesk={() => openDesk()}
			/>
			<div class="resizer side" class:hidden={!showSidebar} role="separator" aria-label="resize sidebar" onpointerdown={startSidebarResize}></div>

			<!-- The panes: what is in front (a conversation or a project's page)
			     and the tool tabs beside it. -->
			<div class="canvas">

				<div class="stage">
					{#if store.loaded && store.shownProjects.length === 0}
						<div class="nochat" data-tauri-drag-region>
							<span class="welcome-mark">JuCode</span>
							<p class="welcome-tip">{t('shell.noChat')}</p>
							<div class="welcome-actions">
								<Button variant="primary" size="sm" onclick={addProject}>{t('shell.startFromProject')}</Button>
								{#if CHATS_ENABLED}<Button size="sm" onclick={() => store.newChat()}>{t('shell.startChat')}</Button>{/if}
							</div>
						</div>
					{:else}
						{#each kept as sid (sid)}
							{@const sess = sessionById(sid)}
							{@const key = `chat:${sid}`}
							<div class="slot" class:hidden={view?.kind !== 'chat' || view.id !== sid}>
								<Mosaic
									layout={layoutOf(key)}
									onchange={(next) => applyTiles(key, next)}
									label={(tab: TileTab) => toolLabel(tab.panel)}
									barAdd={false}
									fixed={FRONT}
									canDrop={(tab, leaf, zone) => canDrop(layoutOf(key), tab, leaf, zone)}
									onFocus={(leaf) => onLeafFocus(key, leaf)}
								>
									{#snippet panel(tab)}
										{#if tab.id !== FRONT}
											{@render tool(tab.panel, store.cwdOf(sid) ?? '', sess?.chat, sess?.worktree ?? store.ownerOf(sid)?.worktree ?? null, sid)}
										{:else}
											{#if sess}
												{#if sess.surface === 'tui'}
													<!-- Session handoff: the same chat tile renders the native TUI
													     resuming this conversation by id (never a standalone tui:* tab),
													     once the engine has its daemon session (a new one is starting). -->
													{#if sess.chat.sessionId && daemon.sessionOf(sid)}
													<TuiPanel
														bind:this={tuiPanels[sid]}
														backend={sess.backendId}
														cwd={store.cwdOf(sid) ?? ''}
														session={daemon.sessionOf(sid)}
														terminal={sess.chat.terminal}
														onBackToGui={() => store.returnToGui(sid)}
														onReattach={() => store.rewatch(sid)}
														onOpenSettings={() => openSettings('agents')}
													/>
													{/if}
												{:else}
													<!-- A render error in one conversation must not blank the
													     pane silently: it shows, is logged, and can be retried. -->
													<svelte:boundary onerror={(e: unknown) => reportUiError(e, sid)}>
														<ChatPane
															session={sess}
															{store}
															{providers}
															{providersList}
															isActive={sid === activeId && view?.kind === 'chat' && view.id === sid && !showSettings && !showDesk}
															onRegister={registerPane}
															onUnregister={unregisterPane}
															onOpenSettings={openSettings}
														/>
														{#snippet failed(error: unknown, reset: () => void)}
															<div class="pane-error">
																<p>{t('shell.paneError')}</p>
																<code>{String((error as Error)?.message ?? error).slice(0, 300)}</code>
																<button onclick={reset}>{t('shell.paneErrorRetry')}</button>
															</div>
														{/snippet}
													</svelte:boundary>
												{/if}
											{:else}
												<div class="gone">{t('shell.chatGone')}</div>
											{/if}
										{/if}
									{/snippet}
								</Mosaic>
							</div>
						{/each}
						{#if shownProject}
							{@const project = shownProject}
							{@const key = `project:${project.id}`}
							<div class="slot">
								<Mosaic
									layout={layoutOf(key)}
									onchange={(next) => applyTiles(key, next)}
									label={(tab: TileTab) => toolLabel(tab.panel)}
									barAdd={false}
									fixed={FRONT}
									canDrop={(tab, leaf, zone) => canDrop(layoutOf(key), tab, leaf, zone)}
									onFocus={(leaf) => onLeafFocus(key, leaf)}
								>
									{#snippet panel(tab)}
										{#if tab.id !== FRONT}
											{@render tool(tab.panel, project.path, undefined, project.worktree ?? null)}
										{:else}
											<ProjectPage {project} onDirs={(dirs) => store.setProjectDirs(project, dirs)} onSetup={(script) => (project.setup = script || undefined)} />
										{/if}
									{/snippet}
								</Mosaic>
							</div>
						{:else if !view}
							<div class="nothing" data-tauri-drag-region>{t('shell.nothingShown')}</div>
						{/if}
					{/if}
				</div>
			</div>
			{#if showSettings}
				<SettingsPage
					sessionId={activeId}
					{chat}
					bind:section={settingsSection}
					navWidth={sidebarWidth}
					onAuthChange={refreshAuth}
					onMarket={() => {
						closeSettings();
						showMarket = true;
					}}
					onFeedback={() => (showFeedback = true)}
					onAddFolders={addImportedFolders}
					onClose={closeSettings}
				/>
			{/if}
			{#if showDesk}
				<DeskPage
					bind:page={deskPage}
					projects={workspaceProjects}
					navWidth={sidebarWidth}
					onClose={() => (showDesk = false)}
					onOpenSession={openDaemonSession}
				/>
			{/if}
		</div>
		<!-- Files dragged over the window: drop anywhere to attach them. -->
		{#if dragFiles}
			<div class="drop-layer" aria-hidden="true" in:fade={{ duration: 160 }} out:fade={{ duration: 140 }}>
				<div class="drop-frame">
					<span class="drop-icon"><FileUpIcon size={28} /></span>
					<span class="drop-title">{t('shell.drop.title')}</span>
					<span class="drop-meta">{t('shell.drop.count', { n: dragFiles })}</span>
				</div>
			</div>
		{/if}
		<!-- The mask over the panel while a workspace swaps in, naming it. -->
		{#if wsMask}
			{@const w = wsMask}
			<div class="ws-mask" aria-hidden="true" in:fade={{ duration: WS_MASK_IN_MS }} out:fade={{ duration: WS_MASK_OUT_MS }}>
				<div class="ws-name" in:fade={{ duration: 200, delay: 120 }}>
					{#if w.icon || w.isDefault}
						<TabGlyph icon={w.icon ?? { kind: 'builtin', id: 'home' }} color={w.color} active size={18} />
					{:else}
						<LayersIcon size={18} />
					{/if}
					<span class="ws-name-text">{w.name}</span>
					<span class="ws-name-meta">{t('shell.workspace.projects', { n: w.projects.length })}</span>
				</div>
			</div>
		{/if}
	</div>

	{#if showMarket}
		<Marketplace backend={active?.backendId ?? 'jucode'} onClose={() => (showMarket = false)} />
	{/if}

	<UpdatePrompt />
	{#if showSetup && activeId}
		<Welcome
			sessionId={activeId}
			startAt={setupView}
			hidden={showSettings}
			{chat}
			loggedIn={providers.includes('jucode')}
			configured={providers.length > 0}
			onRefreshAuth={refreshAuth}
			onOpenSettings={openSettings}
			onClose={async (choice) => {
				// Apply the explicit model choice to the initial draft, not just its menus.
				if (activeId) {
					await store.switchBackend(activeId, choice.backend);
					if (choice.backend === 'claude' || choice.backend === 'codex') {
						await store.applyToolProfile(activeId, choice.gateway ? 'jucode' : 'system', choice.model);
					} else if (active?.draft) {
						active.chat.model = choice.model;
						active.chat.effort = choice.effort;
						active.draftPick = { model: choice.model, effort: choice.effort };
					} else {
						dispatch(activeId, { op: 'command', input: `/model ${choice.model}${choice.effort ? ` ${choice.effort}` : ''}` });
					}
				}
				localStorage.setItem('jucode-setup-done', '1');
				showSetup = false;
			}}
		/>
	{/if}

	{#if modelSetup.open}
		<ModelSetup
			onClose={() => {
				modelSetup.open = false;
				loadProviders();
			}}
		/>
	{/if}

	{#if showQuickOpen && activeCwd}
		{@const qoRoot = activeCwd}
		<QuickOpen
			root={qoRoot}
			onClose={() => (showQuickOpen = false)}
			onOpen={(rel) => {
				showQuickOpen = false;
				editorStore.open(rel, qoRoot).catch((e) => toast.error(String(e)));
			}}
		/>
	{/if}

	{#if showFeedback}
		<FeedbackDialog onClose={() => (showFeedback = false)} />
	{/if}

	{#if creatingWorkspace}
		<WorkspaceDialog
			projects={store.workspaceProjects.filter((p) => !p.loose && !p.chats && !p.worktree)}
			onCreate={createWorkspace}
			onClose={() => (creatingWorkspace = false)}
		/>
	{/if}

	{#if sessionChromeFor && chromeSession}
		<TabChromePopover
			x={sessionChromeFor.x}
			y={sessionChromeFor.y}
			name={chromeSession.chat.title}
			color={chromeSession.color ?? null}
			icon={chromeSession.icon ?? null}
			onRename={(n) => store.renameSession(chromeSession.id, n)}
			onColor={(c) => store.setSessionChrome(chromeSession.id, { color: c })}
			onIcon={(i) => store.setSessionChrome(chromeSession.id, { icon: i })}
			pinned={!!chromeSession.pinned}
			onPin={(v) => store.setPinned(chromeSession.id, v)}
			moveLabel={t('shell.chrome.moveToProject')}
			moveTargets={projectTargets(chromeSession.id)}
			onMove={(to) => {
				const id = chromeSession.id;
				sessionChromeFor = null;
				store.moveToProject(id, to);
			}}
			workspaceTargets={store.ownerOf(chromeSession.id)?.loose ? otherWorkspaces : []}
			onMoveWorkspace={(ws) => {
				const id = chromeSession.id;
				sessionChromeFor = null;
				moveLooseToWorkspace(id, ws);
			}}
			onClose={() => (sessionChromeFor = null)}
		/>
	{/if}

	{#if projectChromeFor && chromeProject}
		<TabChromePopover
			x={projectChromeFor.x}
			y={projectChromeFor.y}
			name={chromeProject.name}
			color={chromeProject.color ?? null}
			icon={chromeProject.icon ?? null}
			onColor={(c) => store.setProjectChrome(chromeProject, { color: c })}
			onIcon={(i) => store.setProjectChrome(chromeProject, { icon: i })}
			moveTargets={chromeProject.chats ? [] : otherWorkspaces}
			onMove={(ws) => {
				const p = chromeProject;
				projectChromeFor = null;
				moveProjectToWorkspace(p, ws);
			}}
			onClose={() => (projectChromeFor = null)}
		>
			{#snippet defaultIcon()}
				{#if chromeProject.worktree}<GitBranchIcon size={14} />{:else}<FolderIcon size={14} />{/if}
			{/snippet}
		</TabChromePopover>
	{/if}

	{#if tuiPick}
		<Modal title={t('chat.tuiNewTitle')} width={380} onClose={() => (tuiPick = null)}>
			<p class="tui-pick-hint">{t('chat.tuiNewHint')}</p>
			<div class="tui-pick">
				{#each ['claude', 'codex', 'jucode'] as const as backend (backend)}
					<button class="tui-pick-item" onclick={() => pickTuiBackend(backend)}>
						<BackendIcon {backend} size={18} />
						<span>{BACKEND_LABELS[backend]}</span>
					</button>
				{/each}
			</div>
		</Modal>
	{/if}

	{#if pickingProject}
		<ProjectPickDialog
			projects={store.workspaceProjects.filter((p) => !p.stale)}
			current={pickingProject.current}
			loose={!!(activeCwd ?? store.workspaceProjects[0]?.path)}
			onPick={pickProject}
			onOpenFolder={addProject}
			onClose={() => (pickingProject = null)}
		/>
	{/if}

	{#if showPalette}
		<CommandPalette
			{chat}
			hasProject={!!activeProject}
			canNewTask={!!activeProject && !activeProject.stale && !activeProject.loose}
			panelOptions={panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`) }))}
			onClose={() => (showPalette = false)}
			onRun={runCommand}
			onNewSession={() => askProject()}
			onNewProject={addProject}
			onNewTask={() => newTask(activeProject)}
			onSettings={() => openSettings()}
			onMarket={() => (showMarket = true)}
			onOpenPanel={openSide}
			onToggleSidebar={toggleSidebar}
			onToggleTheme={cycleTheme}
			onSetup={(view) => {
				setupView = view;
				showSetup = true;
			}}
			onHistory={() => activeProject && !activeProject.loose && store.openHistory(activeProject)}
			onShortcuts={() => (showShortcuts = true)}
			onFeedback={() => (showFeedback = true)}
			canOpenTui={!!active && active.surface !== 'tui' && canHandOffToTui(active.backendId, presetOf(active.acpAgent)) && tuiReady(active.id)}
			onOpenTui={() => active && continueInTui(active.id)}
		/>
	{/if}
	{#if showShortcuts}
		<ShortcutsDialog onClose={() => (showShortcuts = false)} />
	{/if}
</div>

<style>
	/* Under the title bar's right end, over everything. */
	.zoom-note {
		position: fixed;
		top: 56px;
		right: 16px;
		z-index: 400;
		padding: 6px 12px;
		border-radius: var(--r);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		color: var(--text);
		font-size: var(--fs-sm);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	/* The window is the app, not a page: the document never scrolls, by a
	   trackpad (WebKit chains a scroll an inner list cannot take up to the
	   root) or by scrollIntoView, which `hidden` still allows and `clip`
	   does not; nor does it rubber-band. Lists scroll inside their panes. */
	:global(html),
	:global(body) {
		overflow: clip;
		overscroll-behavior: none;
	}
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
		background: var(--rail);
	}
	/* Round the frame to the macOS window corners (the transparent window does
	   not clip them); frosted chrome when vibrancy is on. */
	:global(:root[data-os='macos']) .app {
		border-radius: var(--r);
	}
	:global(:root[data-vibrancy='on']) .app {
		background: var(--vibrancy-chrome);
	}
	.body {
		position: relative;
		flex: 1;
		display: flex;
		min-height: 0;
	}
	/* Switching workspace (switchWorkspace): over the panel (the rail is
	   68px wide), its corner rounded as the panel's. */
	.ws-mask {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 68px;
		display: grid;
		place-items: center;
		border-top-left-radius: var(--r);
		background: var(--bg);
		z-index: 30;
	}
	/* Dropping files: the window dims behind a frame that takes them. */
	.drop-layer {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: grid;
		padding: 14px;
		background: color-mix(in oklab, var(--bg) 72%, transparent);
		backdrop-filter: blur(2px);
		pointer-events: none;
	}
	.drop-frame {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		border: 1.5px dashed color-mix(in oklab, var(--text) 35%, transparent);
		border-radius: calc(var(--r) * 1.6);
		color: var(--dim);
		animation: drop-in 220ms var(--ease-out) both;
	}
	.drop-icon {
		display: inline-flex;
		color: var(--text);
		animation: drop-float 1.6s ease-in-out infinite;
	}
	.drop-title {
		color: var(--text);
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.drop-meta {
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	@keyframes drop-in {
		from {
			opacity: 0;
			transform: scale(0.97);
		}
	}
	@keyframes drop-float {
		50% {
			transform: translateY(-5px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drop-frame,
		.drop-icon {
			animation: none;
		}
	}
	.ws-name {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--dim);
	}
	.ws-name-text {
		color: var(--text);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.ws-name-meta {
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.panel {
		flex: 1;
		display: flex;
		min-width: 0;
		border-top-left-radius: var(--r);
		overflow: hidden;
		position: relative;
		/* No fill of its own: the sidebar (frosted under vibrancy) and the
		   canvas paint their parts. */
	}
	/* Under the settings page: hidden but mounted. The frosted settings nav is
	   translucent, so the session list must not show through it. */
	.panel.covered > :global(:not(.settings, .desk-page)) {
		visibility: hidden;
	}

	/* ---------- the canvas ---------- */
	/* The canvas shares the session list's layer; only a hairline divides them. */
	.canvas {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg);
		position: relative;
	}
	.stage {
		position: relative;
		flex: 1;
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.slot > :global(.mosaic) {
		flex: 1;
	}
	.slot {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
	}
	.slot.hidden {
		display: none;
	}
	.nothing {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
	.tile-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.tile-action:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.tile-action:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.gone {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.nochat {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}
	.welcome-mark {
		font-family: var(--font-sans);
		font-weight: 600;
		font-size: var(--fs-2xl);
		letter-spacing: -0.005em;
		color: var(--text);
		opacity: 0.16;
	}
	.welcome-tip {
		margin: 0;
		font-size: var(--fs-md);
		color: var(--dim);
	}
	.welcome-actions {
		display: flex;
		gap: 8px;
	}

	/* ---------- sidebar resizer ---------- */
	.resizer {
		width: 5px;
		flex-shrink: 0;
		cursor: col-resize;
		background: transparent;
		z-index: 5;
		transition: background var(--t-med) var(--ease-out);
	}
	.resizer:hover {
		background: var(--accent-soft);
	}
	.resizer.side {
		margin-left: -3px;
		margin-right: -2px;
	}
	.resizer.hidden {
		display: none;
	}
	.tui-pick-hint {
		margin: 0 0 12px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.tui-pick {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tui-pick-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
	}
	.tui-pick-item:hover {
		border-color: var(--accent);
		background: var(--surface2);
	}
	.pane-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 100%;
		padding: 24px;
		color: var(--dim);
		text-align: center;
	}
	.pane-error code {
		max-width: 560px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		word-break: break-word;
	}
	.pane-error button {
		padding: 6px 14px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
</style>
