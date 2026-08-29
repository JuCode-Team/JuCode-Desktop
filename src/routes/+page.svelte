<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { PanelRight, PanelLeft } from 'lucide-svelte';
	import { open, ask, message } from '@tauri-apps/plugin-dialog';
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
		type EventPayload
	} from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import { caps, type BackendId } from '$lib/backends';
	import { tuiOpen } from '$lib/tuiOpen.svelte';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { updater } from '$lib/updater.svelte';
	import { browser, type WebRef } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { t } from '$lib/i18n';
	import { SessionStore } from '$lib/session.svelte';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import {
		deserializeLayout,
		emptyLayout,
		findLeaf,
		leafOfTab,
		leavesOf,
		serializeLayout,
		type SerializedLayout,
		type TileLayout,
		type TileTab
	} from '$lib/workbench/tiles';
	import {
		chatSessionOf,
		chatTabId,
		ensureChatTab,
		pruneChatTabs,
		remapChatTabs
	} from '$lib/workbench/chatTabs';
	import type { WorkspaceEntry } from '$lib/workbench/workspaces';
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import ChatPane from '$lib/ChatPane.svelte';
	import Settings from '$lib/Settings.svelte';
	import Setup from '$lib/Setup.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import RightDock from '$lib/RightDock.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import TaskDialog from '$lib/TaskDialog.svelte';
	import type { Project, WorktreeMeta } from '$lib/types';
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
	let settingsInitial = $state<'overview' | 'account' | 'behavior'>('overview');
	let showMarket = $state(false);
	let showSetup = $state(false);
	let showPalette = $state(false);
	// 「新建并行任务」对话框：为哪个（主仓库）项目开任务。
	let taskDialogFor = $state<Project | null>(null);

	// New-session flow: create the session immediately with the project's
	// last-used backend (falling back to the settings default) — the composer's
	// backend selector lets the user switch until the first message is sent.
	function newSessionFlow(p: Project) {
		store.addSession(p);
	}

	function refreshAuth() {
		readAuthProviders()
			.then((p) => (providers = p))
			.catch(() => {});
	}

	// All configured providers (builtin + custom) with their models, so the in-chat
	// model picker can list every provider's models — not just the active one's.
	let providersList = $state<
		{ id: string; base_url: string; format: string; models: { name: string; context_window?: number; reasoning_efforts?: string[] }[] }[]
	>([]);
	function loadProviders() {
		listProviders()
			.then((bs) => {
				let custom: typeof providersList = [];
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
	let showRight = $state(false);
	let rightWidth = $state(340);
	let sidebarWidth = $state(248);
	let showSidebar = $state(true);
	let sbResizing = $state(false);
	let resizing = $state(false);
	let winW = $state(1200);
	// Audit pane: a CodeMirror diff/review split right of the chat column.
	// Hidden by default — it only opens on user interaction (clicking a changed
	// file, a chat file link, ⌘P quick-open, or ⌘E on the current change).
	let showQuickOpen = $state(false);
	let editorWidth = $state(560);
	let editorResizing = $state(false);

	// Auto-collapse the right dock when the window gets too narrow for a comfortable
	// chat column, and restore it when there's room again. Keyed only on width
	// (via untrack) so it never fights a manual toggle.
	const NARROW = 960;
	let autoCollapsedRight = false;
	$effect(() => {
		const narrow = winW < NARROW;
		untrack(() => {
			if (narrow && showRight) {
				showRight = false;
				autoCollapsedRight = true;
			} else if (!narrow && autoCollapsedRight && !showRight) {
				showRight = true;
				autoCollapsedRight = false;
			}
		});
	});
	// A manual toggle is authoritative — clear the auto-collapse intent so the
	// responsive effect won't later override the user's choice.
	function toggleRight() {
		showRight = !showRight;
		autoCollapsedRight = false;
	}

	// "Open TUI" (command palette): signal RightDock to add/activate the tab
	// and make sure the dock it lives in is actually visible.
	function openTui(backend: BackendId) {
		tuiOpen.open(backend);
		showRight = true;
		autoCollapsedRight = false;
	}

	function toggleSidebar() {
		showSidebar = !showSidebar;
		localStorage.setItem('jucode-sidebar-visible', showSidebar ? '1' : '0');
	}

	// Opening a page in the embedded browser (agent tool / element pick / typed
	// URL) must reveal the right dock, or the webview has nowhere to render.
	$effect(() => {
		if (browser.openSignal === 0) return;
		untrack(() => {
			showRight = true;
			autoCollapsedRight = false;
		});
	});

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

	function startSidebarResize(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startW = sidebarWidth;
		sbResizing = true;
		const move = (ev: PointerEvent) => {
			sidebarWidth = Math.min(420, Math.max(190, startW + (ev.clientX - startX)));
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

	function startResize(e: PointerEvent) {
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startW = rightWidth;
		const move = (ev: PointerEvent) => {
			rightWidth = Math.min(640, Math.max(260, startW + (startX - ev.clientX)));
		};
		const up = () => {
			resizing = false;
			localStorage.setItem('jucode-right-width', String(rightWidth));
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function startEditorResize(e: PointerEvent) {
		e.preventDefault();
		editorResizing = true;
		const startX = e.clientX;
		const startW = editorWidth;
		const move = (ev: PointerEvent) => {
			const max = Math.max(360, winW - sidebarWidth - (showRight ? rightWidth : 0) - 420);
			editorWidth = Math.min(max, Math.max(360, startW + (startX - ev.clientX)));
		};
		const up = () => {
			editorResizing = false;
			localStorage.setItem('jucode-editor-width', String(editorWidth));
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// The editor confines opens / resolves relative engine paths against the
	// active project's root.
	$effect(() => {
		if (activeProject) editorStore.root = activeProject.path;
	});

	// ⌘E audits the current change instead of opening a blank IDE: it reveals
	// the audit pane on the session's most recently changed file (or re-shows /
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

	// ⌘K in the editor: forward the structured instruction to the focused
	// session's pane. Returns false when there's no live session to receive it.
	function sendAiEdit(content: string): boolean {
		return paneRefs[store.activeId]?.sendUserMessage(content) ?? false;
	}

	// Open a workspace file referenced from the dock (turn timeline). HTML opens
	// in the built-in browser (rendered) or the editor (source) per preference;
	// everything else opens in the editor. Paths resolve against the active
	// project root. (Chat links use the same logic inside each ChatPane.)
	function openChatFile(href: string) {
		const cwd = activeProject?.path;
		if (!cwd) return;
		const rel = href.replace(/^file:\/\//, '').split(/[?#]/)[0].trim();
		if (!rel) return;
		const abs = rel.startsWith('/') ? rel : `${cwd.replace(/\/+$/, '')}/${rel.replace(/^\.?\//, '')}`;
		const ext = abs.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
		if ((ext === 'html' || ext === 'htm') && prefs.htmlOpenInBrowser) {
			browser.open(`file://${abs}`);
		} else {
			editorStore.open(abs, cwd).catch((e) => console.error('open chat file', e));
		}
	}

	// ---------- main session mosaic ----------
	// The center of the app is a tile layout whose tabs are chat sessions
	// (`chat:<sessionId>`): drag a session tab to a pane edge to see two
	// conversations side by side, drop on the center to stack, double-click a
	// tab bar to maximize. The layout is workspace state: persisted (under the
	// engines' session ids) in workspaces.json next to the dock layout.
	let mainTiles = $state<TileLayout>(emptyLayout());
	let mainLoaded = $state(false);
	// The focused leaf: sidebar clicks and new sessions open their tab here.
	let focusedLeaf = $state<string | null>(null);
	const multiPane = $derived(leavesOf(mainTiles.root).length > 1);

	type PaneHandle = {
		addAttachment: (path: string) => void;
		addWebRef: (ref: WebRef) => void;
		sendCommand: (cmd: string) => void;
		sendUserMessage: (content: string) => boolean;
	};
	let paneRefs = $state<Record<string, PaneHandle | null | undefined>>({});

	const mainLabel = (tab: TileTab): string => {
		const sid = chatSessionOf(tab.id);
		const s = sid ? sessionMap.get(sid) : undefined;
		return s?.chat.title || t('shell.untitled');
	};

	function validFocusedLeaf(): string | null {
		return focusedLeaf && findLeaf(mainTiles.root, focusedLeaf) ? focusedLeaf : null;
	}

	/** Serialize the live layout under engine session ids (runtime ids are
	 *  regenerated every launch). Sessions that can't be resumed drop out —
	 *  same rule as the sidebar tab persistence. */
	function currentMainSerialized(): SerializedLayout {
		return serializeLayout(
			remapChatTabs(mainTiles, (rid) => {
				const s = sessionMap.get(rid);
				if (!s) return null;
				if (s.chat.resumable && s.chat.sessionId) return s.chat.sessionId;
				return s.restoredFrom ?? null;
			})
		);
	}

	/** Load (or migrate) the workspace's main layout once its sessions are
	 *  restored: persisted `chat:<engine sid>` tabs map onto the freshly
	 *  restored runtime sessions; a file without a usable layout (pre-mosaic
	 *  install, fresh workspace) seeds one leaf with the active session. */
	function initMainTiles(entry: WorkspaceEntry) {
		const bySid = new Map<string, string>();
		for (const s of store.allSessions) {
			const sid = s.restoredFrom ?? (s.chat.resumable ? s.chat.sessionId : '');
			if (sid && !bySid.has(sid)) bySid.set(sid, s.id);
		}
		const parsed = deserializeLayout(entry.main ?? null);
		let layout = parsed ? remapChatTabs(parsed, (sid) => bySid.get(sid) ?? null) : emptyLayout();
		if (!layout.root && store.activeId) layout = ensureChatTab(layout, store.activeId, null);
		mainTiles = layout;
		const activeLeaf = store.activeId ? leafOfTab(layout.root, chatTabId(store.activeId)) : null;
		focusedLeaf = activeLeaf?.id ?? leavesOf(layout.root)[0]?.id ?? null;
		mainLoaded = true;
	}

	/** Layout change reported by the Mosaic (tab click / drag / split / close /
	 *  resize / maximize). Focus follows the interaction: the leaf whose active
	 *  tab changed (or a freshly created leaf) becomes the focused leaf and its
	 *  session becomes the active one — dock/goal/shortcuts follow it. */
	function handleMainChange(next: TileLayout) {
		const prev = mainTiles;
		mainTiles = next;
		const prevLeaves = new Map(leavesOf(prev.root).map((l) => [l.id, l]));
		let focus: { id: string; active: string } | null = null;
		for (const leaf of leavesOf(next.root)) {
			const old = prevLeaves.get(leaf.id);
			if (!old) {
				focus = leaf;
				break;
			}
			if (old.active !== leaf.active) focus = leaf;
		}
		if (focus) {
			focusedLeaf = focus.id;
			const sid = chatSessionOf(focus.active);
			if (sid && sessionMap.has(sid)) store.activeId = sid;
		}
		if (focusedLeaf && !findLeaf(next.root, focusedLeaf)) {
			focusedLeaf = leavesOf(next.root)[0]?.id ?? null;
		}
		// The active session's tab was closed (tab removed ≠ session closed —
		// it stays in the sidebar): hand focus to what's visible in its place.
		if (store.activeId && !leafOfTab(next.root, chatTabId(store.activeId))) {
			const fallback =
				(focusedLeaf && findLeaf(next.root, focusedLeaf)) ?? leavesOf(next.root)[0] ?? null;
			const sid = fallback ? chatSessionOf(fallback.active) : null;
			if (sid && sessionMap.has(sid)) store.activeId = sid;
		}
	}

	/** A pane was clicked: it becomes the focused leaf + active session. */
	function focusPane(tabId: string) {
		const leaf = leafOfTab(mainTiles.root, tabId);
		if (leaf) focusedLeaf = leaf.id;
		const sid = chatSessionOf(tabId);
		if (sid && sessionMap.has(sid)) store.activeId = sid;
	}

	/** Sidebar click: activate the session's existing tab (wherever it lives),
	 *  or open one in the focused leaf. */
	function selectSession(id: string) {
		store.activeId = id;
		if (!mainLoaded) return;
		const next = ensureChatTab(mainTiles, id, validFocusedLeaf());
		if (next !== mainTiles) mainTiles = next;
		focusedLeaf = leafOfTab(mainTiles.root, chatTabId(id))?.id ?? focusedLeaf;
	}

	/** The + menu / empty-state button: a new session opens in that leaf. */
	function mainAdd(leafId: string | null, _key: string) {
		const p = activeProject ?? projects[0];
		if (!p) {
			addProject();
			return;
		}
		if (leafId) focusedLeaf = leafId;
		store.addSession(p);
	}

	// Every path that activates a session (new session, restore, deep link,
	// tray, palette, history picker…) funnels through store.activeId — make
	// sure the active session always has a visible, active tab.
	$effect(() => {
		const id = store.activeId;
		if (!mainLoaded || !id) return;
		untrack(() => {
			const next = ensureChatTab(mainTiles, id, validFocusedLeaf());
			if (next !== mainTiles) mainTiles = next;
			focusedLeaf = leafOfTab(mainTiles.root, chatTabId(id))?.id ?? focusedLeaf;
		});
	});

	// Sessions that closed or were archived lose their tab (emptied leaves
	// collapse). The reverse is NOT true: closing a tab keeps the session —
	// it stays in the sidebar and can be re-opened from there.
	$effect(() => {
		if (!mainLoaded) return;
		const live = new Set(allSessions.filter((s) => !s.archived).map((s) => s.id));
		untrack(() => {
			const next = pruneChatTabs(mainTiles, (sid) => live.has(sid));
			if (next !== mainTiles) {
				mainTiles = next;
				if (focusedLeaf && !findLeaf(next.root, focusedLeaf)) {
					focusedLeaf = leavesOf(next.root)[0]?.id ?? null;
				}
			}
		});
	});

	// Persist the project layout + open tabs (engine session id + title) and
	// the main tile layout into the active workspace (app-data file, not
	// localStorage) whenever they change. Gated on `loaded` so it can't clobber
	// the saved data before the initial restore has run; untracked writes so
	// the effect only follows the session tree + layout.
	$effect(() => {
		if (!store.loaded) return;
		const saved = store.serialize();
		untrack(() => workspaces.updateProjects(saved));
		if (mainLoaded) {
			void mainTiles;
			untrack(() => workspaces.updateMain(currentMainSerialized()));
		}
	});

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

	const project = $derived(activeProject?.name ?? (chat?.cwd ? base(chat.cwd) : 'workspace'));
	const loggedIn = $derived(!!chat?.provider && providers.includes(chat.provider));

	// ---------- workspaces ----------
	// A workspace is a saved set of projects + tile layouts. Switching swaps the
	// whole session tree: snapshot the current one into its workspace, close all
	// live engine sessions, then restore the target's projects (resume by id).
	async function switchWorkspace(id: string) {
		if (id === workspaces.activeId) return;
		workspaces.updateProjects(store.serialize());
		if (mainLoaded) workspaces.updateMain(currentMainSerialized());
		const entry = workspaces.setActive(id);
		if (!entry) return;
		mainLoaded = false; // gate the layout effects during the swap
		mainTiles = emptyLayout();
		focusedLeaf = null;
		for (const p of [...store.projects]) store.removeProject(p);
		store.loaded = false; // re-gate the persist effect during the swap
		await store.restore(entry.projects);
		initMainTiles(entry);
	}
	async function newWorkspace() {
		const entry = workspaces.create(t('shell.workspace.nth', { n: workspaces.workspaces.length + 1 }));
		if (entry) await switchWorkspace(entry.id);
	}

	async function addProject() {
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		store.createProject(path);
	}
	async function removeProject(p: Project) {
		if (p.sessions.length) {
			const ok = await ask(t('shell.closeProjectConfirm', { name: p.name, count: p.sessions.length }), {
				title: t('shell.closeProjectTitle'),
				kind: 'warning'
			});
			if (!ok) return;
		}
		// Best-effort dirty-tab guard: closing a project with unsaved editor
		// buffers under its root discards them — confirm first.
		const projRoot = p.path.replace(/\/+$/, '');
		const dirtyTabs = editorStore.tabs.filter((tb) => tb.dirty && tb.path.startsWith(projRoot + '/'));
		if (dirtyTabs.length) {
			const ok = await ask(t('editor.dirtyProjectConfirm'), {
				title: t('editor.unsavedTitle'),
				kind: 'warning'
			});
			if (!ok) return;
			for (const tb of dirtyTabs) editorStore.close(tb.path, true);
		}
		store.removeProject(p);
	}
	// Run a command in the focused session (command palette → its pane, which
	// owns the backend-specific quirks like claude's /resume).
	function nav(command: string) {
		const pane = paneRefs[store.activeId];
		if (pane) pane.sendCommand(command);
		else if (activeId) dispatch(activeId, { op: 'command', input: command });
	}

	// ---------- 并行任务（git worktree） ----------
	/** 把任务 worktree 作为项目打开（已在列表中则聚焦），可携带首条消息（任务描述）。 */
	function openTaskProject(path: string, meta: WorktreeMeta, description = '') {
		taskDialogFor = null;
		const existing = store.projects.find((p) => normPath(p.path) === normPath(path));
		if (existing) {
			selectSession(existing.sessions[0]?.id ?? store.addSession(existing));
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
			if (focusSession) selectSession(existing.sessions[0]?.id ?? store.addSession(existing));
			return existing;
		}
		// 目录存在才创建项目（listDir 失败说明路径无效/不可访问）。
		try {
			await listDir(path, path); // confine to itself: just an existence check
		} catch {
			await message(t('shell.deepLinkBadPath', { path }), { title: 'JuCode', kind: 'error' });
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
			store.respawnClaudeYolo(sid);
			return;
		}
		dispatch(sid, { op: 'set_approval_mode', mode });
	}

	function onWindowKey(e: KeyboardEvent) {
		// Something closer to the target already claimed this key (e.g. the code
		// editor's own ⌘K / ⌘S keymap, or the focused pane's find/picker keys) —
		// never double-fire an app shortcut on it.
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
		if (!mod) return;
		if (e.key === 'n') {
			e.preventDefault();
			if (activeProject) store.addSession(activeProject);
		} else if (e.key === ',') {
			e.preventDefault();
			showSettings = true;
		} else if (e.key === 'b') {
			e.preventDefault();
			toggleRight();
		} else if (e.key === 'e') {
			e.preventDefault();
			toggleAudit();
		} else if (e.key === 'p') {
			e.preventDefault();
			if (activeProject) showQuickOpen = !showQuickOpen;
		}
	}

	onMount(() => {
		const savedW = Number(localStorage.getItem('jucode-right-width'));
		if (savedW >= 260 && savedW <= 640) rightWidth = savedW;
		const savedSb = Number(localStorage.getItem('jucode-sidebar-width'));
		if (savedSb >= 190 && savedSb <= 420) sidebarWidth = savedSb;
		if (localStorage.getItem('jucode-sidebar-visible') === '0') showSidebar = false;
		const savedEd = Number(localStorage.getItem('jucode-editor-width'));
		if (savedEd >= 360 && savedEd <= 1400) editorWidth = savedEd;
		const cleanups: Array<() => void> = [];
		let disposed = false;
		(async () => {
			// Load the workspaces file first (migrating a pre-workspace
			// localStorage layout on first run): it has no dependency on the
			// event listeners below, and the sidebar switcher can show early.
			const wsEntry = await workspaces.load(t('shell.workspace.default'));
			const unlisten = await listen<EventPayload>('agent-event', (e) => {
				const s = sessionMap.get(e.payload.session);
				if (!s) return;
				const wasBusy = s.chat.busy;
				// Capture the raw frame for the diagnostics trace so a mis-parsed or
				// dropped tool frame is inspectable after the fact.
				s.chat.captureFrame(e.payload.data);
				// Route the raw line through the session's backend adapter; jucode's is
				// the identity, codex/claude translate to the jucode dialect. Parse,
				// translate and each handle() are isolated so one bad frame or event
				// can't silently drop the sibling events that follow it (e.g. a tool's
				// completion riding in the same frame as something that threw).
				let frame: unknown;
				try {
					frame = JSON.parse(e.payload.data);
				} catch (err) {
					console.error('[agent-event] JSON parse failed', err, e.payload.data.slice(0, 300));
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
				// so the done-notification targets the right session after tab switches.
				const curActive = store.activeId;
				if (wasBusy && !s.chat.busy && s.id !== curActive) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
			});
			const unexit = await listen<string>('agent-exit', (e) => store.handleExit(e.payload));
			// Dropped files attach to the focused session's composer.
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type !== 'drop') return;
				const pane = paneRefs[store.activeId];
				if (pane) for (const p of e.payload.paths) pane.addAttachment(p);
			});
			// Embedded-browser events: element picks become composer chips in the
			// focused pane; nav/state updates flow into the browser store.
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
					paneRefs[store.activeId]?.addWebRef(ref);
				} else {
					browser.handleEvent(p);
				}
			});
			// 托盘菜单「新建会话」：在当前项目（或第一个项目）里开新会话。
			const untray = await listen('tray-new-session', () => {
				const p = store.activeProject ?? store.projects[0];
				if (p) store.addSession(p);
			});
			cleanups.push(unlisten, unexit, undrop, unbrowser, untray);
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
			// (resume by id), or seed a default project on first run — then map
			// the persisted session mosaic onto the restored sessions.
			await store.restore(wsEntry.projects);
			initMainTiles(wsEntry);
			// 深链在项目恢复完成后再注册，冷启动携带的链接（onOpenUrl 会补发当前
			// 深链）才能作用于已恢复的项目列表。
			const undeep = await onOpenUrl((urls) => {
				for (const u of urls) handleDeepLink(u);
			});
			cleanups.push(undeep);
			// 启动约 5 秒后静默检查一次更新；有新版本时设置入口显示小圆点。
			const updateTimer = setTimeout(() => updater.check(true), 5000);
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

<svelte:window onkeydown={onWindowKey} bind:innerWidth={winW} />

<div class="app">
	<!-- Sits right of the macOS traffic lights, above everything: toggles the session list. -->
	<button class="sb-toggle" class:on={showSidebar} onclick={toggleSidebar} aria-label="toggle sidebar" title={t('shell.toggleSidebar')}>
		<PanelLeft size={16} />
	</button>
	<!-- LEFT: navigation + sessions -->
	<Sidebar
		{projects}
		{activeId}
		width={showSidebar ? sidebarWidth : 0}
		resizing={sbResizing}
		{loggedIn}
		providerName={chat?.provider ?? ''}
		updateAvailable={updater.available}
		workspaceList={workspaces.workspaces.map((w) => ({ id: w.id, name: w.name }))}
		activeWorkspace={workspaces.activeId}
		onSwitchWorkspace={switchWorkspace}
		onNewWorkspace={newWorkspace}
		onSelect={selectSession}
		onNewProject={addProject}
		onNewTask={newTask}
		onNewSession={(p) => newSessionFlow(p)}
		onCloseSession={(id) => store.removeSession(id)}
		onCloseProject={removeProject}
		onArchiveSession={(id) => store.archiveSession(id)}
		onUnarchiveSession={(id) => store.unarchiveSession(id)}
		onHistory={(p) => store.openHistory(p)}
		onSettings={() => (showSettings = true)}
	/>
	<div class="resizer side" class:hidden={!showSidebar} role="separator" aria-label="resize sidebar" onpointerdown={startSidebarResize}></div>

	<!-- CENTER: the session mosaic — each tile is a full chat session -->
	<div class="center">
		{#if chat}
			<header data-tauri-drag-region class:shifted={!showSidebar}>
				<div class="htitle" data-tauri-drag-region>
					<span class="hname">{chat.title}</span>
					<span class="hcrumb">{project}</span>
				</div>
				<div class="hspace" data-tauri-drag-region></div>
				<button class="hicon" class:on={showRight} onclick={toggleRight} aria-label="toggle panel" title={t('shell.togglePanel')}><PanelRight size={16} /></button>
			</header>
		{/if}

		{#if allSessions.length}
			<div class="tiles">
				<Mosaic
					layout={mainTiles}
					onchange={handleMainChange}
					label={mainLabel}
					addOptions={[{ key: 'new-session', label: t('shell.newSession') }]}
					onAdd={mainAdd}
					emptyText={t('shell.mosaic.empty')}
				>
					{#snippet panel(tab)}
						{@const sid = chatSessionOf(tab.id)}
						{@const s = sid ? sessionMap.get(sid) : undefined}
						{#if s}
							<ChatPane
								bind:this={paneRefs[s.id]}
								{store}
								session={s}
								project={projects.find((p) => p.sessions.some((x) => x.id === s.id))}
								active={s.id === activeId}
								highlight={multiPane}
								{providers}
								{providersList}
								onFocus={() => focusPane(tab.id)}
							/>
						{/if}
					{/snippet}
				</Mosaic>
			</div>
		{:else}
			<div class="nochat" data-tauri-drag-region>
				<p class="welcome-tip">{t('shell.noChat')}</p>
				<Button variant="primary" size="sm" onclick={addProject}>{t('shell.startFromProject')}</Button>
			</div>
		{/if}
	</div>

	<!-- AUDIT: diff/review split right of the chat; hidden until the user opens a file -->
	{#if editorStore.visible}
		<div class="resizer" role="separator" aria-label="resize editor" onpointerdown={startEditorResize}></div>
		<section class="editor-pane" class:resizing={editorResizing} style:width="{editorWidth}px" aria-label={t('editor.title')}>
			<EditorPane onAiSend={sendAiEdit} />
		</section>
	{/if}

	<!-- RIGHT: goal progress -->
	<div class="resizer" class:hidden={!showRight} role="separator" aria-label="resize panel" onpointerdown={startResize}></div>
	<aside class="right" class:closed={!showRight} class:resizing style:width={showRight ? `${rightWidth}px` : '0px'}>
		<div class="right-inner" style:width="{rightWidth}px">
			<RightDock
				goalsEnabled={caps(chat).goals}
				goal={chat?.goal ?? null}
				plan={chat?.plan ?? []}
				cwd={activeProject?.path ?? ''}
				changed={chat?.changedFiles ?? []}
				turns={chat?.turnTimeline ?? []}
				{chat}
				worktree={activeProject?.worktree ?? null}
				llm={llmTarget}
				onRevertFile={(p) => chat && (chat.changedFiles = chat.changedFiles.filter((x) => x !== p))}
				onOpenFile={openChatFile}
				onOpenTask={(path, meta) => openTaskProject(path, meta)}
				onTaskRemoved={closeTaskProject}
				onOpenSettings={() => {
					settingsInitial = 'behavior';
					showSettings = true;
				}}
			/>
		</div>
	</aside>

	{#if showSettings}
		<Settings sessionId={activeId} {chat} initialSection={settingsInitial} onAuthChange={refreshAuth} onMarket={() => { showSettings = false; showMarket = true; }} onClose={() => { showSettings = false; settingsInitial = 'overview'; loadProviders(); }} />
	{/if}

	{#if showMarket}
		<Marketplace backend={active?.backendId ?? 'jucode'} onClose={() => (showMarket = false)} />
	{/if}

	{#if showSetup && activeId}
		<Setup
			sessionId={activeId}
			{loggedIn}
			onRefreshAuth={refreshAuth}
			onOpenSettings={() => {
				localStorage.setItem('jucode-setup-done', '1');
				showSetup = false;
				settingsInitial = 'account';
				showSettings = true;
			}}
			onClose={() => (showSetup = false)}
		/>
	{/if}

	{#if showQuickOpen && activeProject}
		{@const qoRoot = activeProject.path}
		<QuickOpen
			root={qoRoot}
			onClose={() => (showQuickOpen = false)}
			onOpen={(rel) => {
				showQuickOpen = false;
				editorStore.open(rel, qoRoot).catch((e) => message(String(e), { title: 'JuCode', kind: 'error' }));
			}}
		/>
	{/if}

	{#if taskDialogFor}
		<TaskDialog project={taskDialogFor} onClose={() => (taskDialogFor = null)} onCreated={openTaskProject} />
	{/if}

	{#if showPalette}
		<CommandPalette
			{chat}
			hasProject={!!activeProject}
			canNewTask={!!activeProject && !activeProject.stale}
			onClose={() => (showPalette = false)}
			onRun={(cmd) => nav(cmd)}
			onNewSession={() => activeProject && newSessionFlow(activeProject)}
			onNewProject={addProject}
			onNewTask={() => newTask(activeProject)}
			onSettings={() => (showSettings = true)}
			onMarket={() => (showMarket = true)}
			onTogglePanel={toggleRight}
			onToggleTheme={cycleTheme}
			onSetup={() => (showSetup = true)}
			onOpenTui={openTui}
		/>
	{/if}
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}
	/* Session-list toggle, pinned right of the macOS traffic lights. Centered on
	 * their measured macOS 26 metrics: 13.5pt circles with centerline at
	 * y≈15.75pt, green light's right edge at x≈68.5pt, 9.5pt gaps between
	 * lights — so top + height/2 ≈ 15.75, and left continues the lights' gap. */
	.sb-toggle {
		position: fixed;
		top: 2.75px;
		left: 78px;
		z-index: 30;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.sb-toggle:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.sb-toggle:active {
		transform: scale(0.9);
	}
	/* Windows/Linux have a native title bar and no traffic lights, so drop the
	 * macOS traffic-light offsets: sit the toggle at the sidebar's content edge,
	 * vertically level with the chat header's right-hand toggle. */
	:global(:root[data-os='windows']) .sb-toggle,
	:global(:root[data-os='linux']) .sb-toggle {
		top: 18px;
		left: 14px;
	}

	/* ---------- center ---------- */
	.center {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg);
		position: relative;
	}
	/* The session mosaic fills everything under the header. */
	.tiles {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.tiles > :global(.mosaic) {
		flex: 1;
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid var(--hairline);
		transition: padding-left var(--t-med) var(--ease-out);
	}
	/* Sidebar hidden → the traffic lights + sidebar toggle overlay the header;
	   shift the title clear of them. */
	header.shifted {
		padding-left: 122px;
	}
	/* Windows/Linux: no traffic lights, so only the toggle overlays the header. */
	:global(:root[data-os='windows']) header.shifted,
	:global(:root[data-os='linux']) header.shifted {
		padding-left: 52px;
	}
	.htitle {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.hname {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 240px;
	}
	.hcrumb {
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.hspace {
		flex: 1;
	}
	.hicon {
		display: inline-flex;
		padding: 7px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.hicon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.hicon:active {
		transform: scale(0.9);
	}
	.hicon.on {
		color: var(--accent-bright);
	}

	.welcome-tip {
		margin: 0;
		font-size: 14px;
		color: var(--dim);
	}
	.nochat {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}
	/* ---------- editor split ---------- */
	.editor-pane {
		flex-shrink: 0;
		min-width: 0;
		border-left: 1px solid var(--hairline);
		overflow: hidden;
	}
	.editor-pane.resizing {
		user-select: none;
	}

	/* ---------- right ---------- */
	.resizer {
		width: 5px;
		flex-shrink: 0;
		cursor: col-resize;
		background: transparent;
		margin-left: -3px;
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
	.right {
		flex-shrink: 0;
		min-width: 0;
		/* Opaque so the macOS vibrancy behind the transparent webview only shows in
		   the sidebar, never through the dock (incl. during the width transition). */
		background: var(--bg);
		border-left: 1px solid var(--hairline);
		overflow: hidden;
		transition: width var(--t-med) var(--ease-out);
	}
	.right.resizing {
		transition: none;
	}
	.right.closed {
		border-left: none;
	}
	.right-inner {
		height: 100%;
	}
</style>
