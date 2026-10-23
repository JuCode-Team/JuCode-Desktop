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
	import {
		activateTab,
		closeTab,
		emptyLayout,
		findLeaf,
		leafOfTab,
		leavesOf,
		openTab,
		serializeLayout,
		splitLeaf,
		type TileLayout,
		type TileTab
	} from '$lib/workbench/tiles';
	import {
		chatPanel,
		chatSessionOf,
		chatSessionsIn,
		openChatTab,
		openElsewhere as placeElsewhere,
		projectOf,
		projectPanel,
		reconcileLayout
	} from '$lib/workbench/canvas';
	import { tuiBackendOf, tuiTabTitle } from '$lib/workbench/tuiTab';
	import { canHandOffToTui, isValidResumeSessionId, presetOf } from '$lib/tuiHandoff';
	import { inWorkspace, workspaceAlerts, type WorkspaceEntry } from '$lib/workbench/workspaces';
	import type { TabIcon } from '$lib/workbench/tabChrome';
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import WorkspaceRail from '$lib/workbench/WorkspaceRail.svelte';
	import TitleBar from '$lib/shell/TitleBar.svelte';
	import OpenInEditor from '$lib/shell/OpenInEditor.svelte';
	import { fade } from 'svelte/transition';
	import TabChromePopover from '$lib/workbench/TabChromePopover.svelte';
	import ChatPane, { type ChatPaneApi, type ProviderOption } from '$lib/ChatPane.svelte';
	import SettingsPage from '$lib/settings/SettingsPage.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import { folderName } from '$lib/agentImport';
	import Welcome from '$lib/welcome/Welcome.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import ShortcutsDialog from '$lib/ShortcutsDialog.svelte';
	import { matches } from '$lib/shortcuts';
	import TaskDialog from '$lib/TaskDialog.svelte';
	import DeskPage from '$lib/DeskPage.svelte';
	import ProjectPage from '$lib/ProjectPage.svelte';
	import FeedbackDialog from '$lib/FeedbackDialog.svelte';
	import { telemetry } from '$lib/telemetry.svelte';
	import { sendTelemetry } from '$lib/protocol';
	import { Requirements, needsYou, provideRequirements, type Requirement } from '$lib/requirements.svelte';
	import type { StartHow } from '$lib/requirements/StartButton.svelte';
	import { normalizeBackendId, BACKEND_LABELS, type BackendId } from '$lib/backends';
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
	// The requirements on this computer (the daemon's list).
	const requirements = new Requirements(daemon);
	provideRequirements(requirements);
	// A session at a requirement's start gate is held read-only by the daemon:
	// it shows the engine's mode, and this client's mode is neither pushed
	// over it nor saved from it (also when it was started elsewhere).
	$effect(() => {
		for (const s of allSessions) {
			const sid = s.chat.sessionId;
			if (sid && requirements.bySession.get(sid)?.gate?.session === sid) s.chat.followEngineMode = true;
		}
	});

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
	// 「新建并行任务」对话框：为哪个（主仓库）项目开任务。
	let taskDialogFor = $state<Project | null>(null);
	// The workbench page: what waits for the user, the requirements, the
	// scheduled tasks.
	let showDesk = $state(false);
	let deskPage = $state<'pending' | 'requirements' | 'schedules'>('pending');
	let deskRequirement = $state<string | null>(null);
	let captureSignal = $state(0);
	/** `page`: the one to show; the last one shown otherwise. */
	function openDesk(page?: typeof deskPage) {
		if (page) {
			deskPage = page;
			deskRequirement = null;
		}
		showSettings = false;
		showDesk = true;
	}
	// A project's page is a canvas tab like a conversation (one per project).
	function openProjectPage(p: Project) {
		showDesk = false;
		showSettings = false;
		if (!tilesReady) return;
		const panel = projectPanel(p.id);
		applyTiles(openTab(tiles, focusedLeaf, { id: panel, panel }));
		focusedLeaf = leafOfTab(tiles.root, panel)?.id ?? focusedLeaf;
	}
	/** The project whose page is the focused tile's tab, if any. */
	const shownProject = $derived.by(() => {
		const leaf = focusedLeaf ? findLeaf(tiles.root, focusedLeaf) : null;
		const id = leaf?.active ? projectOf(leaf.active) : null;
		return id ? store.projects.find((p) => p.id === id) : undefined;
	});
	/** The session the sidebar shows as selected: the focused tab's, while
	 *  it has a tab (a project page focused selects the project instead). */
	const selectedSession = $derived.by(() => (shownProject || !tilesReady || !chatSessionsIn(tiles).includes(activeId) ? '' : activeId));
	/** The workbench's requirements page: one requirement, or the list. */
	function openRequirements(id: string | null = null) {
		openDesk('requirements');
		deskRequirement = id;
	}

	/** Starts a session on requirement `r`: a new draft in its project (or
	 *  a parallel task's) that shows the start card; once the user starts
	 *  it, the daemon has the agent explain its understanding first and wait
	 *  for confirmation (see Requirements.begin). */
	let taskRequirement = $state<{ id: string; name: string } | null>(null);
	async function startRequirement(r: Requirement, how: StartHow) {
		try {
			telemetry.track('requirement_start');
			const project = store.workspaceProjects.find((p) => p.id === (how.project ?? r.project) && !p.stale);
			if (!project) return toast.warn(t('shell.requirement.pickProject'));
			if (!r.project) await requirements.update(r.id, { project: project.id });
			if (how.mode === 'worktree') {
				// The id keeps the branch name readable whatever the title's script.
				taskRequirement = { id: r.id, name: `${r.id} ${r.title}` };
				newTask(project);
				return;
			}
			// An empty new session there (one a new project starts with) is used
			// rather than a second one.
			const backend = how.backend ? normalizeBackendId(how.backend) : undefined;
			const empty = project.sessions.find(
				(s) => s.draft && !s.requirement && !s.chat.messages.length && (!backend || s.backendId === backend)
			);
			const id = empty?.id ?? store.addSession(project, undefined, backend);
			store.activeId = id;
			const session = store.allSessions.find((s) => s.id === id);
			if (session) {
				session.requirement = r.id;
				session.requirementStart = { plan: session.chat.approvalMode === 'plan' };
			}
			showDesk = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}
	/** What a running daemon session shown here is doing now (its plan's
	 *  current step). */
	function currentStep(session: string): string | undefined {
		const chat = allSessions.find((s) => s.chat.sessionId === session)?.chat;
		return chat?.plan.find((p) => p.status === 'in_progress')?.step;
	}
	/** Requirements of the open workspace on the user's turn (as the
	 *  workbench counts them). */
	const yourTurnCount = $derived.by(() => {
		const ids = new Set(workspaceProjects.map((p) => p.id));
		return requirements.list.filter((r) => needsYou(r) && (!r.project || ids.has(r.project))).length;
	});
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
	// Target endpoint for one-shot AI text (commit / PR). Prefer the active
	// session's provider; fall back to the default jucode gateway or the first
	// configured provider. Strip any `[1m]`-style alias suffix from the model id.
	const llmTarget = $derived.by(() => {
		const pick =
			providersList.find((p) => p.id === chat?.provider) ??
			providersList.find((p) => p.id === 'jucode') ??
			providersList[0];
		if (!pick) return null;
		const model =
			chat?.provider === pick.id && chat?.model
				? chat.model.replace(/\[.*?\]$/, '')
				: (pick.models[0]?.name ?? '');
		if (!model) return null;
		return { provider: pick.id, baseUrl: pick.base_url, format: pick.format, model };
	});

	let sidebarWidth = $state(292);
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

	// ---------- the canvas: ONE mosaic for chats + tool panels ----------
	// Everything right of the navigator is a single tile tree. Tabs are chat
	// sessions (`chat:<sessionId>`), the former dock panels, `tui:<backend>`
	// terminals and the audit pane. The layout is workspace state: it loads
	// from and persists to the active workspace's app-data entry.
	let tiles = $state<TileLayout>(emptyLayout());
	let tilesReady = $state(false);
	let focusedLeaf = $state<string | null>(null);

	const ALL_PANELS = ['plan', 'goal', 'files', 'git', 'term', 'browser'] as const;
	// Plan/Goal are engine features. Goal stays gated by the backend cap; the plan
	// tab also appears whenever there's an actual plan (e.g. claude's TodoWrite),
	// even on backends that don't advertise goals.
	const panelKeys = $derived(
		ALL_PANELS.filter((k) => {
			if (k === 'goal') return caps(chat).goals;
			if (k === 'plan') return caps(chat).goals || (chat?.plan ?? []).length > 0;
			return true;
		})
	);
	// One agent-session type only: the coding agent is picked INSIDE the
	// session (model popup), never at tab creation. Persisted `tui:*` tabs
	// still render, but TUI tabs are no longer offered as new options.
	const PANEL_ICONS: Record<(typeof ALL_PANELS)[number], typeof PlusIcon> = {
		plan: ListChecksIcon, goal: TargetIcon,
		files: FilesIcon, git: GitBranchIcon, term: SquareTerminalIcon, browser: GlobeIcon
	};
	const addOptions = $derived([
		{ key: 'chat', label: t('shell.agentSession'), icon: MessageSquareTextIcon, primary: true },
		...panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`), icon: PANEL_ICONS[k] }))
	]);

	function tileLabel(tab: TileTab): string {
		const sid = chatSessionOf(tab.panel);
		if (sid) return sessionById(sid)?.chat.title || t('shell.untitled');
		const tui = tuiBackendOf(tab.panel);
		if (tui) return tuiTabTitle(tui);
		if (tab.panel === 'audit') return t('editor.title');
		const pid = projectOf(tab.panel);
		if (pid) return store.projects.find((p) => p.id === pid)?.name ?? pid;
		const proposal = proposalOf(tab.panel);
		if (proposal) return planOf(proposal.sessionId, proposal.planId)?.title || t('chat.planCard.label');
		return (ALL_PANELS as readonly string[]).includes(tab.panel) ? t(`dock.tabs.${tab.panel}`) : tab.panel;
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

	// A tool tab is an *instance* of a panel kind (two terminals are two tabs);
	// chat tabs derive their id from the session instead.
	let tabSeq = 0;
	const newTabId = () => `p${Date.now().toString(36)}-${(tabSeq++).toString(36)}`;

	const findPanelTab = (kind: string) =>
		leavesOf(tiles.root)
			.flatMap((l) => l.tabs)
			.find((tb) => tb.panel === kind);

	/** Apply + persist a layout change; keep editorStore in sync when the user
	 *  closed the audit tab directly (so a later ⌘E can re-create it). */
	function applyTiles(next: TileLayout) {
		if (next === tiles) return;
		// A draft whose tab closes before its first message leaves nothing behind.
		const open = new Set(chatSessionsIn(next));
		const dropped = chatSessionsIn(tiles).filter((sid) => !open.has(sid) && sessionById(sid)?.draft);
		tiles = next;
		for (const sid of dropped) store.removeSession(sid);
		if (tilesReady) workspaces.updateLayout(serializeLayout(next));
		if (editorStore.visible && !findPanelTab('audit')) editorStore.visible = false;
	}

	/** Build the canvas for the current workspace: reconcile the persisted
	 *  layout with this run's sessions (migrating old dock-only layouts by
	 *  grafting a chat leaf) and focus the active session's tile. */
	/** The session restore made active while the layout shows no
	 *  conversation (the user closed them all): not opened for that. */
	let shownNowhere = '';
	function initTiles() {
		tiles = reconcileLayout(
			workspaces.active?.layout ?? null,
			store.shownSessions.map((s) => s.id),
			store.activeId || null
		);
		// The conversation in front when the app closed comes back in front:
		// restore() picks the sidebar's first session, and activating one the
		// layout does not show in front would open or raise its tab.
		const front = leavesOf(tiles.root)
			.map((l) => (l.active ? chatSessionOf(l.active) : null))
			.find((sid) => sid != null);
		if (front) store.activeId = front;
		shownNowhere = chatSessionsIn(tiles).length ? '' : store.activeId;
		const activeLeaf = store.activeId ? leafOfTab(tiles.root, chatPanel(store.activeId)) : null;
		focusedLeaf = activeLeaf?.id ?? leavesOf(tiles.root)[0]?.id ?? null;
		tilesReady = true;
		// Persist the reconciled result so migrated layouts land on disk too.
		workspaces.updateLayout(serializeLayout(tiles));
	}

	/** The focused leaf's chat session (if its active tab is one) becomes the
	 *  workbench-active session — engine actions and tool panels target it. */
	function syncActiveFromFocus() {
		const leaf = focusedLeaf ? findLeaf(tiles.root, focusedLeaf) : null;
		const tab = leaf?.tabs.find((tb) => tb.id === leaf.active);
		const sid = tab ? chatSessionOf(tab.panel) : null;
		if (sid && sid !== store.activeId && !!sessionById(sid)) store.activeId = sid;
	}
	function onMosaicChange(next: TileLayout) {
		applyTiles(next);
		syncActiveFromFocus();
	}
	function onLeafFocus(leafId: string) {
		focusedLeaf = leafId;
		syncActiveFromFocus();
	}

	/** Per-leaf “+” menu (and the empty-canvas buttons). */
	function mosaicAdd(leafId: string | null, key: string) {
		if (key === 'chat') {
			const p = activeProject ?? store.shownProjects[0];
			if (!p) return;
			if (leafId) focusedLeaf = leafId;
			newSession(p); // the activeId effect opens its tile in the focused leaf
			return;
		}
		// The embedded browser is a singleton native webview — a second tab
		// would fight over it, so re-activate the existing one instead.
		if (key === 'browser') {
			const existing = findPanelTab('browser');
			if (existing) {
				applyTiles(activateTab(tiles, existing.id));
				return;
			}
		}
		applyTiles(openElsewhere({ id: newTabId(), panel: key }, { leafId }));
	}

	/** A tool window, where settings say (canvas.openElsewhere). */
	function openElsewhere(
		tab: TileTab,
		{ leafId = null, place = prefs.openElsewhere, sessionId = store.activeId }: { leafId?: string | null; place?: 'side' | 'tab'; sessionId?: string | null } = {}
	): TileLayout {
		const chatLeaf = sessionId ? (leafOfTab(tiles.root, chatPanel(sessionId))?.id ?? null) : null;
		return placeElsewhere(tiles, tab, { place, chatLeaf, leafId, focused: focusedLeaf });
	}

	/** Palette / signals: re-activate an existing tab of this panel kind (a
	 *  second instance shouldn't spawn by accident — the + menu does that),
	 *  otherwise open one in the focused leaf. */
	function openPanelTile(kind: string) {
		const existing = findPanelTab(kind);
		if (existing) applyTiles(activateTab(tiles, existing.id));
		else applyTiles(openElsewhere({ id: newTabId(), panel: kind }));
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
	/** A plan's page in the side column beside its session's chat: shown
	 *  again if open, else a new tab (one per plan, closed one by one). */
	function openPlanPage(sessionId: string, planId: string) {
		const panel = proposalPanel(sessionId, planId);
		const existing = findPanelTab(panel);
		if (existing) return applyTiles(activateTab(tiles, existing.id));
		applyTiles(openElsewhere({ id: newTabId(), panel }, { place: 'side', sessionId }));
	}
	$effect(() => {
		const request = planPages.request;
		if (!request || !tilesReady) return;
		untrack(() => openPlanPage(request.sessionId, request.planId));
	});

	/** A sidebar click: the session becomes active and its tab comes to the
	 *  front, also when it already was the active one behind another tab. */
	function showSession(id: string) {
		store.activeId = id;
		// Its tab may have been closed while it stayed the active session:
		// the effect below sees no change then.
		revealChat(id);
	}
	/** Focuses session `id`'s chat tab, opening one in the focused leaf. */
	function revealChat(id: string) {
		if (!tilesReady || !store.shownSessions.some((s) => s.id === id)) return;
		if (chatSessionsIn(tiles).includes(id)) applyTiles(activateTab(tiles, chatPanel(id)));
		else applyTiles(openChatTab(tiles, focusedLeaf, id));
		const leaf = leafOfTab(tiles.root, chatPanel(id));
		if (leaf) focusedLeaf = leaf.id;
	}

	// The workbench-active session always has a chat tile: activating a session
	// (sidebar click, ⌘N, resume, deep link…) opens or focuses it.
	$effect(() => {
		const id = store.activeId;
		if (!tilesReady || !id || id === shownNowhere) return;
		shownNowhere = '';
		untrack(() => revealChat(id));
	});

	// Chat tiles of closed (or hidden) sessions disappear with them, and a
	// removed project's page with the project.
	$effect(() => {
		const ids = new Set(store.shownSessions.map((s) => s.id));
		const projectIds = new Set(store.projects.map((p) => p.id));
		if (!tilesReady) return;
		untrack(() => {
			let next = tiles;
			for (const sid of chatSessionsIn(next)) if (!ids.has(sid)) next = closeTab(next, chatPanel(sid));
			for (const tab of leavesOf(next.root).flatMap((l) => l.tabs)) {
				const pid = projectOf(tab.panel);
				if (pid && !projectIds.has(pid)) next = closeTab(next, tab.id);
			}
			applyTiles(next);
		});
	});

	// Opening a page in the embedded browser (agent tool / element pick / typed
	// URL) must reveal the browser tile, or the webview has nowhere to render.
	$effect(() => {
		if (browser.openSignal === 0) return;
		untrack(() => {
			if (tilesReady) openPanelTile('browser');
		});
	});

	// The audit pane (CodeMirror diff review) is a singleton tile driven by
	// editorStore.visible: ⌘E / chat file links / quick-open reveal it, its own
	// close button (and closing the tab, via applyTiles) hides it.
	$effect(() => {
		const want = editorStore.visible;
		if (!tilesReady) return;
		untrack(() => {
			const existing = findPanelTab('audit');
			if (want && !existing) applyTiles(openElsewhere({ id: newTabId(), panel: 'audit' }));
			else if (want && existing) applyTiles(activateTab(tiles, existing.id));
			else if (!want && existing) applyTiles(closeTab(tiles, existing.id));
		});
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
			!!taskDialogFor ||
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
			tilesReady = false; // gate the tile effects during the swap
			for (const p of [...store.projects]) store.detachProject(p);
			store.loaded = false; // re-gate the persist effect during the swap
			await store.restore(entry.projects, entry.loose);
			if (gen !== wsGen) return;
			initTiles();
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
	const wsAlerts = $derived(
		workspaceAlerts(
			workspaces.workspaces,
			workspaces.activeId,
			new Set(daemonState.actions.map((a) => a.session_id)),
			new Set(finishedInBack)
		)
	);

	async function switchWorkspace(id: string) {
		if (id === workspaces.activeId || wsBusy) return;
		workspaces.updateProjects(store.serialize(), store.serializeLoose());
		const entry = workspaces.setActive(id);
		if (!entry) return;
		await swapToWorkspace(entry);
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
	async function newWorkspace() {
		if (wsBusy) return;
		const entry = workspaces.create(t('shell.workspace.nth', { n: workspaces.workspaces.length + 1 }));
		if (entry) await switchWorkspace(entry.id);
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

	// ---------- session tab chrome (color / icon / rename) ----------
	// One shared popover serves the mosaic tabs and the sidebar rows.
	// `tab` is set when opened from a mosaic tab: the menu then offers 关闭其他/全部.
	let sessionChromeFor = $state<{ sid: string; x: number; y: number; tab?: string } | null>(null);
	const chromeSession = $derived(sessionChromeFor ? (sessionById(sessionChromeFor.sid) ?? null) : null);

	function tileChrome(tab: TileTab): { color?: string; icon?: TabIcon } | null {
		const pid = projectOf(tab.panel);
		if (pid) {
			const p = store.projects.find((x) => x.id === pid);
			return { color: p?.color, icon: p?.icon ?? { kind: 'builtin', id: 'folder' } };
		}
		const sid = chatSessionOf(tab.panel);
		const s = sid ? sessionById(sid) : null;
		if (!s || (!s.color && !s.icon)) return null;
		return { color: s.color, icon: s.icon };
	}
	/** Open the popover for a tab (context menu / dblclick). Chat and
	 *  project tabs get their chrome editor; other tabs only the close
	 *  actions, and only on right-click. */
	let tabMenuFor = $state<{ tab: string; label: string; x: number; y: number } | null>(null);
	function openTileChrome(tab: TileTab, ev: MouseEvent) {
		const pid = projectOf(tab.panel);
		const p = pid ? store.projects.find((x) => x.id === pid) : undefined;
		if (p) return openProjectMenu(p, ev, tab.id);
		const sid = chatSessionOf(tab.panel);
		if (sid && sessionById(sid)) {
			ev.preventDefault();
			sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY, tab: tab.id };
			return;
		}
		if (ev.type !== 'contextmenu') return;
		ev.preventDefault();
		tabMenuFor = { tab: tab.id, label: tileLabel(tab), x: ev.clientX, y: ev.clientY };
	}
	/** The popover's close actions for a tab (none when opened elsewhere). */
	function tabCloseActions(tab: string | undefined, dismiss: () => void) {
		if (!tab) return {};
		const leaf = leafOfTab(tiles.root, tab);
		return {
			onCloseOthers: leaf && leaf.tabs.length > 1 ? () => (dismiss(), closeTabGroup(tab, true)) : undefined,
			onCloseAll: () => (dismiss(), closeTabGroup(tab, false))
		};
	}
	/** 关闭其他 / 关闭全部: the other tabs (or all) of the tab's own group. */
	function closeTabGroup(tabId: string, keep: boolean) {
		const leaf = leafOfTab(tiles.root, tabId);
		if (!leaf) return;
		let next = tiles;
		for (const tab of leaf.tabs) if (!keep || tab.id !== tabId) next = closeTab(next, tab.id);
		onMosaicChange(next);
	}
	function openSessionMenu(sid: string, ev: MouseEvent) {
		if (!!!sessionById(sid)) return;
		ev.preventDefault();
		sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY };
	}
	// The same popover colours a sidebar project folder and sets its icon.
	let projectChromeFor = $state<{ id: string; x: number; y: number; tab?: string } | null>(null);
	const chromeProject = $derived(projectChromeFor ? (projects.find((p) => p.id === projectChromeFor!.id) ?? null) : null);
	function openProjectMenu(p: Project, ev: MouseEvent, tab?: string) {
		ev.preventDefault();
		projectChromeFor = { id: p.id, x: ev.clientX, y: ev.clientY, tab };
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
	function moveProjectToWorkspace(p: Project, wsId: string) {
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
		toast.info(t('shell.workspace.moved', { name: p.name, ws: target.name }));
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
		store.removeSession(id);
	}

	// ---------- 并行任务（git worktree） ----------
	/** 把任务 worktree 作为项目打开（已在列表中则聚焦），可携带首条消息（任务描述）。 */
	function openTaskProject(path: string, meta: WorktreeMeta, description = '') {
		taskDialogFor = null;
		const requirement = taskRequirement?.id;
		taskRequirement = null;
		const existing = store.projects.find((p) => normPath(p.path) === normPath(path));
		if (existing) {
			store.activeId = existing.sessions[0]?.id ?? store.addSession(existing);
			return;
		}
		// Started on a requirement: the description goes with its start (the
		// start card), not as a first message.
		const project = store.createProject(path, meta, (!requirement && description) || undefined);
		const first = project.sessions[0];
		if (requirement && first) {
			first.requirement = requirement;
			first.requirementStart = { plan: first.chat.approvalMode === 'plan', ...(description ? { text: description } : {}) };
		}
		if (requirement) showDesk = false;
	}
	/** 任务清理完成（worktree 已删除）后，把对应项目从侧边栏移除。 */
	function closeTaskProject(path: string) {
		const p = store.projects.find((x) => normPath(x.path) === normPath(path));
		if (p) store.removeProject(p);
	}
	/** 打开「新建并行任务」对话框；worktree 项目上则回落到其主仓库项目。 */
	function newTask(p: Project | undefined) {
		if (!p) return;
		if (p.worktree) {
			const main = store.projects.find((x) => normPath(x.path) === normPath(p.worktree!.mainRepoPath));
			taskDialogFor = main ?? { ...p, path: p.worktree.mainRepoPath, name: base(p.worktree.mainRepoPath) };
			return;
		}
		taskDialogFor = p;
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
		if (matches(e, 'captureRequirement'))
			return act(() => {
				openRequirements();
				captureSignal += 1;
			});
		if (matches(e, 'find') && chat) return act(() => pane?.toggleFind());
		if (matches(e, 'newSession')) return act(() => activeProject && newSession(activeProject));
		if (matches(e, 'settings')) return act(() => !showSettings && openSettings());
		if (matches(e, 'sidebar')) return act(toggleSidebar);
		if (matches(e, 'audit')) return act(toggleAudit);
		if (matches(e, 'quickOpen')) return act(() => activeProject && (showQuickOpen = !showQuickOpen));
		if (matches(e, 'terminal')) return act(() => openPanelTile('terminal'));
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
				if (newPlan && newPlan !== lastPlan && newPlan.kind === 'plan' && (newPlan.status === 'drafting' || newPlan.status === 'pending') && tilesReady && chatSessionsIn(tiles).includes(s.id))
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
				requirements.handle(frame);
				devServers.handle(frame);
			};
			daemon.onDisconnect = () => {
				daemonState.disconnected();
				sync.reset();
				devServers.disconnected();
			};
			daemon.onHello = (version) => {
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
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type === 'drop')
					for (const p of e.payload.paths) panes.get(store.activeId)?.addAttachment(p);
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
			// 托盘菜单「新建会话」：在当前项目（或第一个项目）里开新会话。
			const untray = await listen('tray-new-session', () => {
				const p = store.activeProject ?? store.shownProjects[0];
				if (p) newSession(p);
			});
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
			if (disposed) {
				cleanups.forEach((f) => f());
				return;
			}
			// Restore the active workspace's projects + their open conversations
			// (resume by id), or seed a default project on first run — then build
			// the canvas from the persisted layout.
			await store.restore(wsEntry.projects, wsEntry.loose);
			initTiles();
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

<svelte:window onkeydown={onWindowKey} />

<!-- A chat tab's status, the same marks as its sidebar row. -->
{#snippet tabMark(tab: TileTab)}
	{@const sid = chatSessionOf(tab.panel)}
	{@const s = sid ? sessionById(sid) : undefined}
	{#if s}<SessionMark status={sessionStatus(s.chat)} />{/if}
{/snippet}

<Toaster />
{#if zoomNote}
	<div class="zoom-note" role="status" transition:fade={{ duration: 160 }}>{Math.round(prefs.zoom * 100)}%</div>
{/if}
<CornerNotices />
<ConfirmHost />

<div class="app">
	<!-- TOP: one title bar across the window (traffic lights, sidebar toggle,
	     the title of what is in front centred on the window, panel actions). -->
	<TitleBar
		sidebarOpen={showSidebar}
		onToggleSidebar={toggleSidebar}
		title={showSettings ? t('settings.title') : showDesk ? t('shell.desk.title') : shownProject ? shownProject.name : (active?.chat.title ?? '')}
		subtitle={showSettings || showDesk || shownProject ? '' : (activeProject?.name ?? '')}
		addOptions={showSettings || showDesk ? [] : addOptions}
		onAdd={(key) => mosaicAdd(focusedLeaf, key)}
	>
		{#snippet actions()}
			{@const editorPath = showSettings || showDesk ? undefined : shownProject ? shownProject.path : activeProject && !activeProject.chats && !activeProject.stale ? activeCwd : undefined}
			{#if editorPath}<OpenInEditor path={editorPath} />{/if}
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
			alerts={wsAlerts}
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
		<div class="panel" class:covered={showSettings || showDesk}>
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
				onNewSession={(p) => newSession(p)}
				onNewChat={() => store.newChat()}
				onCloseSession={removeSession}
				onCloseProject={removeProject}
				onArchiveSession={(id) => store.archiveSession(id)}
				onUnarchiveSession={(id) => store.unarchiveSession(id)}
				onPinSession={(id, pinned) => store.setPinned(id, pinned)}
				onMoveSession={(id, target, after) => store.moveSession(id, target, after)}
				onMoveProject={(id, target, after) => store.moveProject(id, target, after)}
				onMoveProjectToWorkspace={(id, ws) => {
					const p = store.workspaceProjects.find((x) => x.id === id);
					if (p) moveProjectToWorkspace(p, ws);
				}}
				onRenameSession={(id, title) => store.renameSession(id, title)}
				onSessionMenu={openSessionMenu}
				onProjectMenu={openProjectMenu}
				onHistory={(p) => store.openHistory(p)}
				pendingCount={daemonState.actions.length + yourTurnCount}
				onDesk={() => openDesk()}
			/>
			<div class="resizer side" class:hidden={!showSidebar} role="separator" aria-label="resize sidebar" onpointerdown={startSidebarResize}></div>

			<!-- THE CANVAS: workspace tabs on top, one mosaic for chats, tool panels,
			     TUI and audit tiles below. -->
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
						<Mosaic
							layout={tiles}
							onchange={onMosaicChange}
							label={tileLabel}
							{addOptions}
							onAdd={mosaicAdd}
							barAdd={false}
							emptyText={t('dock.dock.empty')}
							emptyHint={t('dock.dock.hint')}
							focused={focusedLeaf}
							onFocus={onLeafFocus}
							decorate={tileChrome}
							{tabMark}
							onTabContext={openTileChrome}
							onTabRename={openTileChrome}
						>
								{#snippet panel(tab)}
								{@const sid = chatSessionOf(tab.panel)}
								{@const tui = tuiBackendOf(tab.panel)}
								{#if sid}
									{@const sess = sessionById(sid)}
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
													isActive={sid === activeId && !showSettings && !showDesk}
													onRegister={registerPane}
													onUnregister={unregisterPane}
													onOpenSettings={openSettings}
													onOpenRequirement={openRequirements}
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
								{:else if projectOf(tab.panel)}
									{@const project = store.projects.find((p) => p.id === projectOf(tab.panel))}
									{#if project}
										<ProjectPage
											{project}
											projects={workspaceProjects}
											{currentStep}
											onDirs={(dirs) => store.setProjectDirs(project, dirs)}
											onStartRequirement={startRequirement}
											onOpenSession={(s) => openDaemonSession(s)}
										/>
									{/if}
								{:else if tab.panel === 'plan'}<PlanPanel plan={chat?.plan ?? []} />
								{:else if proposalOf(tab.panel)}
									{@const p = proposalOf(tab.panel)!}
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
								{:else if tab.panel === 'goal'}<GoalPanel goal={chat?.goal ?? null} />
								{:else if tab.panel === 'files'}<FilesPanel rootDir={activeCwd ?? ''} />
								{:else if tab.panel === 'git'}<GitPanel cwd={activeCwd ?? ''} worktree={activeProject?.worktree ?? null} llm={llmTarget} onOpenTask={(path, meta) => openTaskProject(path, meta)} onTaskRemoved={closeTaskProject} />
								{:else if tab.panel === 'term'}<TerminalPanel cwd={activeCwd ?? ''} />
								{:else if tab.panel === 'browser'}<BrowserPanel />
								{:else if tab.panel === 'audit'}<EditorPane onAiSend={sendAiEdit} />
								{:else if tui}<TuiPanel backend={tui} cwd={activeCwd ?? ''} onOpenSettings={() => openSettings('agents')} />
								{/if}
							{/snippet}
						</Mosaic>
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
					bind:requirementId={deskRequirement}
					projects={workspaceProjects}
					currentProject={activeProject?.loose ? undefined : activeProject?.id}
					{captureSignal}
					{currentStep}
					onStartRequirement={startRequirement}
					navWidth={sidebarWidth}
					onClose={() => (showDesk = false)}
					onOpenSession={openDaemonSession}
				/>
			{/if}
		</div>
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

	{#if taskDialogFor}
		<TaskDialog
			project={taskDialogFor}
			name={taskRequirement?.name}
			onClose={() => ((taskDialogFor = null), (taskRequirement = null))}
			onCreated={openTaskProject}
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
			{...tabCloseActions(sessionChromeFor.tab, () => (sessionChromeFor = null))}
			onClose={() => (sessionChromeFor = null)}
		/>
	{/if}

	{#if tabMenuFor}
		<TabChromePopover
			x={tabMenuFor.x}
			y={tabMenuFor.y}
			name={tabMenuFor.label}
			{...tabCloseActions(tabMenuFor.tab, () => (tabMenuFor = null))}
			onClose={() => (tabMenuFor = null)}
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
			{...tabCloseActions(projectChromeFor.tab, () => (projectChromeFor = null))}
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

	{#if showPalette}
		<CommandPalette
			{chat}
			hasProject={!!activeProject}
			canNewTask={!!activeProject && !activeProject.stale && !activeProject.loose}
			panelOptions={panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`) }))}
			onClose={() => (showPalette = false)}
			onRun={runCommand}
			onNewSession={() => activeProject && newSession(activeProject)}
			onNewProject={addProject}
			onNewTask={() => newTask(activeProject)}
			onSettings={() => openSettings()}
			onMarket={() => (showMarket = true)}
			onOpenPanel={openPanelTile}
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
		flex: 1;
		display: flex;
		min-height: 0;
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
		flex: 1;
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.stage > :global(.mosaic) {
		flex: 1;
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
