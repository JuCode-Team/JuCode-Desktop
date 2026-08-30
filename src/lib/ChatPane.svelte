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
	}
</script>

<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { ChevronDown, LoaderCircle } from 'lucide-svelte';
	import { open, message } from '@tauri-apps/plugin-dialog';
	import { treeRows } from '$lib/tree';
	import { buildSetApprovalModeOp, needsClaudeYoloRespawn, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import { focusTrap } from '$lib/focusTrap';
	import {
		processVideo,
		claudeSessions,
		git,
		gitCheckpointCapture,
		gitCheckpointRestore,
		type Op
	} from '$lib/protocol';
	import { buildModelRows } from '$lib/composer/modelRows';
	import { dispatch } from '$lib/backends/router';
	import { browser } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { t } from '$lib/i18n';
	import type { SessionStore } from '$lib/session.svelte';
	import type { Session } from '$lib/types';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import Composer from '$lib/Composer.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import StatusStrip from '$lib/composer/StatusStrip.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import RateLimitBanner from '$lib/RateLimitBanner.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Picker from '$lib/shell/Picker.svelte';
	import FindBar from '$lib/shell/FindBar.svelte';

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
		onUnregister
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
	} = $props();

	const chat = $derived(session.chat);
	const project = $derived(store.projects.find((p) => p.sessions.some((s) => s.id === session.id)));

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
	let scroller = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let composerRef = $state<{ insertToken: (t: string) => void } | undefined>();
	let bottomH = $state(120);
	let atBottom = $state(true);

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

	// Ops flow through this session's backend adapter; an unsupported op
	// (non-jucode stub backends) surfaces as an inline system notice.
	function send(op: Op) {
		// claude's /resume can't go over the wire: stream-json mode has no session
		// listing protocol, the history lives in files under ~/.claude/projects.
		// Bare /resume synthesizes the picker from the claude_sessions command; a
		// typed `/resume <id>` opens that session in a fresh tab (same flow as a
		// picker pick — the current chat is never replaced).
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
		if (!dispatch(session.id, op)) {
			chat.messages.push({ kind: 'system', text: t('shell.backend.opUnsupported', { op: op.op }) });
		}
	}

	// Builds the claude /resume picker from the session files Claude Code
	// persisted for this project (claude_sessions → synthesized resume_view).
	async function openClaudeHistory() {
		const c = chat;
		const proj = project;
		if (!proj) return;
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
		// sessions, every other configured provider's catalog.
		return buildModelRows({
			models: p.models,
			backendId: chat.backendId,
			provider: chat.provider ?? '',
			providersList,
			configured: providers,
			groups: {
				codex: t('shell.modelGroup.codex'),
				claude: t('shell.modelGroup.claude'),
				jucode: t('shell.modelGroup.jucode'),
				byok: t('shell.modelGroup.byok')
			},
			notConfigured: t('shell.notConfigured')
		});
	});

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
			if (!chat.busy) {
				captureCheckpoint(); // snapshot files before this turn (for rewind)
				chat.optimisticUser(content);
			}
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
		if (!chat.pendingApproval) return;
		send(op);
		chat.pendingApproval = null;
	}
	// User changed the approval-mode picker: persist locally and push it to this
	// session's engine (which enforces it and acks with an approval_mode event).
	function setApprovalMode(m: ApprovalMode) {
		chat.setApprovalMode(m);
		// Switching claude INTO yolo (bypassPermissions) isn't honored at runtime —
		// respawn the engine with the flag (resumes the conversation) instead of
		// sending a live control frame that would silently no-op.
		if (needsClaudeYoloRespawn(chat.backendId, buildSetApprovalModeOp(m).mode)) {
			store.respawnClaudeYolo(session.id);
			return;
		}
		send(buildSetApprovalModeOp(m));
	}

	function selectRow(command: string) {
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
			// Codex/claude resume items open in a fresh session of the same backend
			// (codex: thread/resume via SessionCtx.resume; claude: the --resume
			// spawn option + transcript replay from the session file).
			if (chat.backendId === 'codex' || chat.backendId === 'claude') {
				const backend = chat.backendId;
				const item = chat.picker?.kind === 'resume' ? chat.picker.items.find((i) => i.id === sid) : undefined;
				chat.closePicker();
				store.activeId = store.restoreSession(project, sid, item?.label ?? '', backend);
				return;
			}
			// jucode history entries come from the jucode engine, so the new session
			// is always jucode-backed regardless of the project's last-used backend.
			chat.closePicker();
			const id = store.addSession(project, undefined, 'jucode');
			dispatch(id, { op: 'command', input: command });
			return;
		}
		send({ op: 'command', input: command });
		chat.closePicker();
	}
	function setEffort(effort: string) {
		if (chat.model && !pendingModel && !chat.switching) selectRow(`/model ${chat.model} ${effort}`);
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
	function openChatFile(href: string) {
		const cwd = project?.path;
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
		scrollToEnd: () => void scrollToEnd()
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

<div class="chatpane">
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
			<MessageList messages={chat.messages} {streamingMsg} {streamingReasoning} phase={chat.phase} compactionTokens={chat.compactionTokens} {findActive} {scroller} onEdit={editMessage} onRewind={rewindToMessage} onFile={openChatFile} />
		</div>
		{#if chat.booting && chat.engineState !== 'exited'}
			<div class="welcome spawning">
				<span class="spawn-spin"><LoaderCircle size={26} /></span>
				<p class="welcome-tip">{t('shell.spawning')}</p>
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
	{#if !atBottom}
		<button class="jump" style:bottom="{bottomH + 14}px" onclick={jumpToBottom} aria-label="scroll to bottom"><ChevronDown size={18} /></button>
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
		{#if chat.pendingApproval}
			<div class="approval-wrap">
				{#key chat.pendingApproval.callId}
					<ApprovalCard approval={chat.pendingApproval} onRespond={respondApproval} />
				{/key}
			</div>
		{/if}

		{#if chat.rateLimit}
			<RateLimitBanner rateLimit={chat.rateLimit} onDismiss={() => (chat.rateLimit = null)} />
		{/if}

		<StatusStrip items={chat.statusLog} />

		<Composer
			{chat}
			bind:this={composerRef}
			bind:input
			bind:attachments
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
			modelTitle={pickerTitle}
			modelSearch={showPickerSearch}
			{backendLocked}
			{gitBranch}
			onBackend={(b, acpAgent) => store.switchBackend(session.id, b, acpAgent)}
			bind:pickerQuery
		bind:pickerSelIdx={selIdx}
			onEffort={setEffort}
			effortDisabled={!!pendingModel || chat.switching}
			onApproval={setApprovalMode}
		/>
	</div>
</div>

{#if isActive && chat.trustPrompt}
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
	/>
{/if}

{#if isActive && chat.pendingRewind}
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (chat.pendingRewind = null)}>
		<div class="modal trust" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.rewindLabel')} use:focusTrap>
			<div class="modal-head"><span>{t('shell.rewindQuestion')}</span></div>
			<div class="trust-body">
				<p>{@html t('shell.rewindBody')}</p>
				<code class="trust-path">{chat.pendingRewind.text.slice(0, 120)}</code>
			</div>
			<div class="trust-actions">
				<button class="btn ghost" onclick={() => (chat.pendingRewind = null)}>{t('common.cancel')}</button>
				<button class="btn primary" onclick={confirmRewind}>{t('shell.rewindConfirm')}</button>
			</div>
		</div>
	</div>
{/if}

<style>
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
		animation: jump-in var(--t-med) var(--ease-spring);
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring),
			box-shadow var(--t-med) var(--ease-out);
	}
	/* pop-in variant that keeps the horizontal centering transform */
	@keyframes jump-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(6px) scale(0.9);
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
		animation: rise var(--t-slow) var(--ease-out) both;
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

	/* ---------- modals (trust / rewind) ---------- */
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
		animation: fade var(--t-fast) var(--ease-out);
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
		animation: pop-in var(--t-med) var(--ease-spring);
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
		border-radius: var(--r-sm);
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
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.btn:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn:active {
		transform: scale(0.97);
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
