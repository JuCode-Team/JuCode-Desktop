<script lang="ts">
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
	import TargetIcon from 'phosphor-svelte/lib/TargetIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import FastForwardIcon from 'phosphor-svelte/lib/FastForwardIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import ShieldWarningIcon from 'phosphor-svelte/lib/ShieldWarningIcon';
	import HandIcon from 'phosphor-svelte/lib/HandIcon';
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import StopCircleIcon from 'phosphor-svelte/lib/StopCircleIcon';
	import MicrophoneIcon from 'phosphor-svelte/lib/MicrophoneIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import BranchMenu from '$lib/composer/BranchMenu.svelte';
	import CommandIcon from 'phosphor-svelte/lib/CommandIcon';
	import { toast } from '$lib/ui/toast.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import { listFiles, saveTempImage, transcribeAudio } from '$lib/protocol';
	import { VoiceRecorder } from '$lib/audio';
	import VoiceWave from '$lib/composer/VoiceWave.svelte';
	import { buildEntries, mentionMatches, type AtEntry } from '$lib/mention';
	import { t } from '$lib/i18n';
	import { matches, withShortcut } from '$lib/shortcuts';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import MentionMenu from '$lib/composer/MentionMenu.svelte';
	import AttachmentChips from '$lib/composer/AttachmentChips.svelte';
	import ContextIndicator from '$lib/composer/ContextIndicator.svelte';
	import ModelMenu from '$lib/composer/ModelMenu.svelte';
	import type { SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import type { ToolProvider } from '$lib/composer/GroupPicker.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import { modelColor, isTopEffort } from '$lib/modelColor';
	import ComposerTray, { type TrayItem, type TraySection } from '$lib/composer/ComposerTray.svelte';
	import { answerStep, startFlow, togglePick, type QuestionFlow } from '$lib/composer/tray';
	import { effortLabel } from '$lib/composer/effort';
	import type { ModelRow } from '$lib/composer/modelRows';
	import type { ChatState } from '$lib/chat.svelte';
	import { buildApproveOp, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import { caps, BACKEND_LABELS, type BackendId } from '$lib/backends';

	let {
		chat,
		input = $bindable(),
		attachments = $bindable(),
		videos = $bindable([]),
		el = $bindable(),
		pickerQuery = $bindable(''),
		pickerSelIdx = $bindable(0),
		modelRows = [],
		modelSearch = false,
		backendLocked = true,
		toolProvider,
		gitBranch = '',
		gitCwd = '',
		repoName = '',
		onBranchChanged,
		onBackend,
		onSubmit,
		onStop,
		onSteer,
		onPick,
		images = [],
		onImage,
		onModel,
		onModelSelect,
		onModelClose,
		onEffort,
		onSwitch,
		effortDisabled = false,
		onApproval,
		onRespond
	}: {
		chat: ChatState;
		input: string;
		attachments: { path: string; image: boolean }[];
		videos?: { path: string; frames: string[]; duration: number }[];
		el: HTMLElement | null;
		pickerQuery?: string;
		pickerSelIdx?: number;
		modelRows?: ModelRow[];
		modelSearch?: boolean;
		/** False only while the session is still virgin (no user turn) — the
		 *  agent rail in the model popover shows then and disappears afterwards. */
		backendLocked?: boolean;
		/** A gateway session's group (see ModelMenu). */
		toolProvider?: ToolProvider & { model: string };
		/** Current git branch for the footer strip ('' hides the chip). */
		gitBranch?: string;
		/** Where the branch chip's picker runs git; '' leaves the chip read-only. */
		gitCwd?: string;
		repoName?: string;
		/** A branch was switched to or created from the chip. */
		onBranchChanged?: () => void;
		onBackend?: (b: BackendId, acpAgent?: { id: string; name: string }) => void | Promise<void>;
		onSubmit: () => void;
		onStop: () => void;
		onSteer: () => void;
		onPick: () => void;
		/** Images placed in the text as [图片 #N] tokens (N → file). */
		images?: { n: number; path: string }[];
		/** A pasted image, saved to a temp file: the pane adds it and its token. */
		onImage: (path: string) => void;
		onModel: () => void;
		onModelSelect?: (command: string) => void;
		onModelClose?: () => void;
		onEffort: (effort: string) => void;
		onSwitch: (name: SessionSwitch, on: boolean) => void;
		effortDisabled?: boolean;
		onApproval: (mode: ApprovalMode) => void;
		/** Answers a pending agent question (AskUserQuestion) shown in the tray. */
		onRespond?: (op: ApproveOp) => void;
	} = $props();

	let showApproval = $state(false);
	let showAdd = $state(false);
	let branchOpen = $state(false);
	let modelButton = $state<HTMLButtonElement>();

	// The model popover holds its own open flag so it can outlive an agent
	// switch (the new session ChatState starts with no picker) and open for
	// agents without a model catalog (ACP) — the rail inside it is the only
	// way to pick a coding agent.
	let modelOpen = $state(false);
	const modelPopoverVisible = $derived(modelOpen);
	function toggleModelPopover() {
		if (modelPopoverVisible) {
			closeModelPopover();
			return;
		}
		showAdd = false;
		modelOpen = true;
		if (bcaps.modelPicker) onModel();
	}
	function closeModelPopover() {
		modelOpen = false;
		if (chat.picker?.kind === 'model') onModelClose?.();
	}
	// Escape closes the popover even when the session has no model picker view
	// (ACP agents — `modelOpen` is ours, not chat.picker). Capture phase so the
	// key never reaches the pane's window handler or the editor.
	function onWindowKeyCapture(e: KeyboardEvent) {
		if (e.key === 'Escape' && (modelPopoverVisible || showAdd)) {
			e.preventDefault();
			e.stopPropagation();
			if (modelPopoverVisible) closeModelPopover();
			showAdd = false;
		}
	}
	function selectFromPopover(command: string) {
		modelOpen = false;
		onModelSelect?.(command);
	}
	function setEffort(effort: string) {
		if (effortDisabled) return;
		onEffort(effort);
	}

	// The fallback label on the model button before the engine reports a model:
	// the ACP agent's registered name, else the engine's brand name.
	const backendLabel = $derived(
		chat.backendId === 'acp' ? chat.acpAgentName || BACKEND_LABELS.acp : BACKEND_LABELS[chat.backendId]
	);

	// Capability gating for the session's engine backend (jucode = everything).
	const bcaps = $derived(caps(chat));

	// --- rich contenteditable editing surface ------------------------------
	// `input` (bindable) stays the plain-text source of truth: a web-element chip
	// serializes to its [网页元素#N:label] token, so all downstream logic (submit,
	// slash, @-mention) keeps operating on a string. The DOM is the live editor;
	// we sync OUT of it on input, and rebuild it only when `input` is changed
	// programmatically (completion / refill / cleared on send) — never mid-typing.
	let composing = $state(false);
	let lastSync = '';
	const TOKEN_RE = /\[网页元素#(\d+)(?::([^\]]*))?\]|\[引用#(\d+)(?::([^\]]*))?\]|\[图片 #(\d+)\]/g;

	const tokenLabel = (token: string) => {
		const m = /^\[(?:网页元素|引用)#(\d+)(?::([^\]]*))?\]$/.exec(token);
		return m ? (m[2]?.trim() || `#${m[1]}`) : token;
	};
	function makeChip(token: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'refchip';
		span.contentEditable = 'false';
		span.dataset.token = token;
		const img = /^\[图片 #(\d+)\]$/.exec(token);
		const path = img ? images.find((i) => i.n === Number(img[1]))?.path : undefined;
		if (img) {
			span.classList.add('imgchip');
			if (path) {
				const thumb = document.createElement('img');
				thumb.src = convertFileSrc(path);
				thumb.alt = '';
				span.appendChild(thumb);
			}
			span.appendChild(document.createTextNode(t('chat.imageToken', { n: img[1]! })));
		} else span.textContent = tokenLabel(token);
		if (token.startsWith('[引用#')) span.classList.add('quotechip');
		return span;
	}
	// DOM → plain text: chips become their token, <br> becomes a newline.
	function serialize(root: Node): string {
		let out = '';
		root.childNodes.forEach((n) => {
			if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue ?? '';
			else if (n.nodeType === Node.ELEMENT_NODE) {
				const e = n as HTMLElement;
				if (e.dataset?.token) out += e.dataset.token;
				else if (e.tagName === 'BR') out += e.dataset.tail === undefined ? '\n' : '';
				else out += serialize(e);
			}
		});
		return out;
	}
	// Plain text → DOM: split out tokens into chip spans, the rest into text.
	function renderInput(str: string) {
		if (!el) return;
		el.textContent = '';
		const frag = document.createDocumentFragment();
		let last = 0;
		TOKEN_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = TOKEN_RE.exec(str))) {
			if (m.index > last) frag.appendChild(document.createTextNode(str.slice(last, m.index)));
			frag.appendChild(makeChip(m[0]));
			last = m.index + m[0].length;
		}
		if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
		el.appendChild(frag);
		syncTail(str);
	}
	// pre-wrap renders no line for a trailing "\n", so a Shift+Enter at the end
	// showed nothing until pressed twice. A trailing <br data-tail> gives the empty
	// last line a box; serialize skips it.
	function syncTail(str: string) {
		if (!el) return;
		const last = el.lastChild;
		el.querySelectorAll('br[data-tail]').forEach((b) => b !== last && b.remove());
		const has = last instanceof HTMLBRElement && last.dataset.tail !== undefined;
		if (str.endsWith('\n') && !has) {
			const br = document.createElement('br');
			br.dataset.tail = '';
			el.appendChild(br);
		} else if (!str.endsWith('\n') && has) last.remove();
	}
	function caretToEnd() {
		if (!el) return;
		const r = document.createRange();
		r.selectNodeContents(el);
		r.collapse(false);
		// Before the tail <br>, or typed text would land one line too low.
		if (el.lastChild instanceof HTMLBRElement && el.lastChild.dataset.tail !== undefined) r.setStartBefore(el.lastChild);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(r);
	}
	function syncFromDom() {
		if (!el) return;
		let s = serialize(el);
		// Normalize a WebKit-left empty state so the placeholder shows: deleting
		// everything can leave a lone <br> (or <div><br></div>), which reads as
		// "\n". A real line break typed into an empty box leaves two.
		if (s === '\n' && el.textContent === '') s = '';
		if (s === '' && el.childNodes.length) el.textContent = '';
		else syncTail(s);
		lastSync = s;
		input = s;
		// Typing dismisses the "+" tray so Enter sends instead of picking a row.
		showAdd = false;
	}
	function insertNodesAtCaret(nodes: Node[]) {
		if (!el || !nodes.length) return;
		el.focus();
		const sel = window.getSelection();
		let range: Range;
		if (sel && sel.rangeCount && el.contains(sel.anchorNode)) range = sel.getRangeAt(0);
		else {
			range = document.createRange();
			range.selectNodeContents(el);
			range.collapse(false);
		}
		range.deleteContents();
		const frag = document.createDocumentFragment();
		nodes.forEach((n) => frag.appendChild(n));
		const lastNode = nodes[nodes.length - 1];
		range.insertNode(frag);
		// Sync (adding the tail <br>) before placing the caret: WebKit moves a caret
		// after an unrendered trailing "\n" back before it, onto the line above.
		syncFromDom();
		const after = document.createRange();
		after.setStartAfter(lastNode);
		after.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(after);
	}
	function insertTextAtCaret(text: string) {
		insertNodesAtCaret([document.createTextNode(text)]);
	}
	// Exposed to the page (⇧⌘M): opens the model menu when the session has one.
	export function openModelMenu() {
		if ((chat.efforts.length || bcaps.modelPicker || !backendLocked) && !modelPopoverVisible) toggleModelPopover();
	}
	// Exposed to the page: drop a web-element reference chip at the caret.
	export function insertToken(token: string) {
		insertNodesAtCaret([makeChip(token), document.createTextNode(' ')]);
	}

	// Rebuild the editor DOM on external `input` changes only (slash/@ completion,
	// edit/rewind refill, voice append, cleared on send). During typing input ===
	// lastSync so this is a no-op; skipped mid-IME-composition to protect the caret.
	$effect(() => {
		const v = input;
		if (!el || composing) return;
		if (v === lastSync) return;
		renderInput(v);
		lastSync = v;
		if (document.activeElement === el) caretToEnd();
	});

	// Claude exposes two extra native modes (plan / auto) between ask and edits;
	// other backends keep the shared three (gated by extendedApprovalModes).
	const APPROVAL_MODES: Record<string, PopMenuItem> = {
		ask: { key: 'ask', label: t('chat.approvalAsk'), desc: t('chat.approvalAskDesc'), icon: HandIcon },
		plan: { key: 'plan', label: t('chat.approvalPlan'), desc: t('chat.approvalPlanDesc'), icon: ClipboardTextIcon },
		auto: { key: 'auto', label: t('chat.approvalAuto'), desc: t('chat.approvalAutoDesc'), icon: ShieldCheckIcon },
		edits: { key: 'edits', label: t('chat.approvalEdits'), desc: t('chat.approvalEditsDesc'), icon: NotePencilIcon },
		all: { key: 'all', label: t('chat.approvalAll'), desc: t('chat.approvalAllDesc'), icon: ShieldWarningIcon, tone: 'warn' }
	};
	// An agent's session shows the agent's four modes, read-only: they are
	// changed on its Agent page.
	const APPROVAL = $derived(
		(chat.agent
			? ['ask', 'edits', 'auto', 'all']
			: bcaps.extendedApprovalModes
				? ['ask', 'plan', 'auto', 'edits', 'all']
				: ['ask', 'edits', 'all']
		).map((k) => ({
			...APPROVAL_MODES[k],
			checked: chat.approvalMode === k,
			disabled: !!chat.agent
		}))
	);
	const approvalCurrent = $derived(APPROVAL.find((a) => a.checked) ?? APPROVAL_MODES.ask);

	// "+" menu: only capabilities the session already has. Files go through the
	// page's picker (images / videos are detected from the picked paths); goal
	// seeds the engine's /goal command; plan toggles claude's plan approval mode.
	const addSections = $derived.by(() => {
		const add: TraySection = {
			label: t('chat.addSection'),
			items: [{ id: 'files', icon: PaperclipIcon, title: t('chat.addFiles'), desc: t('chat.addFilesDesc'), onSelect: onPick }]
		};
		if (chat.commands.some((c) => c.command === '/goal')) {
			add.items.push({
				id: 'goal',
				icon: TargetIcon,
				title: t('chat.addGoal'),
				desc: t('chat.addGoalDesc'),
				onSelect: () => {
					el?.focus();
					if (!input.startsWith('/goal ')) input = `/goal ${input.trimStart()}`;
				}
			});
		}
		const sections = [add];
		if (bcaps.approvalModes && bcaps.extendedApprovalModes) {
			sections.push({
				label: t('chat.modeSection'),
				items: [
					{
						id: 'plan',
						icon: ListChecksIcon,
						title: t('chat.addPlan'),
						desc: t('chat.addPlanDesc'),
						checked: chat.approvalMode === 'plan',
						onSelect: () => onApproval(chat.approvalMode === 'plan' ? 'ask' : 'plan')
					}
				]
			});
		}
		// Picking any row closes the tray first.
		return sections.map((sec) => ({
			...sec,
			items: sec.items.map((it) => ({
				...it,
				onSelect: () => {
					showAdd = false;
					it.onSelect();
				}
			}))
		}));
	});
	// Persisting + pushing the mode to the engine lives with the page (it owns
	// the session id); the picker only reports the choice.
	function setApproval(m: string) {
		onApproval(m as ApprovalMode);
		showApproval = false;
	}


	// Every command the engine reported (the tray scrolls): names starting
	// with what was typed first, then names containing it.
	const slashMatches = $derived.by(() => {
		const t = input.trim().toLowerCase();
		if (!t.startsWith('/') || t.includes(' ')) return [];
		const all = chat.commands.filter((c) => c.command.toLowerCase() !== t);
		const head = all.filter((c) => c.command.toLowerCase().startsWith(t));
		const q = t.slice(1);
		return q ? [...head, ...all.filter((c) => !head.includes(c) && c.command.toLowerCase().includes(q))] : head;
	});

	// --- composer tray -------------------------------------------------------
	// One in-box list (ComposerTray) serves three modes: a pending agent
	// question, "/" command completion and the "+" menu. A question owns the
	// tray while it's pending; otherwise slash completion wins over "+".
	let tray = $state<ReturnType<typeof ComposerTray>>();
	let trayIdx = $state(0);
	// Escape hides slash completion until the typed command changes.
	let slashDismissed = $state(false);
	$effect(() => {
		slashMatches;
		slashDismissed = false;
	});

	const question = $derived(onRespond && chat.pendingApproval?.questions?.length ? chat.pendingApproval : null);
	let flow = $state<QuestionFlow>(startFlow());
	let picks = $state<string[]>([]);
	let seenQuestionId: string | null = null;
	$effect.pre(() => {
		const id = question?.callId ?? null;
		if (id === seenQuestionId) return;
		seenQuestionId = id;
		flow = startFlow();
		picks = [];
	});
	const currentQ = $derived(question?.questions?.[flow.step] ?? null);

	// Record an answer (picked option(s) or free-form text) for the current
	// question; the last one sends the whole map, same shape as before.
	function answerQuestion(value: string) {
		if (!question?.questions) return;
		const r = answerStep(question.questions, flow, value);
		picks = [];
		trayIdx = 0;
		if (r.done) onRespond?.({ op: 'approve', call_id: question.callId, decision: 'allow', answers: r.flow.answers });
		else flow = r.flow;
	}
	function cancelQuestion() {
		if (question) onRespond?.(buildApproveOp(question.callId, 'deny'));
	}

	const trayMode = $derived<'question' | 'slash' | 'add' | null>(
		currentQ ? 'question' : slashMatches.length && !slashDismissed ? 'slash' : showAdd ? 'add' : null
	);
	$effect(() => {
		trayMode;
		slashMatches;
		trayIdx = 0;
	});

	const traySections = $derived.by((): TraySection[] => {
		if (trayMode === 'question' && currentQ) {
			const multi = currentQ.multiSelect;
			// An MCP form's yes/no field answers "true"/"false".
			const elicit = question?.name === 'mcp_elicitation';
			const optionTitle = (label: string) =>
				elicit && (label === 'true' || label === 'false') ? t(label === 'true' ? 'chat.yes' : 'chat.no') : label;
			const options: TrayItem[] = currentQ.options.map((o, i) => ({
				id: `opt-${i}`,
				title: optionTitle(o.label),
				desc: o.description,
				box: multi,
				checked: multi ? picks.includes(o.label) : undefined,
				onSelect: () => (multi ? (picks = togglePick(picks, o.label)) : answerQuestion(o.label))
			}));
			const actions: TrayItem[] = [];
			if (multi)
				actions.push({
					id: 'submit',
					title: t('chat.questionSubmit'),
					desc: picks.length ? picks.join(', ') : t('chat.questionSubmitHint'),
					disabled: !picks.length,
					onSelect: () => answerQuestion(picks.join(', '))
				});
			actions.push({ id: 'cancel', title: t('chat.questionCancel'), desc: t('chat.questionCancelDesc'), onSelect: cancelQuestion });
			return [{ items: options }, { items: actions }];
		}
		if (trayMode === 'slash')
			return [
				{
					items: slashMatches.map((c) => ({
						id: c.command,
						icon: CommandIcon,
						title: c.command,
						mono: true,
						hint: c.args,
						desc: c.description,
						marker: c.marker,
						onSelect: () => (input = c.command + ' ')
					}))
				}
			];
		if (trayMode === 'add') return addSections;
		return [];
	});
	const trayLabel = $derived(
		trayMode === 'question' ? t('chat.questionLabel') : trayMode === 'slash' ? t('chat.slashMenuLabel') : t('chat.addTitle')
	);
	const trayMeta = $derived.by(() => {
		if (trayMode !== 'question' || !question?.questions) return '';
		const n = question.questions.length;
		return [
			// What the MCP server asks, over its form's fields.
			question.name === 'mcp_elicitation' && flow.step === 0 ? question.summary : '',
			currentQ?.header,
			n > 1 ? t('chat.questionProgress', { n: flow.step + 1, m: n }) : '',
			question.subagentId ? t('chat.subagentChip', { id: question.subagentId }) : ''
		]
			.filter(Boolean)
			.join(' · ');
	});
	function closeTray() {
		if (trayMode === 'question') cancelQuestion();
		else if (trayMode === 'slash') slashDismissed = true;
		else showAdd = false;
	}
	function toggleAdd() {
		showAdd = !showAdd;
		if (showAdd) el?.focus();
	}
	// Outside clicks close the "+" tray (rows and the "+" button keep focus in
	// the editor via mousedown preventDefault, so they don't count).
	function onComposerFocusOut(e: FocusEvent) {
		if (showAdd && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) showAdd = false;
	}
	// A pending question turns a typed message into its free-form answer.
	function submit() {
		if (!currentQ) return onSubmit();
		const text = input.trim();
		if (!text) return;
		answerQuestion(text);
		input = '';
	}

	// @-mention completion (files + folders). Lazily loads the project file list
	// (cached per cwd) the first time an @-token is typed. Matching logic lives in
	// $lib/mention (pure + unit-tested).
	let atFiles = $state<string[]>([]);
	let atCwd = $state('');
	let atIdx = $state(0);

	const atQuery = $derived.by(() => {
		const m = input.match(/(?:^|\s)@([^\s@]*)$/);
		return m ? m[1] : null;
	});
	$effect(() => {
		if (atQuery === null) return;
		if (atCwd !== chat.cwd) {
			atCwd = chat.cwd;
			atFiles = [];
			listFiles(chat.cwd || undefined)
				.then((f) => {
					if (atCwd === chat.cwd) atFiles = f;
				})
				.catch(() => {});
		}
	});

	const atEntries = $derived(buildEntries(atFiles));

	// Matches are debounced only for large entry sets, so small repos stay instant
	// while big monorepos coalesce rapid keystrokes. Top-K selection in
	// mentionMatches bounds the per-keystroke cost regardless.
	let atMatches = $state<AtEntry[]>([]);
	$effect(() => {
		const q = atQuery;
		const entries = atEntries;
		if (q === null) {
			atMatches = [];
			return;
		}
		if (entries.length > 3000) {
			const t = setTimeout(() => (atMatches = mentionMatches(entries, q)), 40);
			return () => clearTimeout(t);
		}
		atMatches = mentionMatches(entries, q);
	});
	$effect(() => {
		atMatches;
		atIdx = 0;
	});

	// Files complete the token (trailing space); folders append `/` so the menu
	// keeps drilling into their contents. Refocus the textarea so clicks don't
	// strand focus on the menu button.
	function applyAt(entry: AtEntry) {
		const suffix = entry.dir ? '/' : ' ';
		input = input.replace(/(?:^|\s)@([^\s@]*)$/, (full) => {
			const lead = /^\s/.test(full) ? full[0] : '';
			return `${lead}@${entry.path}${suffix}`;
		});
		el?.focus();
	}

	// Active option id for the combobox (aria-activedescendant).
	const activeOptionId = $derived(
		atMatches.length ? `cmp-opt-${atIdx}` : trayMode ? `cmp-tray-opt-${trayIdx}` : undefined
	);
	const menuOpen = $derived(!!trayMode || atMatches.length > 0 || atQuery !== null);

	// Gauge against the auto-compaction limit, so a full ring means "about to
	// compact" (falls back to the window if the engine didn't send a limit).
	// Only jucode reports a real compaction threshold; claude/codex send limit 0,
	// so we gauge against the raw window and label it "context used" instead of
	// "to compaction" (which would be misleading — the CLI compacts before 100%).
	const ctxAtThreshold = $derived(chat.contextLimit > 0);
	const ctxLimit = $derived(chat.contextLimit || chat.contextWindow);
	const ctxPct = $derived(
		ctxLimit > 0 ? Math.min(100, Math.round((chat.contextTokens / ctxLimit) * 100)) : 0
	);
	// Context use is not shown all the time: only once it gets close to the
	// limit, when it becomes something to act on.
	const CTX_SHOW_PCT = 70;
	const showCtx = $derived(bcaps.contextUsage && ctxLimit > 0 && ctxPct >= CTX_SHOW_PCT);

	function onKey(e: KeyboardEvent) {
		// While an IME is composing (e.g. selecting a Chinese candidate with Enter),
		// don't treat keys as commands — Enter here confirms the candidate, not send.
		if (e.isComposing || e.keyCode === 229) return;
		if (atMatches.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				atIdx = (atIdx + 1) % atMatches.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				atIdx = (atIdx - 1 + atMatches.length) % atMatches.length;
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				applyAt(atMatches[atIdx]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				input += ' ';
				return;
			}
		}
		// Tab in an empty editor takes the engine's suggested next prompt.
		if (e.key === 'Tab' && !e.shiftKey && input === '' && chat.suggestion && !trayMode) {
			e.preventDefault();
			input = chat.suggestion;
			chat.suggestion = '';
			return;
		}
		// The tray owns navigation keys; for a question only while the editor is
		// empty, so a typed answer keeps normal caret keys and Enter sends it.
		if (trayMode && (trayMode !== 'question' || input.trim() === '') && tray?.handleKey(e)) {
			e.stopPropagation();
			return;
		}
		if (bcaps.approvalModes && !chat.agent && matches(e, 'approvalMode')) {
			e.preventDefault();
			const i = APPROVAL.findIndex((a) => a.checked);
			onApproval(APPROVAL[(i + 1) % APPROVAL.length].key as ApprovalMode);
			return;
		}
		if (e.key === 'Enter') {
			// contenteditable would otherwise insert a <div>/<br>; we control both:
			// plain Enter submits, Shift+Enter inserts a newline (rendered via pre-wrap).
			e.preventDefault();
			if (e.shiftKey) insertTextAtCaret('\n');
			else submit();
		}
	}

	// Paste an image straight from the clipboard: write it to a temp file and
	// attach the path (screenshots, copied images — no need to save to disk first).
	async function onPaste(e: ClipboardEvent) {
		const dt = e.clipboardData;
		if (!dt) return;
		// Image paste → temp-file attachment (screenshots, copied images).
		let imaged = false;
		for (const it of dt.items) {
			if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
			const file = it.getAsFile();
			if (!file) continue;
			imaged = true;
			const ext = (it.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
			try {
				const buf = new Uint8Array(await file.arrayBuffer());
				const path = await saveTempImage(buf, ext);
				onImage(path);
			} catch {
				/* ignore */
			}
		}
		if (imaged) {
			e.preventDefault();
			return;
		}
		// Plain-text paste: insert as text so no rich HTML lands in the editor.
		const text = dt.getData('text/plain');
		if (text) {
			e.preventDefault();
			insertTextAtCaret(text);
		}
	}

	// Voice input: mic → utterances split at pauses → 16 kHz WAV → ASR (Tauri
	// backend). Each utterance is transcribed while the user keeps talking and
	// appended in order, so text shows up during recording. Auto-stops at 3 min
	// in case the mic is left on.
	let voice = $state<'idle' | 'rec' | 'busy'>('idle');
	let recorder: VoiceRecorder | null = null;
	let voiceLevels = $state<AnalyserNode | null>(null);
	let voiceTimer: ReturnType<typeof setTimeout> | undefined;
	let voiceQueue: Promise<void> = Promise.resolve();
	let voiceFailed = false;

	// Utterances join with a space only between non-CJK text.
	const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;
	function appendVoice(text: string) {
		if (!text) return;
		const sep = input && !/\s$/.test(input) && !CJK.test(input.slice(-1)) && !CJK.test(text[0]) ? ' ' : '';
		input = input + sep + text;
		el?.focus();
	}

	function transcribeSegment(base64: string) {
		voiceQueue = voiceQueue.then(async () => {
			try {
				appendVoice((await transcribeAudio(base64)).trim());
			} catch (e) {
				// One toast per recording: a bad key fails every utterance.
				if (!voiceFailed) toast.error(String(e));
				voiceFailed = true;
			}
		});
	}

	async function toggleVoice() {
		if (voice === 'busy') return;
		if (voice === 'rec') return stopVoice();
		try {
			const r = new VoiceRecorder(transcribeSegment);
			await r.start();
			recorder = r;
			voiceLevels = r.analyser;
			voiceFailed = false;
			voice = 'rec';
			voiceTimer = setTimeout(stopVoice, 180_000);
		} catch (e) {
			recorder = null;
			toast.error(t('chat.voiceMicError', { error: String(e) }));
		}
	}

	async function stopVoice() {
		if (!recorder) return;
		clearTimeout(voiceTimer);
		recorder.stop();
		recorder = null;
		voiceLevels = null;
		voice = 'busy';
		await voiceQueue;
		voice = 'idle';
	}

</script>

<svelte:window onkeydowncapture={onWindowKeyCapture} />

<div class="composer-wrap">
	{#if atQuery !== null}
		<MentionMenu matches={atMatches} query={atQuery} selected={atIdx} onSelect={applyAt} onHover={(i) => (atIdx = i)} />
	{/if}
	{#if attachments.length || videos.length}
		<AttachmentChips
			{attachments}
			{videos}
			onRemove={(i) => attachments.splice(i, 1)}
			onRemoveVideo={(i) => videos.splice(i, 1)}
		/>
	{/if}
	{#if chat.approvalPending && chat.busy}
		<!-- The engine applies the picked mode only from the next turn. -->
		<div class="queued">
			<span class="queued-label">{t('chat.modePending', { mode: APPROVAL_MODES[chat.approvalPending]?.label ?? chat.approvalPending })}</span>
			<button class="qsteer" onclick={onStop}>{t('chat.modeApplyNow')}</button>
		</div>
	{/if}
	{#if chat.pendingMessages.length}
		<div class="queued">
			<span class="queued-label">{t('chat.queuedLabel', { n: chat.pendingMessages.length })}</span>
			{#each chat.pendingMessages as q, i (i)}
				<span class="qchip" title={q}>{q}</span>
			{/each}
			{#if bcaps.steer}
				<button class="qsteer" onclick={onSteer} title={t('chat.steerTitle')}><FastForwardIcon size={12} />{t('chat.steerAction')}</button>
			{/if}
		</div>
	{/if}
	<div class="composer" onfocusout={onComposerFocusOut}>
		{#if trayMode}
			<ComposerTray
				bind:this={tray}
				bind:selected={trayIdx}
				label={trayLabel}
				heading={trayMode === 'question' ? (currentQ?.question ?? '') : ''}
				meta={trayMeta}
				sections={traySections}
				tab={trayMode === 'slash' ? 'pick' : trayMode === 'add' ? 'close' : 'none'}
				onClose={closeTray}
			/>
		{/if}
		<div
			class="rich"
			class:empty={input === ''}
			bind:this={el}
			contenteditable="true"
			role="combobox"
			tabindex="0"
			data-placeholder={chat.suggestion && !currentQ
				? t('chat.suggestionPlaceholder', { text: chat.suggestion })
				: t(currentQ ? 'chat.questionPlaceholder' : chat.isChatMode ? 'chat.chatPlaceholder' : 'chat.composerPlaceholder')}
			oninput={syncFromDom}
			onkeydown={onKey}
			onpaste={onPaste}
			oncompositionstart={() => (composing = true)}
			oncompositionend={() => {
				composing = false;
				syncFromDom();
			}}
			aria-expanded={menuOpen}
			aria-controls={atQuery !== null ? 'composer-menu' : 'cmp-tray'}
			aria-autocomplete="list"
			aria-activedescendant={activeOptionId}
		></div>
		<div class="composer-bar">
			<button
				class="addbtn"
				class:on={showAdd}
				disabled={!!currentQ}
				onmousedown={(e) => e.preventDefault()}
				onclick={toggleAdd}
				aria-label={t('chat.addTitle')}
				title={t('chat.addTitle')}
				aria-expanded={showAdd}
			>
				<PlusIcon size={18} />
			</button>
			{#if bcaps.approvalModes}
				<div class="footsel">
					<button class="foot-chip" class:auto={chat.approvalMode !== 'ask'} class:warn={approvalCurrent.tone === 'warn'} onclick={() => (showApproval = !showApproval)} title={withShortcut(t('chat.approvalModeTitle'), 'approvalMode')}>
						{#if approvalCurrent.icon}<approvalCurrent.icon size={17} />{/if}<span>{approvalCurrent.label}</span>
					</button>
					{#if showApproval}
						<PopMenu
							title={chat.agent ? t('chat.approvalAgent') : t('chat.approvalQuestion')}
							items={APPROVAL}
							placement="up-left"
							onSelect={setApproval}
							onClose={() => (showApproval = false)}
						/>
					{/if}
				</div>
			{/if}
			<div class="cspace"></div>
			{#if chat.efforts.length || bcaps.modelPicker || !backendLocked}
				<!-- Model · effort: one button, one menu (agent, effort, models). -->
				<button
					class="flatbtn model"
					class:pending={effortDisabled}
					bind:this={modelButton}
					onclick={toggleModelPopover}
					title={withShortcut(t('chat.switchModel'), 'model')}
					aria-haspopup="dialog"
					aria-expanded={modelPopoverVisible}
				>
					<!-- Model changes slide the name in; the top effort sweeps in the model's colour. -->
					{#key chat.model}
						<span class="mswap">
							{#if chat.backendId === 'jucode' && chat.model}<Vendor model={chat.model} size={15} />{:else}<BackendIcon backend={chat.backendId} size={15} />{/if}
							<span class="m">{chat.modelLabel || chat.model || backendLabel}</span>
						</span>
					{/key}
					{#if chat.efforts.length}{#key chat.effort}<span
								class="e"
								class:effort-max={isTopEffort(chat.effort, chat.efforts)}
								style:--effort-accent={modelColor(chat.model) || 'var(--text)'}>{effortLabel(chat.effort) || t('chat.effortTitle')}</span
							>{/key}{/if}
					{#if chat.ultracode}<span class="e">· Ultracode</span>{/if}
				</button>
			{:else if chat.model}
				<span class="flatbtn model static"><BackendIcon backend={chat.backendId} size={15} /><span>{chat.modelLabel || chat.model}</span></span>
			{/if}
			{#if modelPopoverVisible}
				<ModelMenu
					{chat}
					canPickModel={bcaps.modelPicker}
					rows={bcaps.modelPicker ? modelRows : []}
					showSearch={modelSearch}
					{backendLocked}
					{toolProvider}
					{effortDisabled}
					anchor={modelButton}
					bind:query={pickerQuery}
					bind:selIdx={pickerSelIdx}
					onClose={closeModelPopover}
					onSelect={selectFromPopover}
					onEffort={setEffort}
					{onSwitch}
					{onBackend}
					onRefreshModels={() => onModel()}
				/>
			{/if}
			{#if voiceLevels}<VoiceWave analyser={voiceLevels} />{/if}
			<button
				class="cact voice"
				class:on={voice === 'rec'}
				class:pulse={voice === 'rec'}
				onclick={toggleVoice}
				disabled={voice === 'busy'}
				aria-label="voice input"
				title={voice === 'rec' ? t('chat.voiceStopTitle') : voice === 'busy' ? t('chat.voiceBusyTitle') : t('chat.voiceTitle')}
			>
				{#if voice === 'busy'}<CircleNotchIcon size={15} class="spin" />{:else if voice === 'rec'}<StopCircleIcon size={15} />{:else}<MicrophoneIcon size={17} />{/if}
			</button>
			{#if chat.busy && !currentQ}
				<button class="cact stop" onclick={onStop} aria-label="stop" title={withShortcut(t('chat.stopTitle'), 'stop')}><SquareIcon size={15} /></button>
			{:else}
				<button class="cact send" onclick={submit} disabled={!input.trim() && !attachments.length && !videos.length} aria-label="send" title={t('chat.sendTitle')}><ArrowUpIcon size={17} /></button>
			{/if}
		</div>
	</div>
	<!-- Slim strip in the blank area under the card: branch · approval | context. -->
	<div class="composer-foot">
		{#if gitBranch}
			<!-- Switching under a running turn would change its files mid-edit. -->
			<span class="branch-anchor">
				<button
					class="foot-branch"
					disabled={!gitCwd || chat.busy}
					title={chat.busy ? t('chat.branchMenu.busy') : t('chat.gitBranch')}
					onclick={() => (branchOpen = !branchOpen)}
				><GitBranchIcon size={12} /><span class="branch-name">{gitBranch}</span></button>
				{#if branchOpen && gitCwd}
					<BranchMenu
						cwd={gitCwd}
						repo={repoName}
						current={gitBranch}
						onChanged={() => onBranchChanged?.()}
						onClose={() => (branchOpen = false)}
					/>
				{/if}
			</span>
		{/if}
		<div class="fspace"></div>
		{#if showCtx}
			<div class="foot-ctx">
				<ContextIndicator pct={ctxPct} atThreshold={ctxAtThreshold} contextTokens={chat.contextTokens} contextLimit={ctxLimit} totalIn={chat.totalIn} totalOut={chat.totalOut} cost={chat.cost} billing={chat.billing} billingError={chat.billingError} runMs={chat.runMs} />
			</div>
		{/if}
	</div>
</div>

<style>
	/* Lines up with the conversation column (ChatPane's --chat-w). */
	.composer-wrap {
		padding: 0 var(--chat-pad, 32px) 18px;
		max-width: calc(var(--chat-w, 844px) + 2 * var(--chat-pad, 32px));
		width: 100%;
		margin: 0 auto;
	}
	.composer {
		background: var(--panel);
		border-radius: var(--r-2xl);
		padding: 14px 16px 12px;
		box-shadow: var(--shadow-float);
		transition: box-shadow var(--t-med) var(--ease-out);
	}
	.composer:focus-within {
		box-shadow: var(--shadow-float-strong);
	}
	.rich {
		position: relative;
		width: 100%;
		min-height: 22px;
		max-height: 180px;
		overflow-y: auto;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-md);
		line-height: 1.55;
		padding: 2px 0 8px;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: break-word;
		cursor: text;
	}
	/* One line, cut short in a narrow box; laid over the caret's line. */
	.rich.empty::before {
		content: attr(data-placeholder);
		position: absolute;
		left: 0;
		right: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		pointer-events: none;
	}
	/* Web-element reference chip: atomic (contenteditable=false), deletes as a unit.
	   Chips are created in JS, so Svelte's scoped hash never lands on them — style
	   them via :global, kept namespaced under the scoped .rich. */
	.rich :global(.refchip) {
		display: inline;
		white-space: normal;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: var(--r-xs);
		padding: 1px 6px 1px 5px;
		margin: 0 1px;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
		font-size: var(--fs-sm);
		-webkit-user-select: none;
		user-select: none;
		cursor: default;
	}
	.rich :global(.refchip.imgchip) {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 6px 1px 2px;
		vertical-align: -3px;
		color: var(--text);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border-strong);
	}
	.rich :global(.refchip.imgchip img) {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		object-fit: cover;
	}
	/* A quoted passage: the opening words after a quote mark. */
	.rich :global(.refchip.quotechip) {
		color: var(--dim);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		padding: 1px 7px 1px 6px;
	}
	.rich :global(.refchip.quotechip)::before {
		content: '';
		display: inline-block;
		width: 11px;
		height: 11px;
		margin-right: 5px;
		vertical-align: -1px;
		background: var(--dim2);
		mask: var(--quote-mask) center / contain no-repeat;
	}
	.rich :global(.refchip:not(.imgchip):not(.quotechip))::before {
		content: '🌐';
		margin-right: 3px;
		font-size: var(--fs-2xs);
	}
	.composer-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}
	.flatbtn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
	}
	.flatbtn:hover {
		background: var(--surface2);
	}
	.flatbtn:active:not(.static) {
		transform: scale(0.97);
	}
	/* Model · effort trigger: model name, effort dimmer beside it. */
	.flatbtn.model {
		min-width: 0;
	}
	.flatbtn.model span {
		min-width: 0;
		max-width: 220px;
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mswap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		animation: model-in var(--t-med) var(--ease-out);
	}
	@keyframes model-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	.flatbtn.model .e {
		flex-shrink: 0;
		color: var(--dim);
		animation: rise var(--t-fast) var(--ease-out);
	}
	.flatbtn.model.pending {
		opacity: 0.6;
	}
	/* Circular "+" opening the add menu. */
	.addbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		border: 1px solid var(--hairline);
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
	}
	.addbtn:hover,
	.addbtn.on {
		background: var(--surface2);
		color: var(--text);
	}
	.addbtn:active:not(:disabled) {
		transform: scale(0.94);
	}
	.addbtn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* read-only model label for backends without an in-chat model picker */
	.flatbtn.static {
		cursor: default;
	}
	.flatbtn.static:hover {
		background: none;
	}
	.flatbtn.static:active {
		transform: none;
	}
	.footsel {
		position: relative;
		display: inline-flex;
	}
	.cspace {
		flex: 1;
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--r-full);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			transform var(--t-fast) var(--ease-spring),
			box-shadow var(--t-med) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			opacity var(--t-med) var(--ease-out);
	}
	.cact:active:not(:disabled) {
		transform: scale(0.9);
	}
	/* Flat send: white (text color) when ready, quiet gray when there's nothing
	   to send. No gradients, no borders, no glow. */
	.cact.send {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cact.send:hover:not(:disabled) {
		opacity: 0.85;
	}
	.cact.send:active:not(:disabled) {
		transform: scale(0.9);
	}
	.cact.send:disabled {
		background: color-mix(in oklab, var(--text) 32%, var(--panel));
		color: var(--on-accent);
		cursor: default;
	}
	.cact.stop {
		background: color-mix(in oklab, var(--err) 14%, transparent);
		color: var(--err);
	}
	.cact.stop:hover {
		background: color-mix(in oklab, var(--err) 22%, transparent);
	}
	/* Small circular voice button, quiet until it records. */
	.cact.voice {
		background: var(--surface2);
		color: var(--dim);
	}
	.cact.voice:hover:not(:disabled) {
		color: var(--text);
	}
	.cact.voice.on {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
	}
	.cact.voice:disabled {
		cursor: default;
		color: var(--dim2);
	}

	/* ---------- footer strip (outside the card) ---------- */
	.composer-foot {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px 0;
		min-height: 24px;
		color: var(--dim);
	}
	.branch-anchor {
		position: relative;
		display: inline-flex;
		min-width: 0;
	}
	.foot-branch {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		margin: -2px -6px;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.foot-branch:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.foot-branch:disabled {
		cursor: default;
	}
	.branch-name {
		max-width: 180px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.foot-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.foot-chip:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.foot-chip.auto {
		color: var(--text);
	}
	.foot-chip.warn {
		color: var(--warn);
	}
	.fspace {
		flex: 1;
	}
	.foot-ctx {
		display: inline-flex;
		align-items: center;
	}

	.queued {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.queued-label {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: var(--r-full);
		padding: 2px 9px;
		flex-shrink: 0;
	}
	.qchip {
		font-size: var(--fs-xs);
		max-width: 260px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 3px 9px;
		animation: rise var(--t-med) var(--ease-out);
	}
	.qsteer {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		font-size: var(--fs-xs);
		color: var(--accent-bright);
		background: none;
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: var(--r-sm);
		padding: 3px 9px;
		cursor: pointer;
		flex-shrink: 0;
		transition: background var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
	}
	.qsteer:hover {
		background: var(--accent-soft);
	}
	.qsteer:active {
		transform: scale(0.97);
	}
</style>
