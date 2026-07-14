<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { X, Check, PanelRight, ChevronDown, ChevronUp, Search, LoaderCircle } from 'lucide-svelte';
	import { open, ask, message } from '@tauri-apps/plugin-dialog';
	import { cycleTheme } from '$lib/theme.svelte';
	import {
		isPermissionGranted,
		requestPermission,
		sendNotification
	} from '@tauri-apps/plugin-notification';
	import { ChatState } from '$lib/chat.svelte';
	import { treeRows } from '$lib/tree';
	import { buildSetApprovalModeOp, needsClaudeYoloRespawn, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import { focusTrap } from '$lib/focusTrap';
	import {
		readAuthProviders,
		listProviders,
		listDir,
		captureScreenshot,
		startScreenRecording,
		stopScreenRecording,
		processVideo,
		claudeSessions,
		type EventPayload,
		type Op
	} from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import { caps, type BackendId } from '$lib/backends';
	import BackendPicker from '$lib/shell/BackendPicker.svelte';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { updater } from '$lib/updater.svelte';
	import { browser, type WebRef } from '$lib/browser.svelte';
	import { t } from '$lib/i18n';
	import { SessionStore, type SavedProject } from '$lib/session.svelte';
	import Settings from '$lib/Settings.svelte';
	import Setup from '$lib/Setup.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import RightDock from '$lib/RightDock.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Composer from '$lib/Composer.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import StatusStrip from '$lib/composer/StatusStrip.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import TaskDialog from '$lib/TaskDialog.svelte';
	import type { Project, WorktreeMeta } from '$lib/types';
	import Picker from '$lib/shell/Picker.svelte';
	import FindBar from '$lib/shell/FindBar.svelte';
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
	// Read the saved layout synchronously, before any effect can overwrite it.
	const savedProjectsData: SavedProject[] = (() => {
		try {
			return JSON.parse(localStorage.getItem('jucode-projects') || '[]');
		} catch (e) {
			console.error('failed to restore jucode-projects', e);
			return [];
		}
	})();
	let input = $state('');
	let attachments = $state<{ path: string; image: boolean }[]>([]);
	// Videos attach as extracted keyframes (images) + a text description — the
	// engine protocol only understands image paths.
	let videos = $state<{ path: string; frames: string[]; duration: number }[]>([]);
	// Page elements picked in the embedded browser. Each pick inserts an inline
	// token ([网页元素#N:…]) into the composer text at the cursor, so the user can
	// position/reorder/delete it inline; on submit the token expands in place into
	// the full reference. Refs whose token was deleted are dropped.
	type PickedRef = WebRef & { id: number };
	let webRefs = $state<PickedRef[]>([]);
	let refSeq = 0;
	let recording = $state(false);
	let scroller = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let composerRef = $state<{ insertToken: (t: string) => void } | undefined>();
	let bottomH = $state(120);
	let atBottom = $state(true);
	let providers = $state<string[]>([]);

	// In-conversation find (⌘F). The raw input updates per keystroke; the actual
	// scan (findHits) keys off the debounced `findQuery` so the O(n) message scan
	// doesn't run on every keystroke (or every stream chunk while typing).
	let showFind = $state(false);
	let findInput = $state('');
	let findQuery = $state('');
	let findDebounce: ReturnType<typeof setTimeout> | null = null;
	function onFindInput() {
		if (findDebounce != null) clearTimeout(findDebounce);
		findDebounce = setTimeout(() => {
			findQuery = findInput;
			findDebounce = null;
		}, 220);
	}
	let findIdx = $state(0);
	let findInputEl = $state<HTMLInputElement | null>(null);
	// Picker filter (history / long lists)
	let pickerQuery = $state('');

	async function notifyDone(title: string) {
		try {
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (granted) sendNotification({ title: 'JuCode', body: t('shell.notifyDone', { title: title || t('shell.untitled') }) });
		} catch {
			/* ignore */
		}
	}
	let selIdx = $state(0);
	let showSettings = $state(false);
	let settingsInitial = $state<'overview' | 'account' | 'behavior'>('overview');
	let showMarket = $state(false);
	let showSetup = $state(false);
	let showPalette = $state(false);
	// 「新建并行任务」对话框：为哪个（主仓库）项目开任务。
	let taskDialogFor = $state<Project | null>(null);
	// 「新建会话」后端选择：为哪个项目开新会话（null = 关闭）。
	let backendPickFor = $state<Project | null>(null);

	// Ops flow through the active session's backend adapter; an unsupported op
	// (non-jucode stub backends) surfaces as an inline system notice.
	function send(op: Op) {
		// claude's /resume can't go over the wire: stream-json mode has no session
		// listing protocol, the history lives in files under ~/.claude/projects.
		// Bare /resume synthesizes the picker from the claude_sessions command; a
		// typed `/resume <id>` opens that session in a fresh tab (same flow as a
		// picker pick — the current chat is never replaced).
		if (op.op === 'command' && chat?.backendId === 'claude') {
			const input = op.input.trim();
			if (input === '/resume') {
				openClaudeHistory();
				return;
			}
			if (input.startsWith('/resume ') && activeProject) {
				const sid = input.slice('/resume '.length).trim();
				chat.closePicker();
				store.activeId = store.restoreSession(activeProject, sid, '', 'claude');
				return;
			}
		}
		if (!dispatch(activeId, op)) {
			chat?.messages.push({ kind: 'system', text: t('shell.backend.opUnsupported', { op: op.op }) });
		}
	}

	// Builds the claude /resume picker from the session files Claude Code
	// persisted for this project (claude_sessions → synthesized resume_view).
	async function openClaudeHistory() {
		const c = chat;
		const proj = activeProject;
		if (!c || !proj) return;
		try {
			const sessions = await claudeSessions(proj.path);
			c.handle({
				type: 'resume_view',
				items: sessions.map((s) => ({
					id: s.id,
					label: s.preview || s.id.slice(0, 8),
					detail: new Date(s.mtime_ms).toLocaleString(),
					active: s.id === c.sessionId
				}))
			});
		} catch (e) {
			c.messages.push({ kind: 'system', text: t('shell.backend.claudeHistoryFail', { msg: String(e) }) });
		}
	}
	// New-session flow: pick the engine backend first (default = the project's
	// last-used backend, falling back to the settings default).
	function newSessionFlow(p: Project) {
		backendPickFor = p;
	}
	function pickBackend(b: BackendId) {
		const p = backendPickFor;
		backendPickFor = null;
		if (p) store.addSession(p, undefined, b);
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
	let showRight = $state(true);
	let rightWidth = $state(340);
	let sidebarWidth = $state(248);
	let resizing = $state(false);
	let winW = $state(1200);
	// Built-in editor: a toggleable split right of the chat column (⌘E), with a
	// ⌘P quick-open picker over the project file index.
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
			!!backendPickFor ||
			// The model picker is now an in-composer popover (like effort/approval),
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
		const move = (ev: PointerEvent) => {
			sidebarWidth = Math.min(420, Math.max(190, startW + (ev.clientX - startX)));
		};
		const up = () => {
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

	function toggleEditor() {
		if (!editorStore.visible && editorStore.tabs.length === 0) {
			// Nothing open yet — go straight to quick-open instead of an empty pane.
			if (activeProject) showQuickOpen = true;
			return;
		}
		editorStore.visible = !editorStore.visible;
	}

	// ⌘K in the editor: forward the structured instruction to the active session
	// engine. Returns false when there's no live session to receive it.
	function sendAiEdit(content: string): boolean {
		if (!chat || chat.engineState === 'exited') return false;
		if (!chat.busy) chat.optimisticUser(content);
		send({ op: 'user_message', content });
		return true;
	}

	// Effort switch is debounced: reflect the pick immediately on the slider
	// (optimistic chat.effort) so the handle stays put, but only send the actual
	// `/model` command once the user settles — rapid drags/clicks don't race a
	// half-dozen switches through the engine.
	let effortTimer: ReturnType<typeof setTimeout> | undefined;
	function chooseEffort(ef: string) {
		if (!chat) return;
		chat.effort = ef;
		const model = chat.model;
		clearTimeout(effortTimer);
		effortTimer = setTimeout(() => {
			if (chat) send({ op: 'command', input: `/model ${model} ${ef}` });
		}, 350);
	}

	// Open the model picker as a popover. If we already have a cached catalog,
	// show it instantly and refresh in the background; otherwise fetch first.
	function openModelPicker() {
		if (!chat) return;
		if (chat.modelCatalog.length) {
			chat.picker = {
				kind: 'model',
				models: chat.modelCatalog,
				activeEffort: chat.modelCatalogEffort || chat.effort
			};
			const act = chat.modelCatalog.findIndex((m) => m.active);
			selIdx = act >= 0 ? act : 0;
		}
		nav('/model');
	}

	// The assistant message that's still streaming: render it as plain text and
	// only run markdown/highlight once the turn finishes (avoids reparsing the
	// whole message on every token).
	// The streaming block is the LAST message (deltas append to the tail). Scanning
	// backwards would wrongly latch onto a previous turn's reply before this turn's
	// message exists, re-animating it on send.
	const streamingMsg = $derived.by(() => {
		if (!chat?.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'assistant' ? last : null;
	});
	// The reasoning block currently receiving deltas — rendered with the
	// line-by-line streaming animation (others render as static markdown).
	const streamingReasoning = $derived.by(() => {
		if (!chat?.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'reasoning' && !last.collapsed ? last : null;
	});
	const loggedIn = $derived(!!chat?.provider && providers.includes(chat.provider));

	// Message indices in the active chat matching the find query, and the current one.
	const findHits = $derived.by(() => {
		if (!showFind || !chat) return [];
		const q = findQuery.trim().toLowerCase();
		if (!q) return [];
		const hits: number[] = [];
		chat.messages.forEach((m, i) => {
			const text = m.kind === 'tool' ? `${m.name} ${m.output}` : 'text' in m ? m.text : '';
			if (text.toLowerCase().includes(q)) hits.push(i);
		});
		return hits;
	});
	const findActive = $derived(findHits.length ? findHits[Math.min(findIdx, findHits.length - 1)] : null);
	$effect(() => {
		findQuery;
		findIdx = 0;
	});

	// Persist the project layout + open tabs (engine session id + title) whenever
	// they change. Gated on `loaded` so it can't clobber the saved data before the
	// initial restore has run.
	$effect(() => {
		if (!store.loaded) return;
		localStorage.setItem('jucode-projects', JSON.stringify(store.serialize()));
	});

	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	// Engine subagent lifecycle status → localized label (falls back to the raw value).
	// 'done' is an alias of 'completed'.
	const AGENT_STATUS_KEY: Record<string, string> = {
		started: 'started',
		running: 'running',
		completed: 'completed',
		done: 'completed',
		interrupted: 'interrupted',
		closed: 'closed'
	};
	const agentStatus = (s: string) => (AGENT_STATUS_KEY[s] ? t(`shell.agentStatus.${AGENT_STATUS_KEY[s]}`) : s);

	const project = $derived(activeProject?.name ?? (chat?.cwd ? base(chat.cwd) : 'workspace'));

	// pickers (tree / model / resume) — active session
	const pickerTitle = $derived(
		chat?.picker?.kind === 'tree'
			? t('shell.picker.tree')
			: chat?.picker?.kind === 'model'
				? t('shell.picker.model')
				: chat?.picker?.kind === 'resume'
					? t('shell.picker.resume')
					: chat?.picker?.kind === 'checkpoint'
						? t('shell.picker.checkpoint')
						: ''
	);
	const activeModel = $derived(
		chat?.picker?.kind === 'model' ? chat.picker.models.find((m) => m.active) : undefined
	);
	const pickerRows = $derived.by(() => {
		const p = chat?.picker;
		const nil = undefined as number | undefined;
		if (!p) return [];
		if (p.kind === 'tree')
			return treeRows(p.nodes).map((r) => ({ id: r.node.id, label: r.node.label, detail: r.node.id.slice(0, 8), active: r.node.active, command: `/checkout ${r.node.id}`, depth: r.depth as number | undefined }));
		if (p.kind === 'resume')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/resume ${it.id}`, depth: nil }));
		if (p.kind === 'checkpoint')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/rewind ${it.id}`, depth: nil }));
		// Model picker. The active provider's rows come from the engine's model_view
		// (already filtered — e.g. jucode hides unsupported models — and flagged with
		// the active one); other providers come from the client-side config list so
		// you can switch to any of them. Same-provider picks use /model (instant);
		// cross-provider picks switch via @switch (config rewrite + engine restart).
		const cur = chat?.provider ?? '';
		// Mirror the engine's jucode allow-list so we don't offer a model it rejects.
		const jucodeOk = (n: string) =>
			['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'].includes(n) || n.startsWith('claude-');
		const activeRows = p.models.map((m) => ({
			id: `${cur}::${m.model}`,
			label: m.label || m.model,
			vendor: m.vendor || m.model,
			detail: m.context_window ? `${cur} · ${fmtTokens(m.context_window)}` : cur,
			active: m.active,
			command: `/model ${m.model}`,
			depth: nil
		}));
		// Provider switching rewrites the native engine's global config and
		// restarts it — meaningful for jucode sessions only. Other backends'
		// pickers list just their own engine's model_view catalog.
		const otherRows = (chat?.backendId !== 'jucode' ? [] : providersList)
			.filter((pv) => pv.id !== cur)
			.flatMap((pv) =>
				pv.models
					.filter((m) => pv.id !== 'jucode' || jucodeOk(m.name))
					.map((m) => ({
						id: `${pv.id}::${m.name}`,
						label: m.name,
						vendor: m.name,
						detail: `${pv.id}${providers.includes(pv.id) ? '' : ` · ${t('shell.notConfigured')}`} · ${fmtTokens(m.context_window ?? 0)}`,
						active: false,
						command: `@switch ${pv.id} ${m.name}`,
						depth: nil
					}))
			);
		return [...activeRows, ...otherRows];
	});

	// Whether to offer a filter box (history and other long lists).
	const showPickerSearch = $derived(
		pickerRows.length > 8 || chat?.picker?.kind === 'resume' || chat?.picker?.kind === 'checkpoint'
	);
	const filteredRows = $derived.by(() => {
		const q = pickerQuery.trim().toLowerCase();
		if (!q) return pickerRows;
		return pickerRows.filter((r) => `${r.label} ${r.detail}`.toLowerCase().includes(q));
	});
	$effect(() => {
		chat?.picker;
		pickerQuery = '';
	});
	$effect(() => {
		if (chat?.picker) {
			const i = filteredRows.findIndex((r) => r.active);
			selIdx = i >= 0 ? i : 0;
		}
	});
	$effect(() => {
		activeId;
		atBottom = true;
		scrollToEnd(true);
		if (active) active.chat.unseen = false;
	});
	$effect(() => {
		if (chat?.pendingFill != null) {
			input = chat.pendingFill;
			chat.pendingFill = null;
		}
	});

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
	function nav(command: string) {
		if (chat) send({ op: 'command', input: command });
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
			await listDir(path);
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

	const isVideo = (p: string) => /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(p);

	function addAttachment(path: string) {
		if (!path) return;
		if (isVideo(path)) {
			attachVideo(path);
			return;
		}
		if (!attachments.some((a) => a.path === path)) attachments.push({ path, image: isImage(path) });
	}
	async function pickFiles() {
		const sel = await open({ multiple: true, title: t('shell.attachTitle') });
		if (!sel) return;
		for (const p of Array.isArray(sel) ? sel : [sel]) addAttachment(p);
	}

	// Video → keyframes: extraction happens on attach (not send) so the chip can
	// show the result and errors surface immediately.
	async function attachVideo(path: string) {
		if (videos.some((v) => v.path === path)) return;
		try {
			const info = await processVideo(path);
			videos.push({ path: info.path, frames: info.frames, duration: info.duration });
		} catch (e) {
			await message(String(e), { title: 'JuCode', kind: 'error' });
		}
	}

	async function screenshot() {
		try {
			const path = await captureScreenshot();
			if (path) {
				attachments.push({ path, image: true });
				composerEl?.focus();
			}
		} catch (e) {
			await message(String(e), { title: 'JuCode', kind: 'error' });
		}
	}

	async function toggleRecord() {
		try {
			if (!recording) {
				await startScreenRecording();
				recording = true;
			} else {
				recording = false;
				const path = await stopScreenRecording();
				await attachVideo(path);
				composerEl?.focus();
			}
		} catch (e) {
			recording = false;
			await message(String(e), { title: 'JuCode', kind: 'error' });
		}
	}

	// Serialize a picked element into model-readable context. Inserted in place of
	// its inline token on submit.
	function formatWebRef(r: PickedRef): string {
		const lines = [
			`[网页元素引用 #${r.id}] ${r.title || r.url}`,
			`页面: ${r.url}`,
			`选择器: ${r.selector}`
		];
		if (r.text) lines.push(`文本: ${r.text}`);
		if (r.html) lines.push(`HTML:\n${r.html}`);
		return lines.join('\n');
	}

	// Builds a reference token and inserts it as an atomic chip at the composer
	// caret (via the rich editor). Falls back to appending to the text if the
	// editor isn't mounted.
	function insertRefToken(id: number, label: string) {
		const clean = label.replace(/[\]\n\r]+/g, ' ').trim().slice(0, 24);
		const token = clean ? `[网页元素#${id}:${clean}]` : `[网页元素#${id}]`;
		if (composerRef) composerRef.insertToken(token);
		else input = input && !/\s$/.test(input) ? `${input} ${token} ` : `${input}${token} `;
	}

	function submit() {
		if (!chat) return;
		const text = input.trim();
		if (!text && attachments.length === 0 && videos.length === 0) return;
		if (text.startsWith('/')) {
			send({ op: 'command', input: text });
		} else {
			const images = attachments.filter((a) => a.image).map((a) => a.path);
			const files = attachments.filter((a) => !a.image).map((a) => a.path);
			let content = text;
			// Expand each web-element token in place (order = its position in the
			// text). Match by id so an edited descriptor still resolves; refs whose
			// token was deleted are simply never expanded.
			for (const ref of webRefs) {
				const re = new RegExp(`\\[网页元素#${ref.id}(?::[^\\]]*)?\\]`, 'g');
				if (re.test(content)) content = content.replace(re, `\n\n${formatWebRef(ref)}\n`);
			}
			content = content.replace(/\n{3,}/g, '\n\n').trim();
			if (files.length)
				content += `${content ? '\n\n' : ''}Attached files (read these):\n${files.join('\n')}`;
			for (const v of videos) {
				images.push(...v.frames);
				content += `${content ? '\n\n' : ''}[视频附件] ${base(v.path)}（时长 ${v.duration.toFixed(1)} 秒）：已按时间等间隔抽取 ${v.frames.length} 个关键帧，随消息以图片附上（按时间先后排序），请结合这些关键帧理解视频内容。`;
			}
			// Echo the message instantly when it starts a turn now (a busy session
			// queues it instead, shown in the composer's queue strip).
			if (chat && !chat.busy) chat.optimisticUser(content);
			send({ op: 'user_message', content, images: images.length ? images : undefined });
		}
		input = '';
		attachments = [];
		videos = [];
		webRefs = [];
	}
	function stop() {
		send({ op: 'interrupt' });
	}
	function respondApproval(op: ApproveOp) {
		if (!chat?.pendingApproval) return;
		send(op);
		chat.pendingApproval = null;
	}
	// User changed the approval-mode picker: persist locally and push it to this
	// session's engine (which enforces it and acks with an approval_mode event).
	function setApprovalMode(m: ApprovalMode) {
		if (!chat) return;
		chat.setApprovalMode(m);
		// Switching claude INTO yolo (bypassPermissions) isn't honored at runtime —
		// respawn the engine with the flag (resumes the conversation) instead of
		// sending a live control frame that would silently no-op.
		if (needsClaudeYoloRespawn(chat.backendId, buildSetApprovalModeOp(m).mode)) {
			store.respawnClaudeYolo(activeId);
			return;
		}
		send(buildSetApprovalModeOp(m));
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

	function selectRow(command: string) {
		// Cross-provider model pick: rewrite config + restart this session (resumes
		// the conversation) since the engine can't change provider at runtime.
		if (command.startsWith('@switch ')) {
			const rest = command.slice('@switch '.length);
			const sp = rest.indexOf(' ');
			const pid = rest.slice(0, sp);
			const name = rest.slice(sp + 1);
			const pv = providersList.find((x) => x.id === pid);
			chat?.closePicker();
			if (pv) store.switchProvider(activeId, pv, name);
			return;
		}
		// Resuming a history item opens it in a fresh session so the current chat
		// isn't replaced; everything else acts on the active session.
		if (command.startsWith('/resume ') && activeProject) {
			const sid = command.slice('/resume '.length).trim();
			// Codex/claude resume items open in a fresh session of the same backend
			// (codex: thread/resume via SessionCtx.resume; claude: the --resume
			// spawn option + transcript replay from the session file).
			if (chat?.backendId === 'codex' || chat?.backendId === 'claude') {
				const backend = chat.backendId;
				const item = chat.picker?.kind === 'resume' ? chat.picker.items.find((i) => i.id === sid) : undefined;
				chat.closePicker();
				store.activeId = store.restoreSession(activeProject, sid, item?.label ?? '', backend);
				return;
			}
			// jucode history entries come from the jucode engine, so the new session
			// is always jucode-backed regardless of the project's last-used backend.
			chat?.closePicker();
			const id = store.addSession(activeProject, undefined, 'jucode');
			dispatch(id, { op: 'command', input: command });
			return;
		}
		send({ op: 'command', input: command });
		chat?.closePicker();
	}
	function setEffort(effort: string) {
		if (activeModel) selectRow(`/model ${activeModel.model} ${effort}`);
	}
	function pickerKey(e: KeyboardEvent) {
		if (!chat?.picker) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			chat.closePicker();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selIdx = Math.min(selIdx + 1, filteredRows.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selIdx = Math.max(selIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const r = filteredRows[selIdx];
			if (r) selectRow(r.command);
		}
	}
	function respondTrust(answer: 'yes' | 'no' | 'repo') {
		if (!chat) return;
		send({ op: 'command', input: `/trust ${answer}` });
		chat.trustPrompt = null;
	}
	function onWindowKey(e: KeyboardEvent) {
		// Something closer to the target already claimed this key (e.g. the code
		// editor's own ⌘K / ⌘S keymap) — never double-fire an app shortcut on it.
		if (e.defaultPrevented) return;
		pickerKey(e);
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
			showFind ? closeFind() : openFind();
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
			toggleEditor();
		} else if (e.key === 'p') {
			e.preventDefault();
			if (activeProject) showQuickOpen = !showQuickOpen;
		}
	}

	function onScroll() {
		if (scroller) atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
	}
	// Stick to the bottom as content grows (streaming text, tool output, new cards).
	// The smoothed reveal changes height every frame, which a scroll-event listener
	// can't see, so observe the content's size directly.
	let contentEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!contentEl || !scroller) return;
		const ro = new ResizeObserver(() => {
			if (atBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
		});
		ro.observe(contentEl);
		return () => ro.disconnect();
	});
	async function scrollToEnd(force = false) {
		await tick();
		if (scroller && (atBottom || force)) {
			scroller.scrollTop = scroller.scrollHeight;
			atBottom = true;
		}
	}
	function jumpToBottom() {
		atBottom = true;
		scrollToEnd(true);
	}
	function editMessage(text: string) {
		input = text;
		composerEl?.focus();
	}
	function openFind() {
		showFind = true;
		tick().then(() => findInputEl?.focus());
	}
	function closeFind() {
		showFind = false;
		if (findDebounce != null) {
			clearTimeout(findDebounce);
			findDebounce = null;
		}
		findInput = '';
		findQuery = '';
	}
	const findNext = () => findHits.length && (findIdx = (findIdx + 1) % findHits.length);
	const findPrev = () => findHits.length && (findIdx = (findIdx - 1 + findHits.length) % findHits.length);
	function findKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFind();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.shiftKey ? findPrev() : findNext();
		}
	}
	// Real edit-and-resend: rewind the conversation (and files) to the turn that
	// produced this user message, then drop its text back into the composer. The
	// engine lists user turns in order, so the i-th turn matches the i-th message.
	function rewindToMessage(text: string, userIndex: number) {
		if (!chat) return;
		chat.rewindIntent = { userIndex, text };
		send({ op: 'command', input: '/rewind' });
	}
	function confirmRewind() {
		const pr = chat?.pendingRewind;
		if (!pr || !chat) return;
		send({ op: 'command', input: `/rewind ${pr.id}` });
		input = pr.text;
		chat.pendingRewind = null;
		composerEl?.focus();
	}

	onMount(() => {
		const savedW = Number(localStorage.getItem('jucode-right-width'));
		if (savedW >= 260 && savedW <= 640) rightWidth = savedW;
		const savedSb = Number(localStorage.getItem('jucode-sidebar-width'));
		if (savedSb >= 190 && savedSb <= 420) sidebarWidth = savedSb;
		const savedEd = Number(localStorage.getItem('jucode-editor-width'));
		if (savedEd >= 360 && savedEd <= 1400) editorWidth = savedEd;
		const cleanups: Array<() => void> = [];
		let disposed = false;
		(async () => {
			const unlisten = await listen<EventPayload>('agent-event', (e) => {
				const s = sessionMap.get(e.payload.session);
				if (!s) return;
				const wasBusy = s.chat.busy;
				try {
					// Route the raw line through the session's backend adapter; jucode's
					// is the identity, codex/claude translate to the jucode dialect.
					for (const ev of s.adapter.translate(JSON.parse(e.payload.data))) s.chat.handle(ev);
				} catch {
					/* ignore */
				}
				flushModeSync(s.chat, s.id);
				// Read the current active session at call time (store.activeId is
				// reactive) — not a value snapshotted when the listener was mounted —
				// so auto-scroll/notification target the right session after tab switches.
				const curActive = store.activeId;
				if (wasBusy && !s.chat.busy && s.id !== curActive) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
				if (s.id === curActive) scrollToEnd();
			});
			const unexit = await listen<string>('agent-exit', (e) => store.handleExit(e.payload));
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type === 'drop') for (const p of e.payload.paths) addAttachment(p);
			});
			// Embedded-browser events: element picks become composer chips; nav/state
			// updates flow into the browser store.
			const unbrowser = await listen<Record<string, unknown>>('browser-event', (e) => {
				const p = e.payload;
				if (p.kind === 'element') {
					browser.picking = false;
					const ref: PickedRef = {
						id: ++refSeq,
						url: typeof p.url === 'string' ? p.url : '',
						title: typeof p.title === 'string' ? p.title : '',
						selector: typeof p.selector === 'string' ? p.selector : '',
						tag: typeof p.tag === 'string' ? p.tag : '',
						text: typeof p.text === 'string' ? p.text : '',
						html: typeof p.html === 'string' ? p.html : ''
					};
					webRefs.push(ref);
					insertRefToken(ref.id, ref.text || ref.tag || 'element');
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
			// Restore saved projects + their open conversations (resume by id), or
			// seed a default project on first run.
			await store.restore(savedProjectsData);
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
			if (findDebounce != null) clearTimeout(findDebounce);
		};
	});
</script>

<svelte:window onkeydown={onWindowKey} bind:innerWidth={winW} />

<div class="app">
	<!-- LEFT: navigation + sessions -->
	<Sidebar
		{projects}
		{activeId}
		width={sidebarWidth}
		{loggedIn}
		providerName={chat?.provider ?? ''}
		updateAvailable={updater.available}
		onSelect={(id) => (store.activeId = id)}
		onNewProject={addProject}
		onNewTask={newTask}
		onNewSession={(p) => newSessionFlow(p)}
		onCloseSession={(id) => store.removeSession(id)}
		onCloseProject={removeProject}
		onArchiveSession={(id) => store.archiveSession(id)}
		onUnarchiveSession={(id) => store.unarchiveSession(id)}
		onHistory={(p) => store.openHistory(p)}
		onSettings={() => (showSettings = true)}
		onMarket={() => (showMarket = true)}
		onCommandPalette={() => (showPalette = true)}
	/>
	<div class="resizer side" role="separator" aria-label="resize sidebar" onpointerdown={startSidebarResize}></div>

	<!-- CENTER: chat -->
	<div class="center">
		{#if chat}
			<header data-tauri-drag-region>
				<div class="htitle" data-tauri-drag-region>
					<span class="hname">{chat.title}</span>
					<span class="hcrumb">{project}</span>
				</div>
				<div class="hspace" data-tauri-drag-region></div>
				<button class="hicon" class:on={showRight} onclick={toggleRight} aria-label="toggle panel" title={t('shell.togglePanel')}><PanelRight size={16} /></button>
			</header>

			{#if Object.keys(chat.subagents).length}
				<div class="agents">
					{#each Object.entries(chat.subagents) as [path, info] (path)}
						<span class="agent"><span class="agent-dot"></span>{path} · {agentStatus(info.status)}</span>
					{/each}
				</div>
			{/if}

			{#if showFind}
				<FindBar
					bind:value={findInput}
					bind:inputEl={findInputEl}
					hitCount={findHits.length}
					activeIndex={findIdx}
					onInput={onFindInput}
					onKey={findKey}
					onPrev={findPrev}
					onNext={findNext}
					onClose={closeFind}
				/>
			{/if}

			<main bind:this={scroller} onscroll={onScroll}>
				<div bind:this={contentEl}>
					<MessageList messages={chat.messages} {streamingMsg} {streamingReasoning} phase={chat.phase} compactionTokens={chat.compactionTokens} {findActive} {scroller} onEdit={editMessage} onRewind={rewindToMessage} />
				</div>
				{#if chat.booting && chat.engineState !== 'exited'}
					<div class="welcome spawning">
						<span class="spawn-spin"><LoaderCircle size={26} /></span>
						<p class="welcome-tip">{t('shell.spawning')}</p>
					</div>
				{:else if chat.messages.length === 0 && !chat.busy}
					<div class="welcome">
						<span class="welcome-mark">JuCode</span>
						<p class="welcome-tip">{t('shell.welcomeTip')}</p>
						<div class="welcome-hints">
							<span><kbd>/</kbd> {t('shell.hintCommand')}</span>
							<span><kbd>@</kbd> {t('shell.hintRef')}</span>
							<span><kbd>⌘K</kbd> {t('shell.hintPalette')}</span>
							<span>{t('shell.hintImage')}</span>
						</div>
					</div>
				{/if}
			</main>
			{#if !atBottom}
				<button class="jump" style:bottom="{bottomH + 14}px" onclick={jumpToBottom} aria-label="scroll to bottom"><ChevronDown size={18} /></button>
			{/if}

			<div class="bottom" bind:clientHeight={bottomH}>
			{#if chat.engineState === 'exited'}
				<div class="approval-wrap">
					<div class="enginedown">
						<span class="ed-text">{t('shell.engineDown')}</span>
						<Button variant="primary" size="sm" onclick={() => store.restartSession(activeId, true)}>{t('shell.restartEngine')}</Button>
					</div>
				</div>
			{/if}
			{#if chat.pendingApproval}
				<div class="approval-wrap">
					{#key chat.pendingApproval.callId}
						<ApprovalCard approval={chat.pendingApproval} onRespond={respondApproval} />
					{/key}
				</div>
			{/if}

			<StatusStrip items={chat.statusLog} />

			<Composer
				{chat}
				bind:this={composerRef}
				bind:input
				bind:attachments
				bind:videos
				bind:el={composerEl}
				{recording}
				onSubmit={submit}
				onStop={stop}
				onSteer={() => send({ op: 'steer' })}
				onPick={pickFiles}
				onScreenshot={screenshot}
				onRecord={toggleRecord}
				onModel={openModelPicker}
				onModelSelect={selectRow}
				onModelEffort={setEffort}
				onModelClose={() => chat?.closePicker()}
				modelRows={filteredRows}
				modelActive={activeModel}
				modelTitle={pickerTitle}
				modelSearch={showPickerSearch}
				bind:pickerQuery
				bind:pickerSelIdx={selIdx}
				onEffort={chooseEffort}
				onApproval={setApprovalMode}
			/>
			</div>
		{:else}
			<div class="nochat" data-tauri-drag-region>
				<span class="welcome-mark">JuCode</span>
				<p class="welcome-tip">{t('shell.noChat')}</p>
				<Button variant="primary" size="sm" onclick={addProject}>{t('shell.startFromProject')}</Button>
			</div>
		{/if}
	</div>

	<!-- EDITOR: toggleable split right of the chat (⌘E) -->
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
				worktree={activeProject?.worktree ?? null}
				onRevertFile={(p) => chat && (chat.changedFiles = chat.changedFiles.filter((x) => x !== p))}
				onOpenTask={(path, meta) => openTaskProject(path, meta)}
				onTaskRemoved={closeTaskProject}
			/>
		</div>
	</aside>

	{#if showSettings}
		<Settings sessionId={activeId} {chat} initialSection={settingsInitial} onAuthChange={refreshAuth} onClose={() => { showSettings = false; settingsInitial = 'overview'; loadProviders(); }} />
	{/if}

	{#if showMarket}
		<Marketplace sessionId={activeId} onClose={() => (showMarket = false)} />
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

	{#if chat?.trustPrompt}
		<div class="overlay" role="presentation">
			<div class="modal trust" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.trustLabel')} use:focusTrap>
				<div class="modal-head"><span>{t('shell.trustQuestion')}</span></div>
				<div class="trust-body">
					<p>{t('shell.trustBody')}</p>
					<code class="trust-path">{chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd}</code>
				</div>
				<div class="trust-actions">
					<button class="btn ghost" onclick={() => respondTrust('no')}>{t('shell.distrust')}</button>
					{#if chat.trustPrompt.repoRoot}<button class="btn" onclick={() => respondTrust('repo')}>{t('shell.trustRepo')}</button>{/if}
					<button class="btn primary" onclick={() => respondTrust('yes')}>{t('shell.trust')}</button>
				</div>
			</div>
		</div>
	{/if}

	{#if chat?.picker && chat.picker.kind !== 'model'}
		<Picker
			{chat}
			title={pickerTitle}
			{activeModel}
			rows={filteredRows}
			showSearch={showPickerSearch}
			bind:query={pickerQuery}
			bind:selIdx
			onClose={() => chat?.closePicker()}
			onSelect={selectRow}
			onEffort={setEffort}
		/>
	{/if}

	{#if chat?.pendingRewind}
		<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && chat && (chat.pendingRewind = null)}>
			<div class="modal trust" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.rewindLabel')} use:focusTrap>
				<div class="modal-head"><span>{t('shell.rewindQuestion')}</span></div>
				<div class="trust-body">
					<p>{@html t('shell.rewindBody')}</p>
					<code class="trust-path">{chat.pendingRewind.text.slice(0, 120)}</code>
				</div>
				<div class="trust-actions">
					<button class="btn ghost" onclick={() => chat && (chat.pendingRewind = null)}>{t('common.cancel')}</button>
					<button class="btn primary" onclick={confirmRewind}>{t('shell.rewindConfirm')}</button>
				</div>
			</div>
		</div>
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

	{#if backendPickFor}
		<BackendPicker lastUsed={backendPickFor.lastBackend} onPick={pickBackend} onClose={() => (backendPickFor = null)} />
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
		/>
	{/if}
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		overflow: hidden;
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
	.jump {
		position: absolute;
		left: 50%;
		bottom: 132px; /* overridden inline to sit just above the composer */
		transform: translateX(-50%);
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
		cursor: pointer;
		z-index: 10;
	}
	.jump:hover {
		background: var(--surface2);
	}
	/* Match the composer's outer frame (max-width 880, 18px side padding) so the
	   approval box lines up flush with the input box. */
	.approval-wrap {
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
		padding: 0 18px 10px;
	}
	.enginedown {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		background: color-mix(in oklab, var(--err) 10%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--err) 38%, transparent);
		border-radius: var(--r-md);
	}
	.ed-text {
		font-size: 13px;
		color: var(--err);
		font-weight: 500;
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid var(--hairline);
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
	}
	.hicon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.hicon.on {
		color: var(--accent-bright);
	}

	.agents {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 18px;
		border-bottom: 1px solid var(--hairline);
	}
	.agent {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
	}
	.agent-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}

	main {
		flex: 1;
		overflow-y: auto;
		padding: 22px 18px 26px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
	}
	.welcome {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		animation: rise 0.3s ease both;
	}
	.spawn-spin {
		display: inline-flex;
		color: var(--accent);
		animation: spawn-spin 0.8s linear infinite;
	}
	@keyframes spawn-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.welcome-mark {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		letter-spacing: -0.02em;
		color: var(--text);
		opacity: 0.16;
	}
	.welcome-tip {
		margin: 0;
		font-size: 14px;
		color: var(--dim);
	}
	.welcome-hints {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px 16px;
		margin-top: 6px;
		font-size: 12px;
		color: var(--dim2);
	}
	.welcome-hints span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.welcome-hints kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 5px;
		padding: 1px 6px;
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
		border-left: 1px solid var(--hairline);
		overflow: hidden;
		transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
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

	/* ---------- modals (picker / trust) ---------- */
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.modal {
		width: min(560px, 92vw);
		max-height: 76vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 16px;
		font-weight: 600;
		font-size: 14px;
		border-bottom: 1px solid var(--hairline);
	}
	:global(.prow-check) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.modal.trust {
		width: min(460px, 92vw);
	}
	.trust-body {
		padding: 16px;
		font-size: 14px;
		line-height: 1.55;
	}
	.trust-body p {
		margin: 0 0 12px;
	}
	.trust-path {
		display: block;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 8px 10px;
		word-break: break-all;
	}
	.trust-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 16px 16px;
	}
	.btn {
		font-size: 13px;
		padding: 8px 14px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
	}
	.btn:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn.ghost {
		color: var(--dim);
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
</style>
