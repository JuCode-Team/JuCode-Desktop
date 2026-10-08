<script lang="ts" module>
	import type { WebRef } from '$lib/browser.svelte';

	/** Configured provider (builtin or custom) with its model list — the page
	 *  loads these once and every pane shares them for the model picker. */
	export interface ProviderOption {
		id: string;
		base_url: string;
		format: string;
		models: { name: string; context_window?: number; reasoning_efforts?: string[] }[];
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
	}
</script>

<script lang="ts">
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { open } from '@tauri-apps/plugin-dialog';
	import { treeRows } from '$lib/tree';
	import { buildSetApprovalModeOp, needsClaudeYoloRespawn, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import {
		processVideo,
		sessionHistory,
		nativeSessions,
		importNativeSession,
		git,
		gitCheckpointCapture,
		gitCheckpointRestore,
		resolveFileRef,
		type Op
	} from '$lib/protocol';
	import { buildModelRows, toolModels, type ToolModel } from '$lib/composer/modelRows';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { BACKEND_LABELS, caps } from '$lib/backends';
	import { defaultEffort } from '$lib/composer/effort';
	import { dispatch } from '$lib/backends/router';
	import { browser } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { t } from '$lib/i18n';
	import type { SessionStore } from '$lib/session.svelte';
	import type { Session } from '$lib/types';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import Composer from '$lib/Composer.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import TurnRail from '$lib/TurnRail.svelte';
	import StatusStrip from '$lib/composer/StatusStrip.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import RateLimitBanner from '$lib/RateLimitBanner.svelte';
	import Button from '$lib/ui/Button.svelte';
	import TaskStrip from '$lib/TaskStrip.svelte';
	import ProgressCard from '$lib/agents/ProgressCard.svelte';
	import { agentRows, type AgentRow } from '$lib/agentProgress';
	import { parseToolOutput, toolTarget, toolVerb } from '$lib/toolSummary';
	import { parseFileHref } from '$lib/fileRefs';
	import type { Msg } from '$lib/chat.svelte';
	import type { SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import Picker from '$lib/shell/Picker.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import type { ErrorAction } from '$lib/errorInfo';
	import FindBar from '$lib/shell/FindBar.svelte';
	import { autoRetry } from '$lib/autoRetry.svelte';
	import { parseDelivery } from '$lib/delivery';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import RequirementTag from '$lib/requirements/RequirementTag.svelte';
	import { statusLabel } from '$lib/requirements/labels';
	import { gateNext, gateOf, useRequirements } from '$lib/requirements.svelte';
	import RequirementStart, { beginRequirement } from '$lib/requirements/RequirementStart.svelte';
	import { telemetry } from '$lib/telemetry.svelte';

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
		onOpenSettings,
		onOpenAgent,
		onOpenRequirement,
		onOpenTrace
	}: {
		session: Session;
		store: SessionStore;
		/** Providers with configured auth (for "not configured" hints). */
		providers?: string[];
		providersList?: ProviderOption[];
		/** This pane's session is `store.activeId` — overlays and window keys
		 *  only run on the active pane, so two panes never fight over them. */
		isActive?: boolean;
		onRegister?: (id: string, api: ChatPaneApi) => void;
		/** Passes the api back so a remount (tile drag) can't drop the fresh one. */
		onUnregister?: (id: string, api: ChatPaneApi) => void;
		onOpenSettings?: (section: SectionKey) => void;
		/** Show an agent on the workbench. */
		onOpenAgent?: (agent: string) => void;
		/** Show a requirement on the workbench. */
		onOpenRequirement?: (id: string) => void;
		/** Opens the agent trace panel (it shows `chat.agentFocus`). */
		onOpenTrace?: () => void;
	} = $props();

	const chat = $derived(session.chat);
	/** The long-lived agent this session belongs to. */
	const owner = $derived(chat.agent ? agentDirectory.agents.find((a) => a.id === chat.agent) : undefined);
	const project = $derived(store.projects.find((p) => p.sessions.some((s) => s.id === session.id)));
	// The requirement this session works on (or, a draft, will once it starts).
	const reqs = useRequirements();
	const linked = $derived(chat.sessionId ? reqs.bySession.get(chat.sessionId) : undefined);
	const willLink = $derived(!linked && session.requirement ? reqs.get(session.requirement) : undefined);
	/** A draft made for a requirement shows its start card until started. */
	const starting = $derived(session.draft && session.requirementStart ? willLink : undefined);
	/** The start's confirmation, once this session's turn has ended. */
	const gate = $derived(linked?.status === 'confirm' && !chat.busy ? gateOf(linked, chat.sessionId) : undefined);
	let confirming = $state(false);
	/** Confirms the gate's stage, with the composer's words. */
	async function confirmGate() {
		if (!linked || confirming) return;
		confirming = true;
		try {
			await reqs.confirm(linked.id, input.trim());
			input = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			confirming = false;
		}
	}
	/** A passage of a reply, noted as a requirement about this session's project. */
	async function noteRequirement(text: string) {
		try {
			const r = await reqs.create({
				text,
				...(chat.sessionId ? { session: chat.sessionId } : project ? { project: project.id } : {})
			});
			telemetry.track('requirement_create');
			toast.success(t('shell.requirement.noted', { id: r.id }), {
				action: { label: t('shell.requirement.undo'), run: () => void reqs.remove(r.id).catch(() => {}) }
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	// Unsent text is kept per session: it survives switching away and restarts.
	// svelte-ignore state_referenced_locally
	let input = $state(loadComposerText(session.id));
	$effect(() => saveComposerText(session.id, input));
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
	// Passages quoted from replies: a chip in the composer, the quote on send.
	let quotes: { id: number; text: string }[] = [];
	let quoteSeq = 0;
	// Images sit in the text as [图片 #N] tokens where they were added; on submit
	// the images whose token is still there are sent, in token order.
	let images = $state<{ n: number; path: string }[]>([]);
	let imageSeq = 0;
	let scroller = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let composerRef = $state<{ insertToken: (t: string) => void; openModelMenu: () => void } | undefined>();
	let bottomH = $state(120);
	let atBottom = $state(true);
	let messageList = $state<MessageList | null>(null);
	let mark = $state(-1);
	const marks = $derived(chat.messages.flatMap((m) => (m.kind === 'user' && !parseDelivery(m.text) ? [m.text] : [])));

	// The conversation column's width: dragging either edge resizes it about
	// the centre; the width is kept once the drag ends.
	// Narrow enough to read, wide enough for the composer's bar on one line.
	const CHAT_MIN = 640;
	const EDGE = 10; // px from the text to the drag strip's centre
	let wrapW = $state(0);
	let dragW = $state<number | null>(null);
	let hot = $state<{ edge: string; y: number } | null>(null);
	const chatW = $derived(Math.max(CHAT_MIN, dragW ?? prefs.chatWidth));
	// The least room beside the column (more with the rail at the left edge),
	// and the room it has: main's padding-inline.
	const chatPad = $derived(marks.length > 1 ? 56 : 32);
	const pad = $derived(Math.max(chatPad, (wrapW - chatW) / 2));
	function startResize(e: PointerEvent) {
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		const box = el.parentElement!.getBoundingClientRect();
		const centre = box.left + box.width / 2;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			dragW = Math.max(CHAT_MIN, Math.min(box.width - 2 * chatPad, 2 * (Math.abs(ev.clientX - centre) - EDGE)));
		};
		const end = () => {
			if (dragW !== null) prefs.setChatWidth(dragW);
			dragW = null;
			el.removeEventListener('pointermove', move);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', end, { once: true });
		el.addEventListener('pointercancel', end, { once: true });
	}
	function trackEdge(edge: string, e: PointerEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		hot = { edge, y: e.clientY - box.top };
	}

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
					? await store.historyItems(proj, chat)
					: (await nativeSessions(from, proj.path)).map((s) => ({
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
			const sessions = (await sessionHistory(proj.path)).filter((s) => s.engine === 'claude');
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
		const cwd = project?.path || chat.cwd;
		if (!cwd) {
			gitBranch = '';
			return;
		}
		git(['branch', '--show-current'], cwd)
			.then((out) => {
				if (cwd === (project?.path || chat.cwd)) gitBranch = out.trim() || 'detached';
			})
			.catch(() => {});
	}
	// Refetched when the working directory changes (chip resets immediately)…
	$effect(() => {
		const cwd = project?.path || chat.cwd;
		gitBranch = '';
		if (!cwd) return;
		refreshGitBranch();
	});
	// …and refreshed in place on window focus + a slow poll, so a checkout made
	// in GitPanel or an external terminal doesn't leave the footer stale.
	$effect(() => {
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
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	// The agent trace (AgentRunsPanel, a workbench panel) of this session.
	const traceable = $derived(caps(chat).agentTrace && !!onOpenTrace);
	function openTrace(agentId: string | null) {
		chat.agentFocus = agentId;
		store.activeId = session.id;
		onOpenTrace?.();
	}
	function traceOf(m: Msg): { label: string; run: () => void } | null {
		if (m.kind !== 'tool' || !m.callId) return null;
		const agent = chat.agentRuns.agents.find((a) => a.toolUseId === m.callId);
		if (agent) return { label: t('dock.agents.openAgent'), run: () => openTrace(agent.id) };
		if (chat.agentRuns.workflows.some((w) => w.toolUseId === m.callId)) return { label: t('dock.agents.open'), run: () => openTrace(null) };
		return null;
	}
	// The subagents of this conversation: every run (the message list's cards
	// find theirs), and the current turn's (the progress card). Derived from
	// the trace and lifecycle state, never from the streaming text.
	const lastTool = (label: string) => {
		const m = chat.subagentLastTool[label];
		return m ? `${toolVerb(m.name)} ${toolTarget(m.name, parseToolOutput(m.output))}`.trim() : '';
	};
	const allAgents = $derived(agentRows({ runs: chat.agentRuns, subagents: chat.subagents, lastTool }));
	const turnAgents = $derived(
		agentRows({ runs: chat.agentRuns, subagents: chat.subagents, lastTool, since: chat.turnStartedAt || Number.MAX_SAFE_INTEGER })
	);
	function openAgent(row: AgentRow) {
		openTrace(row.workflow ? null : row.id);
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
		// Model picker rows (pure packing in $lib/composer/modelRows): the active
		// provider's models from the engine's model_view plus, for jucode
		// sessions, the catalog of every other provider with credentials.
		return buildModelRows({
			models: p.models,
			backendId: chat.backendId,
			provider: chat.provider ?? '',
			providersList,
			configured: providers,
			groups: {
				jucode: t('shell.modelGroup.jucode'),
				byok: t('shell.modelGroup.byok')
			},
			toolMode,
			localLabel: t('chat.providerLocal'),
			unsetWindow: t('chat.windowUnset')
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

	async function pickProvider(m: ToolModel, choice: { local: true } | { group: string }) {
		if (toolMode === 'jucode' && !('local' in choice)) {
			store.setSessionGroup(session.id, choice.group);
			return;
		}
		chat.closePicker();
		if ('local' in choice) {
			if (toolMode === 'jucode' && m.local) await switchTool('system', m.local);
			return;
		}
		// Set once the switch is confirmed; the gateway reads it per request.
		if (m.jucode && (await switchTool('jucode', m.jucode))) store.setSessionGroup(session.id, choice.group);
	}

	// Whether to offer a filter box (history and other long lists).
	const showPickerSearch = $derived(
		pickerRows.length > 8 || chat.picker?.kind === 'resume' || chat.picker?.kind === 'checkpoint'
	);
	const filteredRows = $derived.by(() => {
		const q = pickerQuery.trim().toLowerCase();
		if (!q) return pickerRows;
		return pickerRows.filter((r) => `${r.label} ${r.detail}`.toLowerCase().includes(q));
	});
	$effect(() => {
		chat.picker;
		pickerQuery = '';
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
		}
	});
	$effect(() => {
		if (!chat.pendingAttach.length) return;
		const paths = chat.pendingAttach;
		chat.pendingAttach = [];
		for (const path of paths) addAttachment(path);
	});
	// This pane became the workbench-active one: its unread marker clears.
	$effect(() => {
		if (isActive) untrack(() => (chat.unseen = false));
	});

	const isVideo = (p: string) => /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(p);

	function addAttachment(path: string) {
		if (!path) return;
		if (isVideo(path)) {
			attachVideo(path);
			return;
		}
		if (isImage(path)) addImage(path);
		else if (!attachments.some((a) => a.path === path)) attachments.push({ path, image: false });
	}
	function addImage(path: string) {
		if (images.some((i) => i.path === path)) return;
		const n = ++imageSeq;
		images.push({ n, path });
		const token = `[图片 #${n}]`;
		if (composerRef) composerRef.insertToken(token);
		else input = input && !/\s$/.test(input) ? `${input} ${token} ` : `${input}${token} `;
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
			toast.error(String(e));
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

	// A browser element pick routed here by the page (always the active pane).
	function insertWebRef(ref: WebRef) {
		const picked: PickedRef = { ...ref, id: ++refSeq };
		webRefs.push(picked);
		insertRefToken(picked.id, picked.text || picked.tag || 'element');
	}

	function submit() {
		const text = input.trim();
		if (!text && attachments.length === 0 && videos.length === 0) return;
		// A draft made for a requirement starts from it; the words go with it.
		if (starting && !text.startsWith('/')) {
			beginRequirement(session, text);
			input = '';
			return;
		}
		if (text.startsWith('/')) {
			const btw = caps(chat).sideQuestions ? text.match(/^\/btw\s+([\s\S]+)/) : null;
			if (btw) chat.sideAnswers.push({ question: btw[1].trim(), answer: '', error: '', pending: true });
			send({ op: 'command', input: text });
		} else {
			const sent = [...new Set(
				[...text.matchAll(/\[图片 #(\d+)\]/g)]
					.map((m) => images.find((i) => i.n === Number(m[1]))?.path)
					.filter((p): p is string => !!p)
			)];
			const imagePaths = [...sent];
			const files = attachments.filter((a) => !a.image).map((a) => a.path);
			let content = text;
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
			if (files.length)
				content += `${content ? '\n\n' : ''}Attached files (read these):\n${files.join('\n')}`;
			for (const v of videos) {
				imagePaths.push(...v.frames);
				content += `${content ? '\n\n' : ''}[视频附件] ${base(v.path)}（时长 ${v.duration.toFixed(1)} 秒）：已按时间等间隔抽取 ${v.frames.length} 个关键帧，随消息以图片附上（按时间先后排序），请结合这些关键帧理解视频内容。`;
			}
			// Echo the message instantly when it starts a turn now (a busy session
			// queues it instead, shown in the composer's queue strip).
			// A restarting engine holds the message and starts the turn once up.
			if (!chat.busy || chat.restarting) {
				captureCheckpoint(); // snapshot files before this turn (for rewind)
				chat.optimisticUser(content, sent);
			}
			send({ op: 'user_message', content, images: imagePaths.length ? imagePaths : undefined });
		}
		input = '';
		attachments = [];
		videos = [];
		webRefs = [];
		quotes = [];
		images = [];
		imageSeq = 0;
	}
	function stop() {
		autoRetry.cancel(chat);
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
				if (!chat.efforts.includes(chat.effort)) chat.effort = defaultEffort(chat.efforts);
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
		if (command.startsWith('@tool ')) {
			const [mode, name] = command.slice('@tool '.length).trim().split(/\s+/);
			chat.closePicker();
			if (mode === 'system' || mode === 'jucode') void switchTool(mode, name);
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
				importNativeSession(source, proj.path, sid)
					.then((copy) => store.openSaved(proj, copy.id, copy.title || title, source))
					.catch((e) => toast.error(t('shell.historySource.importFail', { msg: String(e) })))
					.finally(() => toast.dismiss(notice));
				return;
			}
			if (backend === 'codex' || backend === 'claude' || backend === 'jucode') {
				store.openSaved(project, sid, item?.label ?? '', backend);
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
	function onScroll() {
		if (!scroller) return;
		const top = scroller.scrollTop;
		// The scroll event of our own pin says nothing about the reader.
		// Otherwise follow again once they scroll down near the end, never
		// while they scroll up.
		if (top !== pinnedTop) atBottom = top >= lastTop && scroller.scrollHeight - top - scroller.clientHeight < 60;
		lastTop = top;
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
	// Stick to the bottom as content grows (streaming text, tool output, new cards).
	// The smoothed reveal changes height every frame, which a scroll-event listener
	// can't see, so observe the content's size directly.
	let contentEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!contentEl || !scroller) return;
		const ro = new ResizeObserver(() => {
			if (atBottom) pin();
		});
		ro.observe(contentEl);
		return () => ro.disconnect();
	});
	async function scrollToEnd(force = false) {
		await tick();
		if (scroller && (atBottom || force)) {
			pin();
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
	// Before each codex/claude turn, snapshot the working tree so a later rewind
	// can restore files to this turn's starting state (the engines rewind only the
	// conversation). Fire-and-forget; the sha lands under its turn index.
	function captureCheckpoint() {
		const c = chat;
		const cwd = project?.path;
		if (!cwd || (c.backendId !== 'codex' && c.backendId !== 'claude')) return;
		const idx = c.userTurns;
		gitCheckpointCapture(cwd)
			.then((sha) => {
				if (sha) c.fileCheckpoints[idx] = sha;
			})
			.catch(() => {});
	}
	// Restore the working tree to the checkpoint captured before the target turn.
	function restoreCheckpoint(userIndex: number) {
		const cwd = project?.path;
		const sha = chat.fileCheckpoints[userIndex];
		if (cwd && sha) gitCheckpointRestore(cwd, sha).catch((e) => console.error('checkpoint restore failed', e));
	}

	// Open a workspace file referenced by a chat link. HTML opens in the built-in
	// browser (rendered) or the editor (source) per preference; everything else
	// opens in the editor. Paths resolve relative to this session's project root.
	async function openChatFile(href: string) {
		const cwd = project?.path;
		if (!cwd) return;
		// A file a reply names, maybe at a line (`src/a.ts#L12:4`).
		const ref = parseFileHref(href);
		const rel = ref.path;
		if (!rel) return;
		const joined = `${cwd.replace(/\/+$/, '')}/${rel.replace(/^\.?\//, '')}`;
		const abs = rel.startsWith('/') ? rel : ((await resolveFileRef(cwd, rel).catch(() => null)) ?? joined);
		const ext = abs.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
		if ((ext === 'html' || ext === 'htm') && prefs.htmlOpenInBrowser) {
			browser.open(`file://${abs}`);
		} else {
			const at = ref.line ? { line: ref.line, col: ref.col } : undefined;
			editorStore.open(abs, cwd, at).catch((e) => toast.error(t('chat.fileOpenFailed', { path: ref.path, error: String(e) })));
		}
	}

	function rewindToMessage(text: string, userIndex: number) {
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
		openModelMenu: () => composerRef?.openModelMenu()
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
		// Moving the tile to another leaf remounts the pane — stash the draft so
		// the composer text survives the drag (pendingFill restores it).
		if (input.trim()) chat.pendingFill = input;
	});
</script>

<svelte:window onkeydown={onWindowKey} onfocus={refreshGitBranch} />

<div class="chatpane" style:--chat-w="{chatW}px" style:--chat-pad="{chatPad}px">
	{#if owner}
		<div class="owner">
			<AgentAvatar agent={owner} size={16} />
			<span class="owner-name">{t('chat.agentSession', { name: owner.name })}</span>
			{#if owner.summary}<span class="owner-role">{owner.summary}</span>{/if}
			{#if onOpenAgent}<button class="owner-link" onclick={() => onOpenAgent(owner.id)}>{t('chat.agentOnDesk')}</button>{/if}
		</div>
	{/if}
	{#if linked}
		<div class="owner">
			<RequirementTag id={linked.id} />
			<span class="owner-name">{linked.title}</span>
			<span class="owner-role">{statusLabel(linked.status)}</span>
			{#if onOpenRequirement}<button class="owner-link" onclick={() => onOpenRequirement(linked.id)}>{t('shell.requirement.viewRequirement')}</button>{/if}
		</div>
	{:else if willLink}
		<div class="owner">
			<RequirementTag id={willLink.id} />
			<span class="owner-name">{t('shell.requirement.willLink', { id: willLink.id })}</span>
			<span class="owner-role">{willLink.title}</span>
			<button class="owner-link" onclick={() => ((session.requirement = undefined), (session.requirementStart = undefined))}>{t('shell.requirement.unlink')}</button>
		</div>
	{/if}
	<TaskStrip
		{chat}
		onStop={(id) => send({ op: 'stop_task', task_id: id })}
		onOutput={(id) => send({ op: 'task_output', task_id: id })}
		onTrace={traceable ? () => openTrace(null) : undefined}
	/>

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

	<div class="mainwrap" class:resizing={dragW !== null} bind:clientWidth={wrapW}>
	<ProgressCard {chat} sessionId={session.id} rows={turnAgents} onOpen={traceable ? openAgent : undefined} />
	<main bind:this={scroller} onscroll={onScroll} onwheel={onWheel}>
		<div bind:this={contentEl}>
			<MessageList bind:this={messageList} bind:mark messages={chat.messages} {streamingMsg} {streamingReasoning} phase={chat.phase} call={chat.call} compactionTokens={chat.compactionTokens} retry={chat.retry} autoRetry={chat.autoRetry} onAutoRetryNow={() => autoRetry.now(chat)} onAutoRetryCancel={() => autoRetry.cancel(chat)} {findActive} {scroller} onEdit={editMessage} onCite={citeText} onNote={noteRequirement} onRewind={rewindToMessage} onFile={openChatFile} onDismiss={(m) => (chat.messages = chat.messages.filter((x) => x !== m))} backend={chat.backendId} onErrorAction={fixError} traceOf={traceable ? traceOf : undefined} />
		</div>
		{#if chat.booting && chat.engineState !== 'exited'}
			<div class="welcome spawning">
				<span class="spawn-spin"><CircleNotchIcon size={26} class="spin" /></span>
				<p class="welcome-tip">{t('shell.spawning')}</p>
			</div>
		{:else if starting && chat.messages.length === 0}
			<div class="welcome">
				<RequirementStart requirement={starting} {session} />
			</div>
		{:else if chat.messages.length === 0 && !chat.busy}
			<div class="welcome">
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
	{#if marks.length > 1}
		<TurnRail {marks} current={mark} onJump={(n) => messageList?.jumpToMark(n)} />
	{/if}
	{#each ['left', 'right'] as edge (edge)}
		<div
				class="edge"
				class:active={dragW !== null}
				style:left={edge === 'left' ? `${pad - EDGE}px` : `${wrapW - pad + EDGE}px`}
				role="separator"
				aria-orientation="vertical"
				aria-label={t('chat.resizeColumn')}
				onpointerdown={startResize}
				onpointermove={(e) => trackEdge(edge, e)}
				onpointerleave={() => dragW === null && (hot = null)}
			>
				{#if hot?.edge === edge}<span style:top="{hot.y}px"></span>{/if}
			</div>
	{/each}
	</div>
	{#if !atBottom}
		<button class="jump" style:bottom="{bottomH + 14}px" onclick={jumpToBottom} aria-label="scroll to bottom"><CaretDownIcon size={18} /></button>
	{/if}

	<div class="bottom" bind:clientHeight={bottomH}>
		{#if chat.engineState === 'exited'}
			<div class="approval-wrap">
				<div class="enginedown">
					<span class="ed-text">{t('shell.engineDown')}</span>
					<Button variant="primary" size="sm" onclick={() => store.restartSession(session.id, true)}>{t('shell.restartEngine')}</Button>
				</div>
			</div>
		{/if}
		<!-- Agent questions render in the composer tray; the card keeps plain
		     tool approvals (commands, edits, plans). -->
		{#if chat.pendingApproval && !chat.pendingApproval.questions?.length}
			<div class="approval-wrap">
				{#key chat.pendingApproval.callId}
					<ApprovalCard approval={chat.pendingApproval} onRespond={respondApproval} ruleScopes={caps(chat).ruleScopes} />
				{/key}
			</div>
		{/if}

		{#if chat.inTerminal}
			<p class="interm">{t('chat.inTerminal')}</p>
		{/if}
		{#if chat.rateLimit}
			<RateLimitBanner rateLimit={chat.rateLimit} onDismiss={() => (chat.rateLimit = null)} />
		{/if}

		<StatusStrip items={chat.statusLog} />

		{#if gate && !chat.pendingApproval}
			<div class="approval-wrap">
				<div class="gate">
					<span class="gate-hint">{t('shell.requirement.confirmHint')}</span>
					<Button size="sm" variant="primary" disabled={confirming} onclick={confirmGate}>{t(`shell.requirement.${gateNext(gate)}`)}</Button>
				</div>
			</div>
		{/if}

		<Composer
			{chat}
			bind:this={composerRef}
			bind:input
			bind:attachments
			{images}
			onImage={addImage}
			bind:videos
			bind:el={composerEl}
			onSubmit={submit}
			onStop={stop}
			onSteer={() => send({ op: 'steer' })}
			onPick={pickFiles}
			onModel={openModelPicker}
			onModelSelect={selectRow}
			onModelClose={() => chat.closePicker()}
			modelRows={filteredRows}
			modelSearch={showPickerSearch}
			{backendLocked}
			toolProvider={toolModel
				? {
						model: toolModel.jucode ?? toolModel.key,
						name: BACKEND_LABELS[chat.backendId],
						local: toolModel.local !== undefined,
						jucode: toolModel.jucode !== undefined,
						onJucode: toolMode === 'jucode',
						group: session.group ?? '',
						groups: store.takesSessionGroup(session),
						onPick: (choice) => pickProvider(toolModel, choice)
					}
				: undefined}
			{gitBranch}
			gitCwd={project?.path || chat.cwd}
			repoName={project?.name ?? ''}
			onBranchChanged={refreshGitBranch}
			onBackend={(b, acpAgent) => store.switchBackend(session.id, b, acpAgent)}
			bind:pickerQuery
		bind:pickerSelIdx={selIdx}
			onEffort={setEffort}
			onSwitch={setSwitch}
			effortDisabled={!!pendingModel || chat.switching}
			onApproval={setApprovalMode}
			onRespond={respondApproval}
		/>
	</div>
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

<style>
	/* Whose session this is: a quiet line above the transcript. */
	.owner {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
		padding: 7px 16px;
		border-bottom: 1px solid var(--hairline);
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.owner-name {
		flex: none;
		color: var(--text);
		font-weight: 500;
	}
	.owner-role {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
	}
	.owner-link {
		flex: none;
		margin-left: auto;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		cursor: pointer;
	}
	.owner-link:hover {
		color: var(--text);
		text-decoration: underline;
	}
	.chatpane {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
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
		background: var(--surface2);
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
	.gate {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
	}
	.gate-hint {
		font-size: var(--fs-xs);
		color: var(--dim2);
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
		font-size: var(--fs-sm);
		color: var(--err);
		font-weight: 500;
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
	/* The column's edge: hovering shows a short bar at the pointer, dragging
	   resizes the column. */
	.edge {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 12px;
		transform: translateX(-50%);
		cursor: col-resize;
		z-index: 4;
	}
	.edge span {
		position: absolute;
		left: 5px;
		width: 2px;
		height: 120px;
		border-radius: 1px;
		transform: translateY(-50%);
		background: linear-gradient(transparent, var(--dim), transparent);
		pointer-events: none;
	}
	.edge.active span {
		background: linear-gradient(transparent, var(--text), transparent);
	}
	.resizing {
		cursor: col-resize;
		user-select: none;
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
		border-radius: var(--r-xs);
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
		border-radius: var(--r-sm);
		padding: 8px 10px;
		word-break: break-all;
	}
</style>
