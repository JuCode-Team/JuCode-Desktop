<script lang="ts" module>
	import type { WebRef } from '$lib/browser.svelte';
	import type { PlanAction as PaneAction } from '$lib/PlanCard.svelte';

	/** Configured provider (builtin or custom) with its model list — the page
	 *  loads these once and every pane shares them for the model picker. */
	export interface ProviderOption {
		id: string;
		/** Shown as the provider's heading in the model menu. */
		name?: string;
		base_url: string;
		format: string;
		models: { name: string; context_window?: number; reasoning_efforts?: string[]; hidden?: boolean }[];
	}

	/** Imperative surface the page reaches through its pane registry: global
	 *  flows (palette commands, file drops, browser element picks, ⌘F) always
	 *  target the workbench-active session's pane. */
	export interface ChatPaneApi {
		runCommand: (cmd: string) => void;
		addAttachment: (path: string) => void;
		insertWebRef: (ref: WebRef) => void;
		toggleFind: () => void;
		scrollToEnd: () => void;
		focusComposer: () => void;
		stop: () => void;
		openModelMenu: () => void;
		/** Approve or revise a plan of this session (from its page). */
		planAction: (id: string, action: PaneAction) => void;
	}
</script>

<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { open } from '@tauri-apps/plugin-dialog';
	import { treeRows } from '$lib/tree';
	import { buildSetApprovalModeOp, needsClaudeYoloRespawn, toEngineMode, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import type { PlanAction } from '$lib/PlanCard.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
	import {
		daemon,
		sessionHistory,
		nativeSessions,
		importNativeSession,
		git,
		gitCheckpointCapture,
		gitCheckpointRestore,
		generateText,
		resolveFileRef,
		type FileTarget,
		type Op
	} from '$lib/protocol';
	import { buildModelRows, pickable, providerModels, toolModels, type ToolModel } from '$lib/composer/modelRows';
	import { modelVendor } from '$lib/brandIcons';
	import { fileMention } from '$lib/fileMention';
	import type { ProviderChoice } from '$lib/composer/ModelMenu.svelte';
	import { draftProvider, loadToolProviders, toolProviderConfigs } from '$lib/toolProviders.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { BACKEND_LABELS, caps } from '$lib/backends';
	import { defaultEffort } from '$lib/composer/effort';
	import { dispatch } from '$lib/backends/router';
	import { browser } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { attachmentToken, expandAttachments, type Attachment } from '$lib/composer/attachments';
	import { followAfterScroll, fromEnd, followTop, shortOfEnd } from '$lib/chatFollow';
	import { clickAnchor, type ClickAnchor } from '$lib/chatAnchor';
	import { t } from '$lib/i18n';
	import type { SessionStore } from '$lib/session.svelte';
	import type { Session } from '$lib/types';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import Composer from '$lib/Composer.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import ForkDialog from '$lib/ForkDialog.svelte';
	import GitForkIcon from '@lucide/svelte/icons/git-fork';
	import { HANDOFF_SYSTEM, handoffPrompt } from '$lib/forkHandoff';
	import { llmTarget } from '$lib/llmTarget';
	import TurnRail from '$lib/TurnRail.svelte';
	import StatusStrip from '$lib/composer/StatusStrip.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import UsageLimit from '$lib/UsageLimit.svelte';
	import { limitResume } from '$lib/limitResume.svelte';
	import Button from '$lib/ui/Button.svelte';
	import SideAnswers from '$lib/composer/SideAnswers.svelte';
	import TaskPanel from '$lib/agents/TaskPanel.svelte';
	import SubagentPage from '$lib/agents/SubagentPage.svelte';
	import NewSessionPicker from '$lib/NewSessionPicker.svelte';
	import { agentRows, backgroundCommands, handedOffWork, planShown, planSummary, tasksEntry, type AgentRow } from '$lib/agentProgress';
	import { parseToolOutput, toolTarget, toolVerb } from '$lib/toolSummary';
	import { parseFileHref, pathExt, type FileRef } from '$lib/fileRefs';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import ScheduleDialog from '$lib/ScheduleDialog.svelte';
	import { daemonState } from '$lib/daemonState.svelte';
	import CallTimer from '$lib/CallTimer.svelte';
	import type { ScheduleDraft } from '$lib/schedules';
	import type { EditedFile, Proposal } from '$lib/turnSummary';
	import { turnBase } from '$lib/editor/turnBase';
	import { writeText } from '@tauri-apps/plugin-clipboard-manager';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { isMac } from '$lib/shortcuts';
	import { editors } from '$lib/editors.svelte';
	import { provideFileCheck } from '$lib/fileCheck';
	import { fadeOut, paneIn, paneOut, sideIn, sideOut } from '$lib/ui/motion';
	import type { Msg, SendNow } from '$lib/chat.svelte';
	import type { SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { planPages } from '$lib/planPages.svelte';
	import Picker from '$lib/shell/Picker.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import type { ErrorAction } from '$lib/errorInfo';
	import FindBar from '$lib/shell/FindBar.svelte';
	import { autoRetry } from '$lib/autoRetry.svelte';
	import { parseDelivery } from '$lib/delivery';
	import { loadComposerExtras, loadComposerText, saveComposerExtras, saveComposerText } from '$lib/composerText';

	// One full conversation (transcript + composer + approvals + pickers) for a
	// single session, extracted from the page so several chats can tile side by
	// side on the canvas. Everything session-scoped lives here; the page keeps
	// only cross-pane glue (event routing, notifications, global modals).
	let {
		session,
		store,
		providers = [],
		providersList = [],
		isActive = false,
		onRegister,
		onUnregister,
		onOpenSettings
	}: {
		session: Session;
		store: SessionStore;
		/** Providers with configured auth (for "not configured" hints). */
		providers?: string[];
		providersList?: ProviderOption[];
		/** This pane's session is `store.activeId` and no page (settings, the
		 *  desk) covers it — overlays and window keys only run on the active
		 *  pane, so two panes never fight over them and a hidden one never
		 *  answers. */
		isActive?: boolean;
		onRegister?: (id: string, api: ChatPaneApi) => void;
		/** Passes the api back so a remount (tile drag) can't drop the fresh one. */
		onUnregister?: (id: string, api: ChatPaneApi) => void;
		onOpenSettings?: (section: SectionKey) => void;
	} = $props();

	const chat = $derived(session.chat);
	const project = $derived(store.projects.find((p) => p.sessions.some((s) => s.id === session.id)));
	/** Where this session works: its own folder, else its project's. */
	const workDir = $derived(store.cwdOf(session.id) || chat.cwd);
	// Unsent text is kept per session: it survives switching away and restarts.
	// svelte-ignore state_referenced_locally
	let input = $state(loadComposerText(session.id));
	$effect(() => saveComposerText(session.id, input));
	// What else is not sent yet comes back with the pane (see the effect below).
	type Extras = {
		attachments: Attachment[];
		webRefs: PickedRef[];
		refSeq: number;
		quotes: { id: number; text: string }[];
		quoteSeq: number;
	};
	// svelte-ignore state_referenced_locally
	const kept = loadComposerExtras<Extras>(session.id);
	let attachments = $state<Attachment[]>(kept?.attachments ?? []);
	let attachSeq = Math.max(0, ...(kept?.attachments ?? []).map((a) => a.id));
	// Page elements picked in the embedded browser. Each pick inserts an inline
	// token ([网页元素#N:…]) into the composer text at the cursor, so the user can
	// position/reorder/delete it inline; on submit the token expands in place into
	// the full reference. Refs whose token was deleted are dropped.
	type PickedRef = WebRef & { id: number };
	let webRefs = $state<PickedRef[]>(kept?.webRefs ?? []);
	let refSeq = kept?.refSeq ?? 0;
	// Passages quoted from replies: a chip in the composer, the quote on send.
	let quotes: { id: number; text: string }[] = kept?.quotes ?? [];
	let quoteSeq = kept?.quoteSeq ?? 0;
	// Kept when the pane closes (a workspace switch); nothing to keep, forgotten.
	$effect(() => {
		const id = session.id;
		return () => {
			const extras = { attachments: $state.snapshot(attachments), webRefs: $state.snapshot(webRefs), refSeq, quotes, quoteSeq };
			saveComposerExtras(id, attachments.length || webRefs.length || quotes.length ? extras : undefined);
		};
	});
	let scroller = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let composerRef = $state<{ insertToken: (t: string) => void; openModelMenu: () => void } | undefined>();
	let bottomH = $state(120);
	let atBottom = $state(true);
	/** The view is well short of the end: the jump button shows. */
	let farFromEnd = $state(false);
	let messageList = $state<MessageList | null>(null);
	let mark = $state(-1);
	const marks = $derived(chat.messages.flatMap((m) => (m.kind === 'user' && !parseDelivery(m.text) ? [m.text] : [])));

	// The conversation column has one fixed width (as in ChatGPT and Claude):
	// narrow enough to read, wide enough for the composer's bar on one line.
	const CHAT_W = 768;
	let wrapW = $state(0);
	const chatW = CHAT_W;
	// The least room beside the column (more with the rail at the left edge),
	// and the room it has: main's padding-inline.
	const chatPad = $derived(marks.length > 1 ? 56 : 32);
	const pad = $derived(Math.max(chatPad, (wrapW - chatW) / 2));

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
	let selIdx = $state(0);
	let pendingModel = $state('');
	// Whether this Claude Code / Codex session runs through the JuCode gateway.
	const toolMode = $derived<'system' | 'jucode'>(session.gateway ? 'jucode' : 'system');

	// Ops flow through this session's backend adapter; an unsupported op
	// (non-jucode stub backends) surfaces as an inline system notice.
	function send(op: Op) {
		// A typed /model on a draft is a pick like the menu's, not a reason to
		// start the engine.
		if (session.draft && op.op === 'command' && /^\/model(\s|$)/.test(op.input.trim())) {
			const line = op.input.trim();
			if (line === '/model') openModelPicker();
			else selectRow(line);
			return;
		}
		// claude's /resume can't go over the wire: stream-json mode has no session
		// listing protocol, the history lives in files under ~/.claude/projects.
		// Bare /resume builds the picker from the daemon's history of the
		// directory; a typed `/resume <id>` opens that session in a fresh tab
		// (same flow as a picker pick — the current chat is never replaced).
		if (op.op === 'command' && chat.backendId === 'claude') {
			const line = op.input.trim();
			if (line === '/resume') {
				openClaudeHistory();
				return;
			}
			if (line.startsWith('/resume ') && project) {
				const sid = line.slice('/resume '.length).trim();
				chat.closePicker();
				store.activeId = store.restoreSession(project, sid, '', 'claude');
				return;
			}
		}
		// Writing in an archived thread brings it back to the list.
		if (op.op === 'user_message' && session.archived) store.unarchiveSession(session.id);
		if (!dispatch(session.id, op)) {
			chat.messages.push({ kind: 'system', text: t('shell.backend.opUnsupported', { op: op.op }) });
		}
	}

	/** Continues a turn the engine's exit cut short (ChatState.cutTurn). */
	function continueCut() {
		const cut = chat.cutTurn;
		chat.cutTurn = null;
		if (cut) void store.retryTurn(session.id, t('chat.cut.note'), cut.started);
	}

	// An error notice's fix button.
	function fixError(action: ErrorAction) {
		if (action === 'restart') store.restartSession(session.id, true);
		else if (action === 'login' || action === 'account') onOpenSettings?.('account');
		else if (action === 'compact') send({ op: 'command', input: '/compact' });
		else if (action === 'model') openModelPicker();
	}

	// The project history picker's sources: JuCode's own conversations, or the
	// ones Claude Code / Codex saved in their own apps (picking one imports it).
	const historySources = [
		{ value: 'jucode', label: 'JuCode' },
		{ value: 'claude', label: 'Claude Code' },
		{ value: 'codex', label: 'Codex' }
	];
	// The selected tab follows the list shown (each opening starts on JuCode);
	// a switch applies only if it is still the latest and the picker is open.
	let historyTab = $state('jucode');
	let historyReq = 0;
	$effect(() => {
		if (chat.picker?.kind === 'resume' && chat.picker.history) historyTab = chat.picker.source ?? 'jucode';
	});
	async function showHistorySource(source: string) {
		const proj = project;
		if (!proj) return;
		const req = ++historyReq;
		const current = () => req === historyReq && chat.picker?.kind === 'resume' && !!chat.picker.history;
		const from = source === 'claude' || source === 'codex' ? source : 'jucode';
		try {
			const items =
				from === 'jucode'
					? await store.historyItems(proj, chat, workDir)
					: (await nativeSessions(from, workDir)).map((s) => ({
							id: s.id,
							label: s.title || s.id.slice(0, 8),
							detail: [s.origin, new Date(s.mtime_ms).toLocaleString(), s.imported ? t('shell.historySource.imported') : '']
								.filter(Boolean)
								.join(' · '),
							active: false
						}));
			if (current()) chat.picker = { kind: 'resume', history: true, source: from, backend: from, items };
		} catch (e) {
			if (!current()) return;
			toast.error(t('shell.historyFail', { msg: String(e) }));
			historyTab = chat.picker?.kind === 'resume' ? (chat.picker.source ?? 'jucode') : 'jucode';
		}
	}

	// Builds the claude /resume picker from the Claude Code conversations the
	// daemon lists for this project (synthesized resume_view).
	async function openClaudeHistory() {
		const c = chat;
		const proj = project;
		if (!proj) return;
		try {
			const sessions = (await sessionHistory(workDir)).filter((s) => s.engine === 'claude');
			c.handle({
				type: 'resume_view',
				items: sessions.map((s) => ({
					id: s.session,
					label: s.title || t('shell.untitled'),
					detail: new Date(s.updated_at).toLocaleString(),
					active: s.session === c.sessionId
				}))
			});
		} catch (e) {
			c.messages.push({ kind: 'system', text: t('shell.backend.claudeHistoryFail', { msg: String(e) }) });
		}
	}

	// The backend is only switchable while the session is virgin: no user turn
	// yet (an optimistic push counts) and not a resumed conversation.
	const backendLocked = $derived(!!session.restored || chat.userTurns > 0);

	// Current git branch for the composer's footer strip. A detached HEAD reads
	// "detached"; a failed probe (not a git repo) hides the chip.
	let gitBranch = $state('');
	function refreshGitBranch() {
		const cwd = workDir;
		if (!cwd) {
			gitBranch = '';
			return;
		}
		git(['branch', '--show-current'], cwd)
			.then((out) => {
				if (cwd === workDir) gitBranch = out.trim() || 'detached';
			})
			.catch(() => {});
	}
	// Refetched when the working directory changes (chip resets immediately)…
	$effect(() => {
		const cwd = workDir;
		gitBranch = '';
		if (!cwd) return;
		refreshGitBranch();
	});
	// …and refreshed in place on window focus + a slow poll, so a checkout made
	// in GitPanel or an external terminal doesn't leave the footer stale. Only
	// the active pane polls: every tab stays mounted, and each poll is a git
	// process.
	$effect(() => {
		if (!isActive) return;
		untrack(refreshGitBranch);
		const iv = setInterval(refreshGitBranch, 12_000);
		return () => clearInterval(iv);
	});

	// Open the model picker as a popover. If we already have a cached catalog,
	// show it instantly and refresh in the background; otherwise fetch first.
	function openModelPicker() {
		// A draft has no engine to ask: the list is the one its backend
		// reported last time, marked with the draft's own pick.
		if (session.draft) {
			const pick = session.draftPick?.model;
			// A JuCode draft: its provider's models as configured now (an engine's
			// list comes from its probe, see engineProbe).
			if (chat.backendId === 'jucode')
				chat.modelCatalog = providerModels(
					providersList.find((p) => p.id === chat.provider) ?? providersList.find((p) => p.id === 'jucode') ?? providersList[0],
					chat.model
				);
			const models = chat.modelCatalog.map((m) => ({ ...m, active: pick ? m.model === pick : m.active }));
			chat.picker = { kind: 'model', models, activeEffort: chat.effort };
			const act = models.findIndex((m) => m.active);
			selIdx = act >= 0 ? act : 0;
			return;
		}
		if (chat.modelCatalog.length) {
			chat.picker = {
				kind: 'model',
				models: chat.modelCatalog,
				activeEffort: chat.modelCatalogEffort || chat.effort
			};
			const act = chat.modelCatalog.findIndex((m) => m.active);
			selIdx = act >= 0 ? act : 0;
		}
		// This answer opens the list, whatever was asked before it.
		chat.catalogQuiet = false;
		send({ op: 'command', input: '/model' });
	}

	// The assistant message that's still streaming: render it as plain text and
	// only run markdown/highlight once the turn finishes (avoids reparsing the
	// whole message on every token).
	// The streaming block is the LAST message (deltas append to the tail). Scanning
	// backwards would wrongly latch onto a previous turn's reply before this turn's
	// message exists, re-animating it on send.
	const streamingMsg = $derived.by(() => {
		if (!chat.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'assistant' ? last : null;
	});
	// The reasoning block currently receiving deltas — rendered with the
	// line-by-line streaming animation (others render as static markdown).
	const streamingReasoning = $derived.by(() => {
		if (!chat.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'reasoning' && !last.collapsed ? last : null;
	});

	// Message indices in this chat matching the find query, and the current one.
	const findHits = $derived.by(() => {
		if (!showFind) return [];
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

	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	// The session's background tasks (TaskPanel), a region beside the
	// conversation; a subagent opens there on its own conversation where the
	// engine can read it back.
	const canOpenAgent = $derived(caps(chat).agentTrace);
	function openTasks(agentId: string | null) {
		// A subagent opens as a page in place of the conversation.
		if (agentId && canOpenAgent) {
			chat.agentFocus = agentId;
			chat.agentPage = agentId;
			return;
		}
		chat.agentFocus = null;
		chat.tasksOpen = true;
	}
	function closeAgentPage() {
		chat.agentPage = null;
		chat.agentFocus = null;
	}
	function traceOf(m: Msg): { label: string; run: () => void } | null {
		if (m.kind !== 'tool' || !m.callId) return null;
		const agent = chat.agentRuns.agents.find((a) => a.toolUseId === m.callId);
		if (agent) return { label: t('dock.agents.openAgent'), run: () => openTasks(agent.id) };
		if (chat.agentRuns.workflows.some((w) => w.toolUseId === m.callId)) return { label: t('dock.agents.open'), run: () => openTasks(null) };
		return null;
	}
	// The subagents of this conversation (the message list's cards find
	// theirs). Derived from the trace and lifecycle state, never from the
	// streaming text.
	const lastTool = (label: string) => {
		const m = chat.subagentLastTool[label];
		return m ? `${toolVerb(m.name)} ${toolTarget(m.name, parseToolOutput(m.output))}`.trim() : '';
	};
	const allAgents = $derived(agentRows({ runs: chat.agentRuns, subagents: chat.subagents, lastTool }));
	// The turn stays unfolded while work it handed off runs (which does not
	// make the session working: sessionStatus).
	const turnOpen = $derived(chat.busy || handedOffWork(allAgents, chat.bgTasks));
	// The entry under the conversation: the plan's steps and the tasks that run.
	const plan = $derived(planSummary(chat.plan));
	const entry = $derived(
		tasksEntry(
			plan,
			planShown(plan, chat.busy, chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt),
			allAgents,
			backgroundCommands(chat.bgTasks, chat.subagents).length
		)
	);
	const openAgent = (row: AgentRow) => openTasks(row.workflow ? null : row.id);

	// Plan mode: a proposed plan runs once approved, in the mode picked on its
	// card; revising it sends the next message as the user's feedback.
	const planMode = $derived<ApprovalMode>(
		chat.modeBeforePlan && chat.modeBeforePlan !== 'plan' ? chat.modeBeforePlan : 'edits'
	);
	function planAction(id: string, action: PlanAction) {
		const plan = chat.messages.find((m) => m.kind === 'plan' && m.id === id);
		if (action.decision === 'approve') {
			const mode = toEngineMode(action.mode) as Exclude<ReturnType<typeof toEngineMode>, 'plan'>;
			send({ op: 'approve_plan', id, decision: 'approve', mode });
			chat.setApprovalMode(action.mode);
			if (plan?.kind === 'plan') plan.status = 'approved';
			chat.planRevising = null;
			return;
		}
		chat.planRevising = id;
		composerEl?.focus();
	}

	// pickers (tree / model / resume) — this pane's session
	const pickerTitle = $derived(
		chat.picker?.kind === 'tree'
			? t('shell.picker.tree')
			: chat.picker?.kind === 'model'
				? t('shell.picker.model')
				: chat.picker?.kind === 'resume'
					? t('shell.picker.resume')
					: chat.picker?.kind === 'checkpoint'
						? t('shell.picker.checkpoint')
						: ''
	);
	const activeModel = $derived(
		chat.picker?.kind === 'model' ? chat.picker.models.find((m) => m.active) : undefined
	);
	const pickerRows = $derived.by(() => {
		const p = chat.picker;
		const nil = undefined as number | undefined;
		if (!p) return [];
		if (p.kind === 'tree')
			return treeRows(p.nodes).map((r) => ({ id: r.node.id, label: r.node.label, detail: r.node.id.slice(0, 8), active: r.node.active, command: `/checkout ${r.node.id}`, depth: r.depth as number | undefined }));
		if (p.kind === 'resume')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/resume ${it.id}`, depth: nil }));
		if (p.kind === 'checkpoint')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/rewind ${it.id}`, depth: nil }));
		// A custom provider serves the models picked for it in Settings.
		if (customProvider)
			return customProvider.models.map((id) => ({
				id,
				label: id,
				vendor: id,
				detail: customProvider.name,
				active: id === (session.draft ? (session.draftPick?.model ?? chat.model) : chat.model),
				command: `/model ${id}`,
				depth: nil
			}));
		// Model picker rows (pure packing in $lib/composer/modelRows): the
		// models of the provider the session runs on; another provider is
		// picked in the menu's provider row.
		return buildModelRows({
			models: p.models,
			backendId: chat.backendId,
			provider: chat.provider ?? '',
			providersList,
			toolMode,
			unsetWindow: t('chat.windowUnset'),
			vendorOf: modelVendor
		});
	});

	// Claude Code / Codex: the custom provider the session runs on (its engine
	// says), or a draft starts on (its pick, else the tool's default).
	const customProvider = $derived.by(() => {
		const tool = chat.backendId;
		if (tool !== 'claude' && tool !== 'codex') return undefined;
		if (!session.draft) return chat.toolProvider ?? undefined;
		if (session.gateway) return undefined;
		return draftProvider(tool, session.draftToolProvider);
	});
	$effect(() => {
		const tool = chat.backendId;
		if (tool === 'claude' || tool === 'codex') untrack(() => void loadToolProviders(tool).catch(() => {}));
	});
	// A draft on a custom provider shows a model it serves (the daemon starts
	// it on the provider's default).
	$effect(() => {
		const p = customProvider;
		if (session.draft && p && !p.models.includes(chat.model))
			untrack(() => {
				chat.model = p.model;
				chat.modelLabel = '';
			});
	});

	// Claude Code / Codex: the current model and where it can run, for the
	// menu's provider row.
	const toolModel = $derived.by((): ToolModel | undefined => {
		if ((chat.backendId !== 'claude' && chat.backendId !== 'codex') || !chat.model) return undefined;
		const served = providers.includes('jucode')
			? (providersList.find((p) => p.id === 'jucode')?.models ?? [])
			: [];
		const id = chat.model;
		const found = toolModels(chat.modelCatalog, served, toolMode === 'jucode').find(
			(m) => m.key === id || m.local === id || m.jucode === id
		);
		return (
			found ?? {
				key: id,
				label: id,
				vendor: id,
				active: true,
				...(toolMode === 'jucode' ? { jucode: id } : { local: id })
			}
		);
	});

	/** Moves this Claude Code / Codex session between this machine and the
	 *  gateway. A conversation under way may not carry over (its thinking is
	 *  signed for the account that wrote it): asked first. */
	async function switchTool(mode: 'system' | 'jucode', model?: string): Promise<boolean> {
		if (!session.draft && chat.messages.some((m) => m.kind === 'user')) {
			const ok = await confirm({
				title: t(mode === 'jucode' ? 'shell.toolSwitch.confirmJucode' : 'shell.toolSwitch.confirmSystem'),
				message: t('shell.toolSwitch.confirmBody'),
				confirmLabel: t('shell.toolSwitch.confirm')
			});
			if (!ok) return false;
		}
		void store.applyToolProfile(session.id, mode, model);
		return true;
	}

	// What a side runs when the current model is not there: on the gateway,
	// its first model of the tool's own company (else its first); on this
	// machine, the first of the engine's catalog.
	function gatewayModel(m: ToolModel): string | undefined {
		if (m.jucode) return m.jucode;
		const served = providers.includes('jucode') ? pickable(providersList.find((p) => p.id === 'jucode')?.models ?? []) : [];
		// Claude Code names a long-context model `name[1m]`.
		const base = m.key.replace(/\[[^\]]*\]$/, '');
		const own = modelVendor(chat.backendId === 'claude' ? 'claude' : 'gpt');
		return (served.find((g) => g.name === base) ?? served.find((g) => modelVendor(g.name) === own) ?? served[0])?.name;
	}
	// A session on a custom provider goes back to that provider's default.
	const localModel = (m: ToolModel) =>
		m.local ?? customProvider?.model ?? chat.modelCatalog.find((x) => x.listed !== false)?.model;

	async function pickProvider(m: ToolModel, choice: { local: true } | { group: string } | { custom: string }) {
		if ('custom' in choice) {
			chat.closePicker();
			const p = toolProviderConfigs[chat.backendId as 'claude' | 'codex']?.providers.find((x) => x.id === choice.custom);
			store.setDraftToolProvider(session.id, choice.custom, p?.model);
			return;
		}
		// A draft leaves its custom provider: for the tool's own config, or
		// for the gateway on a model it serves.
		if (session.draft && customProvider) {
			chat.closePicker();
			if ('local' in choice) {
				// The provider's model may not be the tool's: its own default.
				const own = chat.modelCatalog.find((x) => x.active)?.model ?? chat.modelCatalog[0]?.model;
				store.setDraftToolProvider(session.id, '', own);
				return;
			}
			store.setDraftToolProvider(session.id, '');
			await store.applyToolProfile(session.id, 'jucode', gatewayModel(m));
			store.setSessionGroup(session.id, choice.group);
			return;
		}
		if (toolMode === 'jucode' && !('local' in choice)) {
			store.setSessionGroup(session.id, choice.group);
			return;
		}
		chat.closePicker();
		if ('local' in choice) {
			if (toolMode === 'jucode') await switchTool('system', localModel(m));
			// A draft names it: not the tool's default custom provider.
			if (session.draft) store.setDraftToolProvider(session.id, '');
			return;
		}
		// Set once the switch is confirmed; the gateway reads it per request.
		const model = gatewayModel(m);
		if (model && (await switchTool('jucode', model))) store.setSessionGroup(session.id, choice.group);
	}

	// The jucode engine's providers, picked above its model list: JuCode and
	// each with a stored key and models to pick. A pick moves to the same model
	// there when it has one, else to its first (the menu sends the command).
	const providerChoice = $derived.by((): ProviderChoice | undefined => {
		if (chat.backendId !== 'jucode') return undefined;
		const cur = chat.provider ?? '';
		const options = providersList.filter((p) => p.id === cur || (providers.includes(p.id) && pickable(p.models).length));
		if (options.length < 2) return undefined;
		return {
			value: cur,
			options: options.map((p) => ({ value: p.id, label: p.id === 'jucode' ? 'JuCode' : p.id })),
			commandFor: (id: string) => {
				if (id === cur) return undefined;
				const models = pickable(options.find((p) => p.id === id)?.models ?? []);
				const model = (models.find((m) => m.name === chat.model) ?? models[0])?.name;
				return model ? `@switch ${id} ${model}` : undefined;
			}
		};
	});

	// Whether to offer a filter box (history and other long lists).
	const showPickerSearch = $derived(
		pickerRows.length > 8 || chat.picker?.kind === 'resume' || chat.picker?.kind === 'checkpoint'
	);
	// Older model versions stay folded until asked for; a search looks
	// through every row.
	let showLegacy = $state(false);
	const legacyCount = $derived(pickerRows.filter((r) => (r as { legacy?: boolean }).legacy).length);
	const filteredRows = $derived.by(() => {
		const q = pickerQuery.trim().toLowerCase();
		if (!q) return showLegacy ? pickerRows : pickerRows.filter((r) => !(r as { legacy?: boolean }).legacy);
		return pickerRows.filter((r) => `${r.label} ${r.detail} ${r.id} ${(r as { group?: string }).group ?? ''}`.toLowerCase().includes(q));
	});
	$effect(() => {
		chat.picker;
		pickerQuery = '';
		showLegacy = false;
	});
	$effect(() => {
		if (pendingModel && chat.model === pendingModel) pendingModel = '';
		if (chat.picker) {
			const i = filteredRows.findIndex((r) => r.active);
			selIdx = i >= 0 ? i : 0;
		}
	});
	$effect(() => {
		if (chat.pendingFill != null) {
			input = chat.pendingFill;
			chat.pendingFill = null;
			const files = chat.pendingFillFiles;
			chat.pendingFillFiles = [];
			untrack(() => {
				for (const path of files) attach({ path, image: false }, false);
			});
		}
	});
	// A queued message taken back: its text before what is typed now, its
	// images attached again.
	$effect(() => {
		const back = chat.unqueued;
		if (!back) return;
		chat.unqueued = null;
		untrack(() => {
			// Its images' [图片 #n] become their placeholders again; its files
			// are attached again.
			const ids = back.images.map((path) => addImage(path, undefined, false));
			for (const path of back.files) attach({ path, image: false }, false);
			const content = back.content.replace(/\[图片 #(\d+)\]/g, (m, n: string) => (ids[Number(n) - 1] ? attachmentToken(ids[Number(n) - 1]) : m));
			input = input.trim() ? `${content}\n${input}` : content;
		});
		composerEl?.focus();
	});
	// This pane became the workbench-active one: its unread marker clears.
	$effect(() => {
		if (isActive) untrack(() => (chat.unseen = false));
	});

	// A video, like any file but an image, goes as it is.
	function addAttachment(path: string) {
		if (!path) return;
		if (isImage(path)) addImage(path);
		else attach({ path, image: false });
	}
	// Images sit above the text as cards, sent in the order they were added.
	function addImage(path: string, size?: number, chip = true) {
		return attach({ path, image: true, size }, chip);
	}
	/** Adds it once, with its placeholder at the caret (`chip`); its id. */
	function attach(a: Omit<Attachment, 'id'>, chip = true): number {
		const had = attachments.find((x) => x.path === a.path);
		if (had) return had.id;
		const id = ++attachSeq;
		attachments.push({ ...a, id });
		if (chip) composerRef?.insertToken(attachmentToken(id));
		return id;
	}
	async function pickFiles() {
		const sel = await open({ multiple: true, title: t('shell.attachTitle') });
		if (!sel) return;
		for (const p of Array.isArray(sel) ? sel : [sel]) addAttachment(p);
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

	// A browser element pick routed here by the page (always the active pane).
	function insertWebRef(ref: WebRef) {
		const picked: PickedRef = { ...ref, id: ++refSeq };
		webRefs.push(picked);
		insertRefToken(picked.id, picked.text || picked.tag || 'element');
	}

	/** `now`: sent while a reply runs, the message does not wait for the turn
	 *  to end: it joins the reply (`steer`) or stops it and goes (`interrupt`). */
	function submit(now?: SendNow) {
		const text = input.trim();
		if (!text && attachments.length === 0) return;
		if (text.startsWith('/')) {
			const btw = caps(chat).sideQuestions ? text.match(/^\/btw\s+([\s\S]+)/) : null;
			if (btw) chat.sideAnswers.push({ question: btw[1].trim(), answer: '', error: '', pending: true });
			send({ op: 'command', input: text });
		} else {
			const imagePaths = attachments.filter((a) => a.image).map((a) => a.path);
			// Files go with the message as attachments, each engine's own way
			// (the daemon): the text only names them where they were placed. A
			// daemon from before them would drop them: there they are mentioned
			// in the text, as before.
			const attached = attachments.filter((a) => !a.image).map((a) => a.path);
			const native = daemon.features.has('files');
			const files = native ? attached : [];
			let content = expandAttachments(text, attachments);
			if (!native && attached.length) content += `${content ? '\n\n' : ''}${attached.map(fileMention).join(' ')}`;
			// Expand each web-element token in place (order = its position in the
			// text). Match by id so an edited descriptor still resolves; refs whose
			// token was deleted are simply never expanded.
			for (const ref of webRefs) {
				const re = new RegExp(`\\[网页元素#${ref.id}(?::[^\\]]*)?\\]`, 'g');
				if (re.test(content)) content = content.replace(re, `\n\n${formatWebRef(ref)}\n`);
			}
			// Each quote token becomes the passage as a markdown quote.
			for (const q of quotes) {
				const re = new RegExp(`\\[引用#${q.id}(?::[^\\]]*)?\\]`, 'g');
				const block = q.text
					.split('\n')
					.map((line) => `> ${line}`.trimEnd())
					.join('\n');
				content = content.replace(re, () => `\n\n${block}\n\n`);
			}
			content = content.replace(/\n{3,}/g, '\n\n').trim();
			// Revising a proposed plan: the message is the user's feedback on it.
			const revising = chat.planRevising;
			if (revising && !files.length && !imagePaths.length) {
				const plan = chat.messages.find((m) => m.kind === 'plan' && m.id === revising);
				if (plan?.kind === 'plan') plan.status = 'revising';
				chat.planRevising = null;
				if (!chat.busy || chat.restarting) chat.optimisticUser(content);
				send({ op: 'approve_plan', id: revising, decision: 'revise', feedback: content });
				input = '';
				webRefs = [];
				quotes = [];
				return;
			}
			// Echo the message instantly when it starts a turn now (a busy session
			// queues it instead, shown in the composer's queue strip).
			// A restarting engine holds the message and starts the turn once up.
			// The user carries on now: no waiting for the usage limit's reset.
			limitResume.cancel(chat);
			if (!chat.busy || chat.restarting) {
				captureCheckpoint(); // snapshot files before this turn (for rewind)
				chat.optimisticUser(content, imagePaths, false, files);
			}
			send({ op: 'user_message', content, images: imagePaths.length ? imagePaths : undefined, files: files.length ? files : undefined });
			// The engine queues it last: that one goes now.
			if (now && chat.busy && !chat.restarting) send(now === 'steer' ? { op: 'steer', index: -1 } : interruptFor(-1));
		}
		input = '';
		attachments = [];
		webRefs = [];
		quotes = [];
		if (prefs.scrollOnSend) jumpToBottom();
	}
	/** Stops the reply and sends queued message `index` now. An engine that
	 *  cannot join a reply already stops it to steer (ACP): `steer` there,
	 *  which a daemon from before `interrupt`'s `index` also does. */
	function interruptFor(index: number) {
		autoRetry.cancel(chat);
		limitResume.cancel(chat);
		chat.stopping();
		return caps(chat).steer ? { op: 'interrupt' as const, index } : { op: 'steer' as const, index };
	}
	function stop() {
		autoRetry.cancel(chat);
		limitResume.cancel(chat);
		chat.stopping();
		send({ op: 'interrupt' });
	}
	function respondApproval(op: ApproveOp) {
		if (!chat.pendingApproval) return;
		send(op);
		chat.pendingApproval = null;
	}
	// User changed the approval-mode picker: persist locally and push it to this
	// session's engine (which enforces it and acks with an approval_mode event).
	function setApprovalMode(m: ApprovalMode) {
		chat.setApprovalMode(m);
		// A draft starts in the recorded mode (see SessionStore #spawn).
		if (session.draft) return;
		// Switching claude INTO yolo (bypassPermissions) isn't honored at runtime —
		// respawn the engine with the flag (resumes the conversation) instead of
		// sending a live control frame that would silently no-op.
		if (needsClaudeYoloRespawn(chat.backendId, buildSetApprovalModeOp(m).mode)) {
			// Not mid-turn: the respawn would cut the turn off, and one claude
			// has not saved yet cannot be resumed. Switch once it ends.
			if (chat.busy) yoloAfterTurn = true;
			else store.respawnClaudeYolo(session.id);
			return;
		}
		yoloAfterTurn = false;
		send(buildSetApprovalModeOp(m));
	}

	let yoloAfterTurn = $state(false);
	$effect(() => {
		if (yoloAfterTurn && !chat.busy && chat.approvalMode === 'all') {
			yoloAfterTurn = false;
			store.respawnClaudeYolo(session.id);
		}
	});

	function selectRow(command: string) {
		// A draft only records the model; it is applied when the first message
		// starts the engine.
		if (session.draft && command.startsWith('/model ')) {
			const [name, effort] = command.slice('/model '.length).trim().split(/\s+/);
			const entry = chat.modelCatalog.find((m) => m.model === name);
			chat.model = name;
			chat.modelLabel = entry?.label ?? '';
			if (entry?.reasoning_efforts?.length) {
				chat.efforts = entry.reasoning_efforts;
				if (!chat.efforts.includes(chat.effort)) chat.effort = defaultEffort(chat.efforts, chat.effortDefault);
			}
			if (effort) chat.effort = effort;
			session.draftPick = { model: name, effort: chat.effort || undefined };
			chat.closePicker();
			return;
		}
		if (command.startsWith('/model ')) {
			const target = command.slice('/model '.length).trim().split(/\s+/)[0] || '';
			if (target && target !== chat.model) pendingModel = target;
		}
		// Cross-provider model pick: rewrite config + restart this session (resumes
		// the conversation) since the engine can't change provider at runtime.
		// `@switch <provider> <model> [effort]` — the effort chip appends its value.
		if (command.startsWith('@switch ')) {
			const [pid, name, effort] = command.slice('@switch '.length).split(/\s+/);
			const pv = providersList.find((x) => x.id === pid);
			chat.closePicker();
			if (pv && name) store.switchProvider(session.id, pv, name, effort);
			return;
		}
		// Resuming a history item opens it in a fresh session so the current chat
		// isn't replaced; everything else acts on this session.
		if (command.startsWith('/resume ') && project) {
			const sid = command.slice('/resume '.length).trim();
			// A history item opens in a new tab so the current chat isn't
			// replaced: codex via thread/resume, claude via --resume + transcript
			// replay, jucode via session_open (hosted) or /resume after spawn.
			const picker = chat.picker?.kind === 'resume' ? chat.picker : undefined;
			const backend = picker?.backend ?? chat.backendId;
			const item = picker?.items.find((i) => i.id === sid);
			chat.closePicker();
			// A Claude Code / Codex conversation continues from a cleaned copy.
			const source = picker?.source;
			if (source === 'claude' || source === 'codex') {
				const proj = project;
				const title = item?.label ?? '';
				const notice = toast.info(t('shell.historySource.importing', { title }), { duration: 0 });
				const dir = workDir;
				importNativeSession(source, dir, sid)
					.then((copy) => store.openSaved(proj, copy.id, copy.title || title, source, dir))
					.catch((e) => toast.error(t('shell.historySource.importFail', { msg: String(e) })))
					.finally(() => toast.dismiss(notice));
				return;
			}
			if (backend === 'codex' || backend === 'claude' || backend === 'jucode') {
				store.openSaved(project, sid, item?.label ?? '', backend, workDir);
				return;
			}
		}
		send({ op: 'command', input: command });
		chat.closePicker();
	}
	// Not through selectRow: that closes the model list, and the menu stays
	// open while the effort changes.
	function setEffort(effort: string) {
		if (session.draft) {
			chat.effort = effort;
			session.draftPick = { ...session.draftPick, effort };
			return;
		}
		if (chat.model && !pendingModel && !chat.switching) send({ op: 'command', input: `/model ${chat.model} ${effort}` });
	}
	// Thinking summaries follow settings: a running engine that reports the
	// other way is switched (between turns; a start already gets the setting).
	// Asked once per value: an engine that doesn't take it isn't asked again.
	let thinkingAsked: boolean | null = null;
	$effect(() => {
		const want = prefs.thinkingSummaries;
		if (chat.thinkingSummaries === null || chat.thinkingSummaries === want || thinkingAsked === want) return;
		if (chat.busy || chat.restarting || chat.engineState === 'exited') return;
		// Asleep or a draft: the engine it wakes to (or starts) starts with the
		// setting; asking a draft would start its engine.
		if (session.dormant || session.draft) return;
		thinkingAsked = want;
		untrack(() => send({ op: 'command', input: `/thinking ${want ? 'on' : 'off'}` }));
	});
	// Claude Code's session switches (SessionSwitches).
	function setSwitch(name: SessionSwitch, on: boolean) {
		const command = name === 'ultracode' ? '/effort ultracode' : `/${name}`;
		send({ op: 'command', input: `${command} ${on ? 'on' : 'off'}` });
	}
	function pickerKey(e: KeyboardEvent) {
		if (!chat.picker) return;
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
		send({ op: 'command', input: `/trust ${answer}` });
		chat.trustPrompt = null;
	}
	// Picker navigation only runs on the active pane (the picker overlay itself
	// is gated the same way), so two visible chats never fight over the keys.
	function onWindowKey(e: KeyboardEvent) {
		if (!isActive || e.defaultPrevented) return;
		pickerKey(e);
	}

	// The position this pane last pinned to the end, and the last one seen.
	let pinnedTop = -1;
	let lastTop = 0;
	// Content height at the last scroll event: a pull-back after it shrank
	// arrives as a scroll event a frame later.
	let lastHeight = 0;
	function onScroll() {
		if (!scroller) return;
		// The scroll event of our own pin says nothing about the reader, nor
		// does the view held still where a click left it.
		if (scroller.scrollTop !== pinnedTop && (atBottom || !anchor?.holding())) atBottom = followAfterScroll(atBottom, scroller, lastTop, lastHeight);
		lastTop = scroller.scrollTop;
		lastHeight = scroller.scrollHeight;
		farFromEnd = fromEnd(scroller) > 60;
	}
	/** Wheel up leaves the end. Caught at the input: WebKit applies the
	 *  scroll a frame later, and while a reply streams the next pin would
	 *  undo it before any scroll event shows it. */
	function onWheel(e: WheelEvent) {
		if (e.deltaY < 0) atBottom = false;
	}
	function pin() {
		if (!scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
		pinnedTop = scroller.scrollTop;
	}
	// Follow the content as it grows. The smoothed reveal changes height every
	// frame, which a scroll-event listener can't see, so observe the content's
	// size directly. Idle (a conversation loading): stick to the bottom.
	// While a reply streams: reveal it only until the latest message reaches
	// the top, then hold still, so the text being read never moves.
	let contentEl = $state<HTMLElement | null>(null);
	// What a click opens or closes stays under the pointer (chatAnchor).
	let anchor: ClickAnchor | null = null;
	$effect(() => {
		if (!contentEl || !scroller) return;
		const held = (anchor = clickAnchor(scroller, contentEl));
		const ro = new ResizeObserver(() => {
			if (!scroller || !contentEl) return;
			if (atBottom) {
				held.release();
				const top = followTop(scroller, contentEl, chat.busy);
				scroller.scrollTop = top;
				pinnedTop = scroller.scrollTop;
				if (shortOfEnd(scroller, top)) atBottom = false;
			}
			farFromEnd = fromEnd(scroller) > 60;
		});
		ro.observe(contentEl);
		return () => {
			ro.disconnect();
			held.destroy();
			anchor = null;
		};
	});
	async function scrollToEnd(force = false) {
		await tick();
		if (scroller && (atBottom || force)) {
			pin();
			atBottom = true;
			farFromEnd = false;
		}
	}
	function jumpToBottom() {
		anchor?.release();
		atBottom = true;
		scrollToEnd(true);
	}
	function editMessage(text: string, files?: string[]) {
		input = text;
		for (const path of files ?? []) attach({ path, image: false }, false);
		composerEl?.focus();
	}
	// A quoted passage drops in at the caret as a chip naming its opening words.
	function citeText(text: string) {
		const id = ++quoteSeq;
		quotes.push({ id, text });
		const words = text.replace(/[\]\s]+/g, ' ').trim();
		const token = `[引用#${id}:${words.length > 24 ? `${words.slice(0, 24)}…` : words}]`;
		if (composerRef) composerRef.insertToken(token);
		else input = input && !/\s$/.test(input) ? `${input} ${token} ` : `${input}${token} `;
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
	// Before each turn, snapshot the working tree so a later rewind can restore
	// files to this turn's starting state (the engines rewind only the
	// conversation) and a fork's worktree can start from it. Fire-and-forget;
	// the sha lands under its turn index.
	function captureCheckpoint() {
		const c = chat;
		const cwd = workDir;
		// Rewinds (Codex, Claude Code) and forks into a worktree restore them;
		// an ACP agent does neither.
		if (!cwd || c.backendId === 'acp') return;
		const idx = c.userTurns;
		gitCheckpointCapture(cwd, session.id, idx)
			.then((sha) => {
				if (sha) c.fileCheckpoints[idx] = sha;
			})
			.catch(() => {});
	}
	// Restore the working tree to the checkpoint captured before the target turn:
	// this run's, else the one kept for the session (an earlier run of the app).
	function restoreCheckpoint(userIndex: number) {
		const cwd = workDir;
		if (!cwd) return;
		gitCheckpointRestore(cwd, chat.fileCheckpoints[userIndex] ?? '', session.id, userIndex)
			.then((safety) => {
				if (safety === null) toast.info(t('chat.rewindNoCheckpoint'));
			})
			.catch((e) => toast.error(t('chat.rewindRestoreFailed', { error: String(e) })));
	}

	// Where a reply's relative paths are read from: the directory the engine
	// runs in, then the project root and its added directories.
	const fileRoots = $derived([...new Set([chat.cwd, workDir, project?.path, ...(project?.dirs ?? [])].filter((r): r is string => !!r))]);
	/** The project directory a file is in (root first), for its relative path
	 *  and the editor's root. */
	function rootOf(abs: string): string | undefined {
		const under = (r: string) => {
			const base = r.replace(/[\\/]+$/, '');
			return abs.startsWith(base) && /[\\/]/.test(abs.charAt(base.length));
		};
		return [project?.path, ...(project?.dirs ?? []), workDir, chat.cwd].find((r): r is string => !!r && under(r));
	}
	const fileTarget = (href: string) => {
		const ref = parseFileHref(href);
		return { ref, target: ref.path ? resolveFileRef(fileRoots, ref.path).catch(() => null) : Promise.resolve(null) };
	};

	// A path in a reply that names no file shows as plain text.
	provideFileCheck(async (href) => {
		const { ref, target } = fileTarget(href);
		return !!ref.path && !!(await target);
	});

	// Open a file a chat link names. HTML opens in the built-in browser
	// (rendered) or the editor (source) per preference, images in the viewer,
	// other text in the editor; what the editor can't show (an .apk, a PDF) is
	// shown in the file manager. A file outside the project opens with its own
	// folder as the editor's root.
	async function openChatFile(href: string) {
		const { ref, target: pending } = fileTarget(href);
		if (!ref.path) return;
		const target = await pending;
		if (!target) return void toast.error(t('chat.fileNotFound', { path: ref.path }));
		openTarget(target, ref);
	}
	function openTarget(target: FileTarget, ref: FileRef) {
		const abs = target.path;
		const ext = pathExt(abs);
		if ((ext === 'html' || ext === 'htm') && prefs.htmlOpenInBrowser) browser.open(abs);
		else if (isImage(abs)) imageViewer.open([{ path: abs }]);
		else if (!target.text) revealItemInDir(abs).catch((e) => toast.error(t('chat.fileOpenFailed', { path: ref.path, error: String(e) })));
		else {
			const at = ref.line ? { line: ref.line, col: ref.col } : undefined;
			editorStore.open(abs, rootOf(abs) ?? abs.replace(/[\\/][^\\/]*$/, ''), at).catch((e) => toast.error(t('chat.fileOpenFailed', { path: ref.path, error: String(e) })));
		}
	}

	// A file a turn edited opens in the editor with that turn's changes: the
	// file before it worked out from the turn's edits, or git HEAD when that
	// can't be (edited since; a change without its own diff).
	async function openEdited(file: EditedFile) {
		const { ref, target: pending } = fileTarget(file.path);
		const target = await pending;
		if (!target) return void toast.error(t('chat.fileNotFound', { path: ref.path }));
		if (!target.text) return openTarget(target, ref);
		const abs = target.path;
		try {
			const opened = await editorStore.open(abs, rootOf(abs) ?? abs.replace(/[\\/][^\\/]*$/, ''));
			// Open before the agent edited it: the file as it is now.
			if (!opened.dirty) await editorStore.reload(opened.path);
			const tab = editorStore.tab(opened.path) ?? opened;
			const base = file.diffs ? turnBase(tab.doc, file.diffs) : null;
			editorStore.showTurn(tab.path, base);
			if (base == null) toast.info(t('editor.turnBaseUnknown'));
		} catch (e) {
			toast.error(t('chat.fileOpenFailed', { path: ref.path, error: String(e) }));
		}
	}

	// A scheduled task the agent proposed opens the task dialog filled in:
	// this session's folder and engine, the proposal's prompt and times.
	let proposing = $state<Partial<ScheduleDraft> | null>(null);
	function scheduleFrom(p: Proposal) {
		const engine = chat.backendId === 'claude' || chat.backendId === 'codex' ? chat.backendId : 'jucode';
		proposing = {
			name: p.name,
			prompt: p.prompt,
			repeat: p.repeat,
			time: p.time,
			...(p.days ? { days: p.days } : {}),
			...(p.date ? { date: p.date } : {}),
			cwd: workDir || '',
			engine,
			options: engine === 'jucode' ? {} : { jucode_gateway: !!session.gateway },
			origin: p.id
		};
	}
	const revealFile = (path: string) => revealItemInDir(path).catch((e) => toast.error(String(e)));
	/** A session this one started (`start_session`). */
	function openChild(id: string) {
		const listed = daemonState.sessions.find((s) => s.session === id);
		store.openDaemonSession(listed?.cwd ?? workDir ?? '', id, listed?.title, listed?.engine, listed?.gateway, listed?.agent, true, listed?.project);
	}

	// Right-click on a file link (or a file the user attached): open, attach,
	// copy its path, show it in the file manager.
	let fileMenu = $state<{ x: number; y: number; ref: FileRef; target: FileTarget | null } | null>(null);
	let fileMenuEl = $state<HTMLDivElement>();
	let fileMenuPos = $state({ x: 0, y: 0 });
	async function onFileMenu(e: MouseEvent) {
		const el = (e.target as Element).closest('a[href], [data-file]');
		const href = el?.getAttribute('data-file') ?? el?.getAttribute('href');
		if (!href || /^(https?:|mailto:|#)/i.test(href) || el?.classList.contains('dead')) return;
		e.preventDefault(); // before the await: the app-wide text menu stays out
		const { ref, target } = fileTarget(href);
		if (!ref.path) return;
		const at = { x: e.clientX, y: e.clientY };
		const [found] = await Promise.all([target, editors.list.length ? null : editors.load()]);
		fileMenu = { ...at, ref, target: found };
		fileMenuPos = at;
	}
	const revealLabel = isMac() ? 'chat.fileMenu.revealMac' : /Windows/.test(navigator.userAgent) ? 'chat.fileMenu.revealWin' : 'chat.fileMenu.revealLinux';
	const fileMenuItems = $derived.by((): PopMenuItem[] => {
		if (!fileMenu) return [];
		if (!fileMenu.target)
			return [
				{ key: 'copyPath', label: t('chat.fileMenu.copyPath') },
				{ key: 'copyName', label: t('chat.fileMenu.copyName') }
			];
		return [
			{ key: 'open', label: t('chat.fileMenu.open') },
			...(editors.preferred ? [{ key: 'editor', label: t('editor.external.openIn', { name: editors.preferred.name }) }] : []),
			{ key: 'attach', label: t('chat.fileMenu.attach') },
			{ key: 'copyAbs', label: t('chat.fileMenu.copyAbs') },
			...(rootOf(fileMenu.target.path) ? [{ key: 'copyRel', label: t('chat.fileMenu.copyRel') }] : []),
			{ key: 'copyName', label: t('chat.fileMenu.copyName') },
			{ key: 'reveal', label: t(revealLabel) }
		];
	});
	// Keep the menu inside the pane's window once its size is known.
	$effect(() => {
		if (!fileMenu || !fileMenuEl) return;
		const r = fileMenuEl.querySelector('.pm')?.getBoundingClientRect();
		if (!r) return;
		fileMenuPos = {
			x: Math.min(fileMenu.x, window.innerWidth - r.width - 8),
			y: fileMenu.y + r.height + 8 > window.innerHeight ? Math.max(8, fileMenu.y - r.height) : fileMenu.y
		};
	});
	function runFileMenu(key: string) {
		const m = fileMenu;
		fileMenu = null;
		if (!m) return;
		const abs = m.target?.path ?? '';
		const root = abs ? rootOf(abs) : undefined;
		const copy = (text: string) => void writeText(text).catch((e) => toast.error(String(e)));
		if (key === 'open' && m.target) openTarget(m.target, m.ref);
		else if (key === 'editor' && abs && editors.preferred) {
			const { id, name } = editors.preferred;
			editors.open(id, abs, m.ref, root).catch((e) => toast.error(t('editor.external.failed', { name, error: String(e) })));
		}		else if (key === 'attach' && abs) {
			addAttachment(abs);
			composerEl?.focus();
		} else if (key === 'copyAbs') copy(abs);
		else if (key === 'copyRel' && root) copy(abs.slice(root.replace(/[\\/]+$/, '').length + 1));
		else if (key === 'copyPath') copy(m.ref.path);
		else if (key === 'copyName') copy((abs || m.ref.path).split(/[\\/]/).pop() ?? '');
		else if (key === 'reveal' && abs) revealItemInDir(abs).catch((e) => toast.error(String(e)));
	}

	// A conversation the engine has (not a draft's) forks from a reply, here
	// or in a worktree of its own (ForkDialog).
	// Nothing said yet: the welcome and the composer sit in the middle.
	const fresh = $derived(!(chat.booting && chat.engineState !== 'exited') && chat.messages.length === 0 && !chat.busy);
	const canFork = $derived(caps(chat).fork && !!chat.sessionId && !session.draft);
	let forkAt = $state<number | null>(null);

	// A fork: the conversation it came from (when it is in this window), and
	// what it found, written up for that conversation's composer.
	const forkSource = $derived(session.forkedFrom ? store.allSessions.find((s) => s.chat.sessionId === session.forkedFrom!.sid) : undefined);
	let bringing = $state(false);
	async function bringBack() {
		const from = session.forkedFrom;
		const src = forkSource;
		if (!from || bringing) return;
		if (!src) return toast.error(t('chat.fork.sourceGone'));
		const prompt = handoffPrompt(chat.messages, from.turns, (session.worktree ?? project?.worktree)?.branch);
		if (!prompt) return toast.info(t('chat.fork.nothingYet'));
		const llm = llmTarget(providersList, chat);
		if (!llm) return toast.error(t('chat.fork.noModel'));
		bringing = true;
		try {
			const text = (await generateText(llm.provider, llm.baseUrl, llm.format, llm.model, HANDOFF_SYSTEM, prompt)).trim();
			if (!text) throw new Error(t('chat.fork.empty'));
			// Into the original's composer, to read and send.
			src.chat.pendingFill = text;
			store.activeId = src.id;
			toast.info(t('chat.fork.brought'));
		} catch (e) {
			toast.error(String(e));
		} finally {
			bringing = false;
		}
	}
	/** The files of the message a rewind takes back, attached again with its text. */
	let rewindFiles: string[] = [];
	function rewindToMessage(text: string, userIndex: number, files?: string[]) {
		rewindFiles = files ?? [];
		// codex (thread/rollback) and claude (resume-at-uuid respawn) rewind without
		// the jucode checkpoint_view round-trip — confirm directly from the index.
		if (chat.backendId === 'codex' || chat.backendId === 'claude') {
			chat.pendingRewind = { id: `${chat.backendId}:${userIndex}`, text };
			return;
		}
		chat.rewindIntent = { userIndex, text };
		send({ op: 'command', input: '/rewind' });
	}
	function confirmRewind() {
		const pr = chat.pendingRewind;
		if (!pr) return;
		if (pr.id.startsWith('codex:')) {
			const userIndex = Number(pr.id.slice('codex:'.length));
			const numTurns = chat.userTurns - userIndex;
			if (numTurns > 0) send({ op: 'command', input: `/rewind ${numTurns}` });
			// codex rolls back its own history; mirror it in our projected transcript.
			chat.truncateToUserTurn(userIndex);
			restoreCheckpoint(userIndex); // …and the files it changed
		} else if (pr.id.startsWith('claude:')) {
			const userIndex = Number(pr.id.slice('claude:'.length));
			// Respawn resuming at the previous turn's assistant uuid (or fresh at 0).
			store.rewindClaudeSession(session.id, chat.claudeRewindTarget(userIndex), userIndex);
			restoreCheckpoint(userIndex);
		} else {
			send({ op: 'command', input: `/rewind ${pr.id}` });
		}
		input = pr.text;
		for (const path of rewindFiles) attach({ path, image: false }, false);
		rewindFiles = [];
		chat.pendingRewind = null;
		composerEl?.focus();
	}

	// The page's pane registry: global flows (palette commands, ⌘F, file drops,
	// element picks) reach the active pane through this surface.
	const api: ChatPaneApi = {
		runCommand: (cmd) => send({ op: 'command', input: cmd }),
		addAttachment,
		insertWebRef,
		toggleFind: () => (showFind ? closeFind() : openFind()),
		scrollToEnd: () => void scrollToEnd(),
		focusComposer: () => composerEl?.focus(),
		stop: () => {
			if (chat.busy) stop();
		},
		openModelMenu: () => composerRef?.openModelMenu(),
		planAction
	};
	$effect(() => {
		onRegister?.(session.id, api);
		return () => onUnregister?.(session.id, api);
	});

	onMount(() => {
		scrollToEnd(true);
	});
	onDestroy(() => {
		if (findDebounce != null) clearTimeout(findDebounce);
		// A conversation left long enough is unmounted (workbench/view.ts KEPT):
		// stash the draft so the composer text survives (pendingFill restores it).
		if (input.trim()) chat.pendingFill = input;
	});
</script>

<svelte:window onkeydown={onWindowKey} onfocus={() => isActive && refreshGitBranch()} />


<!-- The running turn, quietly, under the conversation: how long so far. -->
{#snippet turnClock()}
	{#if chat.busy && chat.turnStartedAt}
		<div class="turn-clock" role="status"><LoaderCircleIcon size={12} class="spin" /><CallTimer since={chat.turnStartedAt} /></div>
	{/if}
{/snippet}

<div class="chatpane">
	<div class="chatcol" class:fresh style:--chat-w="{chatW}px" style:--chat-pad="{chatPad}px">
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

		<div class="mainwrap" bind:clientWidth={wrapW}>
		{#if session.forkedFrom}
			<!-- A fork: where it came from, and taking what it found back there. -->
			<div class="forkbar">
				<GitForkIcon size={14} />
				{#if forkSource}
					<button class="forklink" onclick={() => (store.activeId = forkSource!.id)} title={t('chat.fork.open')}>{t('chat.fork.from', { title: session.forkedFrom.title || forkSource.chat.title })}</button>
				{:else}
					<span>{t('chat.fork.from', { title: session.forkedFrom.title })}</span>
				{/if}
				{#if session.worktree ?? project?.worktree}<span class="forkbranch">{(session.worktree ?? project?.worktree)!.branch}</span>{/if}
				<span class="grow"></span>
				<Button size="sm" variant="ghost" onclick={bringBack} disabled={bringing || !forkSource || chat.busy} title={forkSource ? t('chat.fork.bringHint') : t('chat.fork.sourceGone')}>
					{#if bringing}<LoaderCircleIcon size={14} class="spin" /> {t('chat.fork.bringing')}{:else}{t('chat.fork.bring')}{/if}
				</Button>
			</div>
		{/if}
		<main bind:this={scroller} onscroll={onScroll} onwheel={onWheel}>
			<!-- Pressing inside the conversation (opening a card, selecting text) stops following the end: what was pressed stays under the pointer instead of being pushed up as the reply grows. -->
			<div bind:this={contentEl} onpointerdowncapture={() => (atBottom = false)} oncontextmenu={onFileMenu} role="presentation">
				<MessageList bind:this={messageList} bind:mark messages={chat.messages} follow={() => atBottom} busy={turnOpen} foldTurns={prefs.foldTurns} {streamingMsg} {streamingReasoning} call={chat.call} retry={chat.retry} autoRetry={chat.autoRetry} onAutoRetryNow={() => autoRetry.now(chat)} onAutoRetryCancel={() => autoRetry.cancel(chat)} {findActive} {scroller} tail={turnClock} onEdit={editMessage} onCite={citeText} onRewind={rewindToMessage} onFile={openChatFile} onDismiss={(m) => (chat.messages = chat.messages.filter((x) => x !== m))} backend={chat.backendId} onErrorAction={fixError} traceOf={traceOf} agents={allAgents} onOpenAgent={openAgent} onPlan={planAction} {planMode} onOpenPlan={(id) => planPages.open(session.id, id)} root={workDir || ''} onReveal={revealFile} onSchedule={scheduleFrom} scheduleCreated={(id) => daemonState.schedules.some((s) => s.origin === id)} onOpenSession={openChild} onOpenEdited={openEdited} onFork={canFork ? (keep) => (forkAt = keep) : undefined} />
			</div>
			{#if proposing}
				<ScheduleDialog preset={proposing} projects={store.workspaceProjects} onClose={() => (proposing = null)} />
			{/if}
			{#if fileMenu}
				<div class="file-menu" bind:this={fileMenuEl} style:left="{fileMenuPos.x}px" style:top="{fileMenuPos.y}px">
					<PopMenu items={fileMenuItems} title={fileMenu.target ? undefined : t('chat.fileMenu.missing')} placement="down-left" onSelect={runFileMenu} onClose={() => (fileMenu = null)} />
				</div>
			{/if}
			{#if chat.booting && chat.engineState !== 'exited'}
				<div class="welcome spawning">
					<span class="spawn-spin"><LoaderCircleIcon size={28} class="spin" /></span>
					<p class="welcome-tip">{t('shell.spawning')}</p>
				</div>
			{:else if fresh}
				<div class="welcome">
					{#if session.draft && !project?.chats}<NewSessionPicker {store} {session} />{:else}<p class="welcome-tip">{t('shell.welcomeTip')}</p>{/if}
					<div class="welcome-hints">
						<span><kbd>/</kbd> {t('shell.hintCommand')}</span>
						<span><kbd>@</kbd> {t('shell.hintRef')}</span>
						<span><kbd>⌘K</kbd> {t('shell.hintPalette')}</span>
						<span>{t('shell.hintImage')}</span>
					</div>
				</div>
			{/if}
		</main>
		{#if marks.length > 1}
			<TurnRail {marks} current={mark} onJump={(n) => messageList?.jumpToMark(n)} />
		{/if}
		</div>
		{#if farFromEnd}
			<button class="jump" style:bottom="{bottomH + 14}px" onclick={jumpToBottom} aria-label="scroll to bottom" out:fadeOut><ChevronDownIcon size={16} /></button>
		{/if}

		<div class="bottom" bind:clientHeight={bottomH}>
			{#if chat.engineState === 'exited'}
				<div class="approval-wrap" in:paneIn out:paneOut>
					<div class="enginedown">
						<span class="ed-text">{t('shell.engineDown')}</span>
						<Button variant="primary" size="sm" onclick={() => store.restartSession(session.id, true)}>{t('shell.restartEngine')}</Button>
					</div>
				</div>
			{/if}
			{#if chat.cutTurn && chat.engineState !== 'exited' && !chat.busy}
				<!-- The engine went away mid-turn and is back: pick the turn up. -->
				<div class="approval-wrap" in:paneIn out:paneOut>
					<div class="cutturn" role="status">
						<span class="ct-text">{t('chat.cut.notice')}</span>
						<Button variant="ghost" size="sm" onclick={() => (chat.cutTurn = null)}>{t('chat.cut.dismiss')}</Button>
						<Button variant="primary" size="sm" onclick={continueCut}>{t('chat.cut.continue')}</Button>
					</div>
				</div>
			{/if}
			<!-- Agent questions render in the composer tray; the card keeps plain
			     tool approvals (commands, edits, plans). -->
			{#if chat.pendingApproval && !chat.pendingApproval.questions?.length}
				<div class="approval-wrap" out:paneOut>
					{#key chat.pendingApproval.callId}
						<ApprovalCard approval={chat.pendingApproval} onRespond={respondApproval} ruleScopes={caps(chat).ruleScopes} keys={isActive} />
					{/key}
				</div>
			{/if}

			{#if chat.inTerminal}
				<p class="interm" in:paneIn out:paneOut>
					{t('chat.inTerminal')}
					<!-- Opened on another client: this tile can view it too. -->
					{#if chat.terminal}
						<Button size="sm" variant="ghost" onclick={() => (session.surface = 'tui')}>{t('chat.viewTerminal')}</Button>
					{/if}
				</p>
			{/if}
			{#if chat.rateLimit}
				<UsageLimit
					limit={chat.rateLimit}
					backend={chat.backendId}
					resumeArmed={chat.resumeAtReset}
					onResume={() => limitResume.arm(chat)}
					onCancelResume={() => limitResume.cancel(chat)}
					onDismiss={() => {
						limitResume.cancel(chat);
						chat.rateLimit = null;
					}}
				/>
			{/if}

			<SideAnswers {chat} />

			{#if chat.planRevising}
				<div class="approval-wrap" in:paneIn out:paneOut>
					<div class="revising">
						<ClipboardListIcon size={14} />
						<span class="rv-label">{t('chat.planCard.revising')}</span>
						<span class="rv-hint">{t('chat.planCard.revisingHint')}</span>
						<button class="rv-x" onclick={() => (chat.planRevising = null)} aria-label={t('chat.planCard.cancelRevise')} title={t('chat.planCard.cancelRevise')}><XIcon size={14} /></button>
					</div>
				</div>
			{/if}

			<Composer
				{chat}
				foot={statusBell}
				onContextBreakdown={session.draft || chat.engineState === 'exited' ? undefined : () => send({ op: 'context_usage' })}
				bind:this={composerRef}
				bind:input
				bind:attachments
				onImage={addImage}
				bind:el={composerEl}
				onSubmit={submit}
				onStop={stop}
				onSteer={(index) => send({ op: 'steer', index })}
				onInterrupt={(index) => send(interruptFor(index))}
				onUnqueue={(index) => send({ op: 'unqueue', index })}
				onDiscard={(index) => send({ op: 'unqueue', index, discard: true })}
				onMove={(index, to) => send({ op: 'queue_move', index, to })}
				onPick={pickFiles}
				onModel={openModelPicker}
				onModelSelect={selectRow}
				onModelClose={() => chat.closePicker()}
				modelRows={filteredRows}
				modelSearch={showPickerSearch}
				runTasks={[entry.plan ? t('dock.agents.pillPlan', { done: plan.done, total: plan.total }) : '', entry.running ? t('dock.agents.pill', { n: entry.running }) : ''].filter(Boolean).join(' · ')}
				onTasks={() => (chat.tasksOpen ? (chat.tasksOpen = false) : openTasks(null))}
				modelLegacy={legacyCount && !pickerQuery.trim() ? { count: legacyCount, shown: showLegacy, onToggle: () => (showLegacy = !showLegacy) } : undefined}
				{backendLocked}
				{providerChoice}
				toolProvider={toolModel
					? {
							model: toolModel.jucode ?? toolModel.key,
							name: BACKEND_LABELS[chat.backendId],
							// Each side is offered whatever the current model: one
							// without it starts on its own (gatewayModel, localModel).
							local: toolModel.local !== undefined || chat.modelCatalog.some((x) => x.listed !== false),
							jucode: toolModel.jucode !== undefined || providers.includes('jucode'),
							onJucode: toolMode === 'jucode',
							custom: customProvider?.name,
							customs:
								session.draft && (chat.backendId === 'claude' || chat.backendId === 'codex')
									? (toolProviderConfigs[chat.backendId]?.providers ?? []).map((p) => ({
											id: p.id,
											name: p.name,
											model: p.model,
											models: p.models.length
										}))
									: undefined,
							customId: customProvider?.id,
							group: session.group ?? '',
							groups: store.takesSessionGroup(session),
							onPick: (choice) => pickProvider(toolModel, choice)
						}
					: undefined}
				{gitBranch}
				gitCwd={workDir}
				repoName={project?.name ?? ''}
				onBranchChanged={refreshGitBranch}
				onBackend={(b, acpAgent) => store.switchBackend(session.id, b, acpAgent)}
				onSessionOption={(id, value) => send({ op: 'set_session_option', id, value })}
				acpGateway={chat.backendId === 'acp' && chat.agentGateway
					? { on: toolMode === 'jucode', onChange: (on) => void store.applyToolProfile(session.id, on ? 'jucode' : 'system') }
					: undefined}
				bind:pickerQuery
			bind:pickerSelIdx={selIdx}
				onEffort={setEffort}
				onSwitch={setSwitch}
				effortDisabled={!!pendingModel || chat.switching}
				onApproval={setApprovalMode}
				onRespond={respondApproval}
			/>
		</div>
		{#if chat.agentPage}
			<div class="agentpage" in:paneIn>
				<SubagentPage {chat} agentId={chat.agentPage} rows={allAgents} parentTitle={chat.title || t('shell.untitled')} active={isActive} onOp={send} onOpen={(id) => openTasks(id)} onBack={closeAgentPage} />
			</div>
		{/if}
	</div>
	{#if chat.tasksOpen}
		<aside class="tasks" aria-label={t('dock.agents.title')} in:sideIn out:sideOut>
			<TaskPanel {chat} rows={allAgents} canOpen={canOpenAgent} onOp={send} onOpenAgent={(id) => openTasks(id)} onClose={() => (chat.tasksOpen = false)} />
		</aside>
	{/if}
</div>

{#if isActive && chat.trustPrompt}
	<!-- The engine waits for an answer: no close button, Escape or scrim close. -->
	<Modal label={t('shell.trustLabel')} dismissible={false} onClose={() => {}}>
		<div class="trust-body">
			<h2 class="trust-q">{t('shell.trustQuestion')}</h2>
			<p>{t('shell.trustBody')}</p>
			<code class="trust-path">{chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd}</code>
		</div>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => respondTrust('no')}>{t('shell.distrust')}</Button>
			{#if chat.trustPrompt?.repoRoot}<Button onclick={() => respondTrust('repo')}>{t('shell.trustRepo')}</Button>{/if}
			<Button variant="primary" onclick={() => respondTrust('yes')}>{t('shell.trust')}</Button>
		{/snippet}
	</Modal>
{/if}

{#if isActive && chat.picker && chat.picker.kind !== 'model'}
	<Picker
		{chat}
		title={pickerTitle}
		{activeModel}
		rows={filteredRows}
		showSearch={showPickerSearch}
		bind:query={pickerQuery}
		bind:selIdx
		onClose={() => chat.closePicker()}
		onSelect={selectRow}
		onEffort={setEffort}
		header={chat.picker.kind === 'resume' && chat.picker.history ? historyTabs : undefined}
	/>
{/if}

{#snippet historyTabs()}
	<Segmented bind:value={historyTab} options={historySources} onChange={showHistorySource} />
{/snippet}

{#if isActive && chat.pendingRewind}
	<Modal title={t('shell.rewindQuestion')} onClose={() => (chat.pendingRewind = null)}>
		<div class="trust-body">
			<p>{@html t('shell.rewindBody')}</p>
			<code class="trust-path">{chat.pendingRewind.text.slice(0, 120)}</code>
		</div>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => (chat.pendingRewind = null)}>{t('common.cancel')}</Button>
			<Button variant="primary" onclick={confirmRewind}>{t('shell.rewindConfirm')}</Button>
		{/snippet}
	</Modal>
{/if}

{#if isActive && forkAt !== null}
	<ForkDialog
		repo={session.worktree?.mainRepoPath ?? project?.worktree?.mainRepoPath ?? project?.path ?? workDir ?? ''}
		cwd={workDir ?? ''}
		title={chat.title}
		session={session.id}
		keep={forkAt}
		latest={forkAt >= chat.userTurns}
		checkpoint={chat.fileCheckpoints[forkAt]}
		onFork={(worktree) => {
			const keep = forkAt!;
			forkAt = null;
			store.forkSession(session.id, keep, worktree);
		}}
		onClose={() => (forkAt = null)}
	/>
{/if}

{#snippet statusBell()}<StatusStrip {chat} />{/snippet}

<style>
	.file-menu {
		position: fixed;
		z-index: 300;
		width: 0;
		height: 0;
	}
	.file-menu :global(.pm) {
		top: 0;
		min-width: 180px;
	}
	.chatpane {
		position: relative;
		height: 100%;
		display: flex;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
		container-type: inline-size;
	}
	.chatcol {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	/* A subagent's page covers the conversation, which stays mounted below. */
	.agentpage {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	/* The background tasks region: beside the conversation, or over it when
	   the pane is too narrow for both. */
	.tasks {
		flex: none;
		width: clamp(340px, 34%, 460px);
		min-height: 0;
		border-left: 1px solid var(--hairline);
		background: var(--bg);
	}
	@container (max-width: 760px) {
		.tasks {
			position: absolute;
			inset: 0;
			z-index: 20;
			width: auto;
			border-left: none;
		}
	}
	.turn-clock {
		display: inline-flex;
		align-self: flex-start;
		align-items: center;
		gap: 6px;
		padding: 2px;
		color: var(--dim2);
		animation: fade var(--t-med) var(--ease-out);
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
		animation: jump-in var(--t-med) var(--ease-out);
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring),
			box-shadow var(--t-med) var(--ease-out);
	}
	/* pop-in variant that keeps the horizontal centering transform */
	@keyframes jump-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%);
		}
	}
	.jump:hover {
		/* --surface2 is translucent; layer it over --panel so the transcript doesn't show through */
		background: linear-gradient(var(--surface2), var(--surface2)), var(--panel);
		transform: translateX(-50%) translateY(-1px);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.32);
	}
	.jump:active {
		transform: translateX(-50%) scale(0.92);
	}
	/* Match the composer's outer frame (the column plus --chat-pad a side) so
	   the approval box lines up flush with the input box. */
	.approval-wrap {
		max-width: calc(var(--chat-w) + 2 * var(--chat-pad));
		width: 100%;
		margin: 0 auto;
		padding: 0 var(--chat-pad) 10px;
	}
	.enginedown {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		background: color-mix(in oklab, var(--err) 10%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--err) 38%, transparent);
		border-radius: var(--r);
	}
	.ed-text {
		font-size: var(--fs-sm);
		color: var(--err);
		font-weight: 500;
	}
	.cutturn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px 8px 14px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r);
	}
	.ct-text {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-sm);
		color: var(--dim);
	}

	.revising {
		display: flex;
		align-items: center;
		gap: 8px;
		width: fit-content;
		max-width: 100%;
		padding: 5px 6px 5px 12px;
		border-radius: var(--r);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-xs);
	}
	.rv-label {
		flex: none;
		font-weight: 500;
	}
	.rv-hint {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
	}
	.rv-x {
		display: inline-flex;
		flex: none;
		padding: 3px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.rv-x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.interm {
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		color: var(--dim);
		text-align: center;
	}

	.mainwrap {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	/* Over a fork's conversation, in its column: it does not scroll away. */
	.forkbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		padding: 6px max(var(--chat-pad), calc((100% - var(--chat-w)) / 2));
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.forkbar > :global(svg) {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.forklink {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		cursor: pointer;
	}
	.forklink:hover {
		color: var(--text);
	}
	.forkbranch {
		flex-shrink: 0;
		font-family: var(--font-mono);
		color: var(--dim2);
	}
	.forkbar .grow {
		flex: 1;
	}
	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 22px 18px 26px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		/* Full width, so the scrollbar sits at the pane's edge; the padding
		   centres the column. */
		padding-inline: max(var(--chat-pad), calc((100% - var(--chat-w)) / 2));
	}
	/* The composer in the middle of the pane, the welcome just above it: the
	   space left is split between the conversation and a spacer below. */
	.chatcol.fresh::after {
		content: '';
		flex: 1 1 0;
	}
	.chatcol.fresh .welcome {
		margin: auto auto 0;
	}
	.welcome {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		animation: rise var(--t-slow) var(--ease-out) both;
	}
	.spawn-spin {
		display: inline-flex;
		color: var(--accent);
	}
	.welcome-tip {
		margin: 0;
		font-size: var(--fs-md);
		color: var(--dim);
	}
	.welcome-hints {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px 16px;
		margin-top: 6px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.welcome-hints span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.welcome-hints kbd {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		padding: 1px 6px;
	}

	/* ---------- modals (trust / rewind) ---------- */
	.trust-body {
		font-size: var(--fs-md);
		line-height: 1.55;
	}
	.trust-q {
		margin: 6px 0 12px;
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.trust-body p {
		margin: 0 0 12px;
	}
	.trust-path {
		display: block;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r);
		padding: 8px 10px;
		word-break: break-all;
	}
</style>
