<script lang="ts">
	import { DaemonSync } from '$lib/daemonSync.svelte';
	import { onMount, untrack } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
	import SessionMark from '$lib/SessionMark.svelte';
	import { sessionStatus } from '$lib/sessionStatus';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import TargetIcon from 'phosphor-svelte/lib/TargetIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import FilesIcon from 'phosphor-svelte/lib/FilesIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import PulseIcon from 'phosphor-svelte/lib/PulseIcon';
	import Toaster from '$lib/ui/Toaster.svelte';
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
	import { dispatch } from '$lib/backends/router';
	import { caps } from '$lib/backends';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { updater } from '$lib/updater.svelte';
	import { browser, type WebRef } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { t } from '$lib/i18n';
	import { SessionStore } from '$lib/session.svelte';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import {
		activateTab,
		closeTab,
		emptyLayout,
		findLeaf,
		leafOfTab,
		leavesOf,
		openTab,
		serializeLayout,
		type TileLayout,
		type TileTab
	} from '$lib/workbench/tiles';
	import {
		chatPanel,
		chatSessionOf,
		chatSessionsIn,
		openChatTab,
		reconcileLayout
	} from '$lib/workbench/canvas';
	import { tuiBackendOf, tuiTabTitle } from '$lib/workbench/tuiTab';
	import { canHandOffToTui, isValidResumeSessionId, tuiResumeArgs, tuiResumeCommand } from '$lib/tuiHandoff';
	import type { WorkspaceEntry } from '$lib/workbench/workspaces';
	import type { TabIcon } from '$lib/workbench/tabChrome';
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import WorkspaceRail from '$lib/workbench/WorkspaceRail.svelte';
	import TitleBar from '$lib/shell/TitleBar.svelte';
	import TabChromePopover from '$lib/workbench/TabChromePopover.svelte';
	import ChatPane, { type ChatPaneApi, type ProviderOption } from '$lib/ChatPane.svelte';
	import SettingsPage from '$lib/settings/SettingsPage.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import Setup from '$lib/Setup.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import TaskDialog from '$lib/TaskDialog.svelte';
	import AgentDialog from '$lib/AgentDialog.svelte';
	import Desk from '$lib/Desk.svelte';
	import AgentPage from '$lib/AgentPage.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import type { Project, WorktreeMeta } from '$lib/types';
	import PlanPanel from '$lib/PlanPanel.svelte';
	import GoalPanel from '$lib/GoalPanel.svelte';
	import ChangesPanel from '$lib/ChangesPanel.svelte';
	import TurnsPanel from '$lib/TurnsPanel.svelte';
	import FilesPanel from '$lib/FilesPanel.svelte';
	import GitPanel from '$lib/GitPanel.svelte';
	import TerminalPanel from '$lib/TerminalPanel.svelte';
	import BrowserPanel from '$lib/BrowserPanel.svelte';
	import DiagnosticsPanel from '$lib/DiagnosticsPanel.svelte';
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
	const activeId = $derived(store.activeId);
	// O(1) session lookup for the hot agent-event path (fires per stream chunk),
	// instead of an O(n) allSessions.find on every event.
	const sessionMap = $derived(new Map(allSessions.map((s) => [s.id, s])));

	let providers = $state<string[]>([]);

	async function notifyDone(title: string) {
		try {
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (granted) sendNotification({ title: 'JuCode', body: t('shell.notifyDone', { title: title || t('shell.untitled') }) });
		} catch {
			/* ignore */
		}
	}
	let showSettings = $state(false);
	let settingsSection = $state<SectionKey>('general');
	function openSettings(section: SectionKey = 'general') {
		settingsSection = section;
		showSettings = true;
	}
	function closeSettings() {
		showSettings = false;
		loadProviders();
	}
	let showMarket = $state(false);
	let showSetup = $state(false);
	let showPalette = $state(false);
	// 「新建并行任务」对话框：为哪个（主仓库）项目开任务。
	let taskDialogFor = $state<Project | null>(null);
	let showAgentDialog = $state(false);
	let showDesk = $state(false);
	let agentPageFor = $state<string | null>(null);

	/** Show a daemon session in a tab: an agent's, or a plain hosted one. */
	function openDaemonSession(session: string) {
		const agent = agentDirectory.agentOfSession(session);
		const cwd = agentDirectory.sessions.find((s) => s.session === session)?.cwd ?? '';
		store.openAgentSession(agent ?? { id: '', name: cwd.split('/').pop() || session, cwd }, session);
		showDesk = false;
		agentPageFor = null;
	}
	let showQuickOpen = $state(false);

	function refreshAuth() {
		readAuthProviders()
			.then((p) => (providers = p))
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
	/** Width of the workspace rail (WorkspaceRail.svelte); the title bar aligns the title past it. */
	const RAIL_WIDTH = 68;
	let showSidebar = $state(true);
	let sbResizing = $state(false);

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

	const ALL_PANELS = ['plan', 'goal', 'changes', 'turns', 'files', 'git', 'term', 'browser', 'diag'] as const;
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
		plan: ListChecksIcon, goal: TargetIcon, changes: GitDiffIcon, turns: ClockCounterClockwiseIcon,
		files: FilesIcon, git: GitBranchIcon, term: TerminalWindowIcon, browser: GlobeIcon, diag: PulseIcon
	};
	const addOptions = $derived([
		{ key: 'chat', label: t('shell.agentSession'), icon: PlusIcon, primary: true },
		...panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`), icon: PANEL_ICONS[k] }))
	]);

	function tileLabel(tab: TileTab): string {
		const sid = chatSessionOf(tab.panel);
		if (sid) return sessionMap.get(sid)?.chat.title || t('shell.untitled');
		const tui = tuiBackendOf(tab.panel);
		if (tui) return tuiTabTitle(tui);
		if (tab.panel === 'audit') return t('editor.title');
		return (ALL_PANELS as readonly string[]).includes(tab.panel) ? t(`dock.tabs.${tab.panel}`) : tab.panel;
	}
	function tuiReady(sid: string): boolean {
		const session = sessionMap.get(sid);
		return !!session &&
			isValidResumeSessionId(session.chat.sessionId) &&
			(session.chat.resumable || !!session.restored) &&
			!session.chat.switching;
	}

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
		tiles = next;
		if (tilesReady) workspaces.updateLayout(serializeLayout(next));
		if (editorStore.visible && !findPanelTab('audit')) editorStore.visible = false;
	}

	/** Build the canvas for the current workspace: reconcile the persisted
	 *  layout with this run's sessions (migrating old dock-only layouts by
	 *  grafting a chat leaf) and focus the active session's tile. */
	function initTiles() {
		tiles = reconcileLayout(
			workspaces.active?.layout ?? null,
			allSessions.map((s) => s.id),
			store.activeId || null
		);
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
		if (sid && sid !== store.activeId && sessionMap.has(sid)) store.activeId = sid;
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
			const p = activeProject ?? projects[0];
			if (!p) return;
			if (leafId) focusedLeaf = leafId;
			store.addSession(p); // the activeId effect opens its tile in the focused leaf
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
		applyTiles(openTab(tiles, leafId ?? focusedLeaf, { id: newTabId(), panel: key }));
	}

	/** Palette / signals: re-activate an existing tab of this panel kind (a
	 *  second instance shouldn't spawn by accident — the + menu does that),
	 *  otherwise open one in the focused leaf. */
	function openPanelTile(kind: string) {
		const existing = findPanelTab(kind);
		if (existing) applyTiles(activateTab(tiles, existing.id));
		else applyTiles(openTab(tiles, focusedLeaf, { id: newTabId(), panel: kind }));
	}

	// The workbench-active session always has a chat tile: activating a session
	// (sidebar click, ⌘N, resume, deep link…) opens or focuses it.
	$effect(() => {
		const id = store.activeId;
		if (!tilesReady || !id) return;
		untrack(() => {
			if (chatSessionsIn(tiles).includes(id)) applyTiles(activateTab(tiles, chatPanel(id)));
			else applyTiles(openChatTab(tiles, focusedLeaf, id));
			const leaf = leafOfTab(tiles.root, chatPanel(id));
			if (leaf) focusedLeaf = leaf.id;
		});
	});

	// Chat tiles of closed sessions disappear with them.
	$effect(() => {
		const ids = new Set(allSessions.map((s) => s.id));
		if (!tilesReady) return;
		untrack(() => {
			let next = tiles;
			for (const sid of chatSessionsIn(next)) if (!ids.has(sid)) next = closeTab(next, chatPanel(sid));
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
			if (want && !existing) applyTiles(openTab(tiles, focusedLeaf, { id: newTabId(), panel: 'audit' }));
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
		if (activeProject) editorStore.root = activeProject.path;
	});

	// ⌘E audits the current change instead of opening a blank IDE: it reveals
	// the audit tile on the session's most recently changed file (or re-shows /
	// hides files already under review). With nothing changed and nothing open
	// it does nothing — the pane has no empty-editor mode.
	function toggleAudit() {
		if (editorStore.visible) {
			editorStore.visible = false;
			return;
		}
		if (editorStore.tabs.length) {
			editorStore.visible = true;
			return;
		}
		const cwd = activeProject?.path;
		const changed = chat?.changedFiles ?? [];
		if (!cwd || !changed.length) return;
		editorStore.open(changed[changed.length - 1], cwd).catch((e) => console.error('open audit', e));
	}

	// ⌘K in the editor: forward the structured instruction to the active session
	// engine. Returns false when there's no live session to receive it.
	function sendAiEdit(content: string): boolean {
		const c = chat;
		if (!c || c.engineState === 'exited') return false;
		if (!c.busy) {
			// Snapshot the working tree before the turn (codex/claude rewinds
			// restore files from it; jucode checkpoints engine-side).
			const cwd = activeProject?.path;
			if (cwd && (c.backendId === 'codex' || c.backendId === 'claude')) {
				const idx = c.userTurns;
				gitCheckpointCapture(cwd)
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
		untrack(() => workspaces.updateProjects(saved));
	});

	// One list of projects and sessions with the daemon (and so with paired
	// devices): the desktop's edits go to it, other clients' come back.
	const sync = new DaemonSync(store, workspaces);
	$effect(() => {
		if (!store.loaded || wsBusy) return;
		void sync.local();
		// Coalesce bursts of edits (a restore, a drag) into one save.
		const timer = setTimeout(() => sync.push(), 600);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		const list = agentDirectory.sessions;
		void workspaces.activeId;
		if (!store.loaded || wsBusy) return;
		untrack(() => sync.reconcile(list));
	});
	// A session listed from the daemon opens when it is first shown.
	$effect(() => {
		const s = store.active;
		if (s?.dormant) untrack(() => store.wake(s.id));
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
	// workspace, close all live engine sessions, then restore the target's
	// projects (resume by id) and rebuild the canvas. Swaps must never
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
			for (const p of [...store.projects]) store.removeProject(p);
			store.loaded = false; // re-gate the persist effect during the swap
			await store.restore(entry.projects);
			if (gen !== wsGen) return;
			initTiles();
		} finally {
			if (gen === wsGen) wsBusy = false;
		}
	}
	async function switchWorkspace(id: string) {
		if (id === workspaces.activeId || wsBusy) return;
		workspaces.updateProjects(store.serialize());
		const entry = workspaces.setActive(id);
		if (!entry) return;
		await swapToWorkspace(entry);
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
	let sessionChromeFor = $state<{ sid: string; x: number; y: number } | null>(null);
	const chromeSession = $derived(sessionChromeFor ? (sessionMap.get(sessionChromeFor.sid) ?? null) : null);

	function tileChrome(tab: TileTab): { color?: string; icon?: TabIcon } | null {
		const sid = chatSessionOf(tab.panel);
		const s = sid ? sessionMap.get(sid) : null;
		if (!s || (!s.color && !s.icon)) return null;
		return { color: s.color, icon: s.icon };
	}
	/** Open the chrome popover for a chat tab (context menu / dblclick).
	 *  Tool/TUI/audit tabs have no chrome and keep their default behavior. */
	function openTileChrome(tab: TileTab, ev: MouseEvent) {
		const sid = chatSessionOf(tab.panel);
		if (!sid || !sessionMap.has(sid)) return;
		ev.preventDefault();
		sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY };
	}
	function openSessionMenu(sid: string, ev: MouseEvent) {
		if (!sessionMap.has(sid)) return;
		ev.preventDefault();
		sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY };
	}

	async function addProject() {
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		store.createProject(path);
	}
	async function removeProject(p: Project) {
		if (p.sessions.length) {
			const ok = await confirm({
				title: t('shell.closeProjectTitle'),
				message: t('shell.closeProjectConfirm', { name: p.name, count: p.sessions.length }),
				confirmLabel: t('shell.closeProjectTitle'),
				danger: true
			});
			if (!ok) return;
		}
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

	// ---------- 并行任务（git worktree） ----------
	/** 把任务 worktree 作为项目打开（已在列表中则聚焦），可携带首条消息（任务描述）。 */
	function openTaskProject(path: string, meta: WorktreeMeta, description = '') {
		taskDialogFor = null;
		const existing = store.projects.find((p) => normPath(p.path) === normPath(path));
		if (existing) {
			store.activeId = existing.sessions[0]?.id ?? store.addSession(existing);
			return;
		}
		store.createProject(path, meta, description || undefined);
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
			const proj = projectPath ? await openProjectPath(projectPath, false) : (activeProject ?? projects[0]);
			if (!proj) return;
			// 恢复的会话开在新标签里，不覆盖当前会话。
			store.activeId = store.restoreSession(proj, sid, '');
		}
	}

	// Open a workspace file referenced by a tool panel (e.g. the turns list).
	// HTML opens in the built-in browser (rendered) or the editor (source) per
	// preference; everything else opens in the editor. Paths resolve relative
	// to the active project root (chat links resolve inside their own pane).
	function openActiveFile(href: string) {
		const cwd = activeProject?.path;
		if (!cwd) return;
		const rel = href.replace(/^file:\/\//, '').split(/[?#]/)[0].trim();
		if (!rel) return;
		const abs = rel.startsWith('/') ? rel : `${cwd.replace(/\/+$/, '')}/${rel.replace(/^\.?\//, '')}`;
		const ext = abs.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
		if ((ext === 'html' || ext === 'htm') && prefs.htmlOpenInBrowser) {
			browser.open(`file://${abs}`);
		} else {
			editorStore.open(abs, cwd).catch((e) => console.error('open file', e));
		}
	}

	function onWindowKey(e: KeyboardEvent) {
		// Something closer to the target already claimed this key (e.g. the code
		// editor's own ⌘K / ⌘S keymap, or a pane's picker) — never double-fire.
		if (e.defaultPrevented) return;
		// The setup wizard is a blocking first-run modal — don't fire app shortcuts
		// under it (e.g. Cmd+K opening the palette behind it).
		if (showSetup) return;
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key === 'k') {
			e.preventDefault();
			showPalette = !showPalette;
			return;
		}
		if (mod && e.key === 'f' && chat) {
			e.preventDefault();
			panes.get(activeId)?.toggleFind();
			return;
		}
		if (!mod) return;
		if (e.key === 'n') {
			e.preventDefault();
			if (activeProject) store.addSession(activeProject);
		} else if (e.key === ',') {
			e.preventDefault();
			if (!showSettings) openSettings();
		} else if (e.key === 'b') {
			e.preventDefault();
			toggleSidebar();
		} else if (e.key === 'e') {
			e.preventDefault();
			toggleAudit();
		} else if (e.key === 'p') {
			e.preventDefault();
			if (activeProject) showQuickOpen = !showQuickOpen;
		}
	}

	onMount(() => {
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
				const s = sessionMap.get(sessionId);
				if (!s) return;
				const wasBusy = s.chat.busy;
				// Capture the raw frame for the diagnostics trace so a mis-parsed or
				// dropped tool frame is inspectable after the fact.
				s.chat.captureFrame(data);
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
				// Read the current active session at call time (store.activeId is
				// reactive) — not a value snapshotted when the listener was mounted —
				// so unseen/notification target the right session after tab switches.
				const curActive = store.activeId;
				if (wasBusy && !s.chat.busy && s.id !== curActive) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
				// This session's tile (if any) sticks to the bottom while streaming.
				panes.get(s.id)?.scrollToEnd();
			};
			daemon.onFrame = deliver;
			daemon.onExit = (id) => store.handleExit(id);
			daemon.onEvent = (frame) => {
				agentDirectory.handle(frame);
				sync.handle(frame);
			};
			daemon.onDisconnect = () => agentDirectory.disconnected();
			// The client outlives this page: release the sessions it claimed for
			// this page's tabs when the page goes (see detachAll).
			cleanups.push(() => daemon.detachAll());
			agentDirectory.start();
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
				const p = store.activeProject ?? store.projects[0];
				if (p) store.addSession(p);
			});
			cleanups.push(undrop, unbrowser, untray);
			// The agent's browser_open tool navigates the embedded browser.
			ChatState.onBrowserOpen = (url) => browser.open(url);
			cleanups.push(() => (ChatState.onBrowserOpen = null));
			// Successful edit-tool completions auto-reload matching editor tabs
			// (and resolve pending ⌘K AI edits).
			ChatState.onFilesEdited = (paths) => editorStore.handleEngineEdit(paths);
			cleanups.push(() => (ChatState.onFilesEdited = null));
			if (disposed) {
				cleanups.forEach((f) => f());
				return;
			}
			// Restore the active workspace's projects + their open conversations
			// (resume by id), or seed a default project on first run — then build
			// the canvas from the persisted layout.
			await store.restore(wsEntry.projects);
			initTiles();
			// 深链在项目恢复完成后再注册，冷启动携带的链接（onOpenUrl 会补发当前
			// 深链）才能作用于已恢复的项目列表。
			const undeep = await onOpenUrl((urls) => {
				for (const u of urls) handleDeepLink(u);
			});
			cleanups.push(undeep);
			// Check GitHub after startup and install updates; relaunch stays user-controlled.
			const updateTimer = setTimeout(() => updater.check(true, true), 5000);
			cleanups.push(() => clearTimeout(updateTimer));
			loadProviders();
			readAuthProviders()
				.then((p) => {
					providers = p;
					// First run: show the setup wizard only when nothing is configured yet
					// (a genuinely fresh machine). Pre-configured users skip it silently.
					if (!localStorage.getItem('jucode-setup-done')) {
						if (p.length > 0) localStorage.setItem('jucode-setup-done', '1');
						else showSetup = true;
					}
				})
				.catch(() => {});
		})();
		return () => {
			disposed = true;
			cleanups.forEach((f) => f());
		};
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<!-- A chat tab's status, the same marks as its sidebar row. -->
{#snippet tabMark(tab: TileTab)}
	{@const sid = chatSessionOf(tab.panel)}
	{@const s = sid ? sessionMap.get(sid) : undefined}
	{#if s}<SessionMark status={sessionStatus(s.chat)} compact />{/if}
{/snippet}

<Toaster />
<ConfirmHost />

<div class="app">
	<!-- TOP: one title bar across the window (traffic lights, sidebar toggle,
	     the title of what is in front aligned with the canvas, panel actions). -->
	<TitleBar
		leftWidth={RAIL_WIDTH + (showSettings || showSidebar ? sidebarWidth : 0)}
		resizing={sbResizing}
		sidebarOpen={showSidebar}
		onToggleSidebar={toggleSidebar}
		title={showSettings ? t('settings.title') : (active?.chat.title ?? '')}
		subtitle={showSettings ? '' : (activeProject?.name ?? '')}
		addOptions={showSettings ? [] : addOptions}
		onAdd={(key) => mosaicAdd(focusedLeaf, key)}
	>
		{#snippet actions()}
			{#if !showSettings && active && active.surface !== 'tui' && canHandOffToTui(active.backendId)}
				<button
					class="tile-action"
					disabled={!tuiReady(active.id)}
					title={tuiReady(active.id) ? t('chat.tuiContinueTitle') : t('chat.tuiContinueUnavailable')}
					aria-label={t('chat.tuiContinue')}
					onclick={() => active && store.openInTui(active.id)}
				>
					<TerminalWindowIcon size={16} />
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
			onSwitch={switchWorkspace}
			onNew={newWorkspace}
			onRename={(id, name) => workspaces.rename(id, name)}
			onChrome={(id, chrome) => workspaces.setChrome(id, chrome)}
			onDelete={deleteWorkspace}
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
		<div class="panel" class:covered={showSettings}>
			<!-- LEFT: the navigator — workspace / projects / sessions. Clicking a session
			     opens or focuses its chat tile on the canvas. -->
			<Sidebar
				{projects}
				{activeId}
				width={showSidebar ? sidebarWidth : 0}
				resizing={sbResizing}
				onSelect={(id) => (store.activeId = id)}
				onNewProject={addProject}
				onNewTask={newTask}
				onNewSession={(p) => store.addSession(p)}
				onNewChat={() => store.newChat()}
				onCloseSession={(id) => store.removeSession(id)}
				onCloseProject={removeProject}
				onArchiveSession={(id) => store.archiveSession(id)}
				onUnarchiveSession={(id) => store.unarchiveSession(id)}
				onRenameSession={(id, title) => store.renameSession(id, title)}
				onSessionMenu={openSessionMenu}
				onHistory={(p) => store.openHistory(p)}
				agents={agentDirectory.agents}
				agentsStatus={agentDirectory.status}
				onOpenAgent={(a) => store.openAgentSession(a, agentDirectory.latestSession(a.id)?.session)}
				onNewAgent={() => (showAgentDialog = true)}
				onAgentPage={(a) => (agentPageFor = a.id)}
				pendingCount={agentDirectory.pending}
				onDesk={() => (showDesk = true)}
			/>
			<div class="resizer side" class:hidden={!showSidebar} role="separator" aria-label="resize sidebar" onpointerdown={startSidebarResize}></div>

			<!-- THE CANVAS: workspace tabs on top, one mosaic for chats, tool panels,
			     TUI and audit tiles below. -->
			<div class="canvas">

				<div class="stage">
					{#if store.loaded && projects.length === 0}
						<div class="nochat" data-tauri-drag-region>
							<span class="welcome-mark">JuCode</span>
							<p class="welcome-tip">{t('shell.noChat')}</p>
							<div class="welcome-actions">
								<Button variant="primary" size="sm" onclick={addProject}>{t('shell.startFromProject')}</Button>
								<Button size="sm" onclick={() => store.newChat()}>{t('shell.startChat')}</Button>
							</div>
						</div>
					{:else}
						<Mosaic
							hideSoloBar
							layout={tiles}
							onchange={onMosaicChange}
							label={tileLabel}
							{addOptions}
							onAdd={mosaicAdd}
							emptyText={t('dock.dock.empty')}
							emptyHint={t('dock.dock.hint')}
							focused={focusedLeaf}
							onFocus={onLeafFocus}
							decorate={tileChrome}
							{tabMark}
							onTabContext={openTileChrome}
							onTabRename={openTileChrome}
						>
								{#snippet actions(tab)}
									{@const sid = chatSessionOf(tab.panel)}
									{@const session = sid ? sessionMap.get(sid) : undefined}
									{#if sid && session && session.surface !== 'tui' && canHandOffToTui(session.backendId)}
										<button
											class="tile-action"
											disabled={!tuiReady(sid)}
											title={tuiReady(sid) ? t('chat.tuiContinueTitle') : t('chat.tuiContinueUnavailable')}
											aria-label={t('chat.tuiContinue')}
											onclick={() => store.openInTui(sid)}
										>
											<TerminalWindowIcon size={13} />
										</button>
									{/if}
								{/snippet}
								{#snippet panel(tab)}
								{@const sid = chatSessionOf(tab.panel)}
								{@const tui = tuiBackendOf(tab.panel)}
								{#if sid}
									{@const sess = sessionMap.get(sid)}
									{#if sess}
										{#if sess.surface === 'tui'}
											<!-- Session handoff: the same chat tile renders the native TUI
											     resuming this conversation by id (never a standalone tui:* tab). -->
											<TuiPanel
												backend={sess.backendId}
												cwd={store.projectPathOf(sid) ?? ''}
												args={tuiResumeArgs(sess.backendId, sess.chat.sessionId)}
												resumeCommand={tuiResumeCommand(sess.backendId, sess.chat.sessionId)}
												onBackToGui={() => store.returnToGui(sid)}
												onOpenSettings={() => openSettings('agents')}
											/>
										{:else}
											<ChatPane
												session={sess}
												{store}
												{providers}
												{providersList}
												isActive={sid === activeId}
												onRegister={registerPane}
												onUnregister={unregisterPane}
												onOpenSettings={openSettings}
											/>
										{/if}
									{:else}
										<div class="gone">{t('shell.chatGone')}</div>
									{/if}
								{:else if tab.panel === 'plan'}<PlanPanel plan={chat?.plan ?? []} />
								{:else if tab.panel === 'goal'}<GoalPanel goal={chat?.goal ?? null} />
								{:else if tab.panel === 'changes'}<ChangesPanel cwd={activeProject?.path ?? ''} files={chat?.changedFiles ?? []} onRevert={(p) => chat && (chat.changedFiles = chat.changedFiles.filter((x) => x !== p))} />
								{:else if tab.panel === 'turns'}<TurnsPanel turns={chat?.turnTimeline ?? []} onOpenFile={openActiveFile} />
								{:else if tab.panel === 'files'}<FilesPanel rootDir={activeProject?.path ?? ''} />
								{:else if tab.panel === 'git'}<GitPanel cwd={activeProject?.path ?? ''} worktree={activeProject?.worktree ?? null} llm={llmTarget} onOpenTask={(path, meta) => openTaskProject(path, meta)} onTaskRemoved={closeTaskProject} />
								{:else if tab.panel === 'term'}<TerminalPanel cwd={activeProject?.path ?? ''} />
								{:else if tab.panel === 'browser'}<BrowserPanel />
								{:else if tab.panel === 'diag'}<DiagnosticsPanel chat={chat ?? null} />
								{:else if tab.panel === 'audit'}<EditorPane onAiSend={sendAiEdit} />
								{:else if tui}<TuiPanel backend={tui} cwd={activeProject?.path ?? ''} onOpenSettings={() => openSettings('agents')} />
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
					onClose={closeSettings}
				/>
			{/if}
		</div>
	</div>

	{#if showMarket}
		<Marketplace backend={active?.backendId ?? 'jucode'} onClose={() => (showMarket = false)} />
	{/if}

	{#if showSetup && activeId}
		<Setup
			sessionId={activeId}
			{chat}
			{loggedIn}
			onRefreshAuth={refreshAuth}
			onOpenSettings={() => {
				localStorage.setItem('jucode-setup-done', '1');
				showSetup = false;
				openSettings('account');
			}}
			onClose={() => (showSetup = false)}
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

	{#if showQuickOpen && activeProject}
		{@const qoRoot = activeProject.path}
		<QuickOpen
			root={qoRoot}
			onClose={() => (showQuickOpen = false)}
			onOpen={(rel) => {
				showQuickOpen = false;
				editorStore.open(rel, qoRoot).catch((e) => toast.error(String(e)));
			}}
		/>
	{/if}

	{#if taskDialogFor}
		<TaskDialog project={taskDialogFor} onClose={() => (taskDialogFor = null)} onCreated={openTaskProject} />
	{/if}

	{#if showDesk}
		<Desk onClose={() => (showDesk = false)} onOpenSession={openDaemonSession} />
	{/if}

	{#if agentPageFor}
		{@const pageAgent = agentDirectory.agents.find((a) => a.id === agentPageFor)}
		<AgentPage
			agentId={agentPageFor}
			onClose={() => (agentPageFor = null)}
			onOpenSession={openDaemonSession}
			onNewSession={() => {
				if (pageAgent) store.openAgentSession(pageAgent);
				agentPageFor = null;
			}}
		/>
	{/if}

	{#if showAgentDialog}
		<AgentDialog
			defaultDir={store.activeProject?.path ?? ''}
			onClose={() => (showAgentDialog = false)}
			onCreated={(agent) => {
				showAgentDialog = false;
				store.openAgentSession(agent);
			}}
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
			onClose={() => (sessionChromeFor = null)}
		/>
	{/if}

	{#if showPalette}
		<CommandPalette
			{chat}
			hasProject={!!activeProject}
			canNewTask={!!activeProject && !activeProject.stale}
			panelOptions={panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`) }))}
			onClose={() => (showPalette = false)}
			onRun={runCommand}
			onNewSession={() => activeProject && store.addSession(activeProject)}
			onNewProject={addProject}
			onNewTask={() => newTask(activeProject)}
			onSettings={() => openSettings()}
			onMarket={() => (showMarket = true)}
			onOpenPanel={openPanelTile}
			onToggleSidebar={toggleSidebar}
			onToggleTheme={cycleTheme}
			onSetup={() => (showSetup = true)}
		/>
	{/if}
</div>

<style>
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
		border-radius: 12px;
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
		border-top-left-radius: var(--r-lg);
		overflow: hidden;
		position: relative;
		/* No fill of its own: the sidebar (frosted under vibrancy) and the
		   canvas paint their parts. */
	}
	/* Under the settings page: hidden but mounted. The frosted settings nav is
	   translucent, so the session list must not show through it. */
	.panel.covered > :global(:not(.settings)) {
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
		border-radius: var(--r-sm);
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
</style>
