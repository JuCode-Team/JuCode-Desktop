<script lang="ts">
	import { Send, Square, Paperclip, FastForward, ShieldCheck, CircleStop, Mic, LoaderCircle, GitBranch } from 'lucide-svelte';
	import { message } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { listFiles, saveTempImage, transcribeAudio } from '$lib/protocol';
	import { VoiceRecorder } from '$lib/audio';
	import { buildEntries, mentionMatches, type AtEntry } from '$lib/mention';
	import { t } from '$lib/i18n';
	import SlashMenu from '$lib/composer/SlashMenu.svelte';
	import MentionMenu from '$lib/composer/MentionMenu.svelte';
	import AttachmentChips from '$lib/composer/AttachmentChips.svelte';
	import ContextIndicator from '$lib/composer/ContextIndicator.svelte';
	import AgentModelPopover from '$lib/composer/AgentModelPopover.svelte';
	import type { ModelRow } from '$lib/composer/modelRows';
	import type { ChatState } from '$lib/chat.svelte';
	import type { ApprovalMode } from '$lib/approval';
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
		modelTitle = '',
		modelSearch = false,
		backendLocked = true,
		gitBranch = '',
		onBackend,
		onSubmit,
		onStop,
		onSteer,
		onPick,
		onModel,
		onModelSelect,
		onModelClose,
		onApproval
	}: {
		chat: ChatState;
		input: string;
		attachments: { path: string; image: boolean }[];
		videos?: { path: string; frames: string[]; duration: number }[];
		el: HTMLElement | null;
		pickerQuery?: string;
		pickerSelIdx?: number;
		modelRows?: ModelRow[];
		modelTitle?: string;
		modelSearch?: boolean;
		/** False only while the session is still virgin (no user turn) — the
		 *  agent rail in the model popover shows then and disappears afterwards. */
		backendLocked?: boolean;
		/** Current git branch for the footer strip ('' hides the chip). */
		gitBranch?: string;
		onBackend?: (b: BackendId, acpAgent?: { id: string; name: string }) => void | Promise<void>;
		onSubmit: () => void;
		onStop: () => void;
		onSteer: () => void;
		onPick: () => void;
		onModel: () => void;
		onModelSelect?: (command: string) => void;
		onModelClose?: () => void;
		onApproval: (mode: ApprovalMode) => void;
	} = $props();

	let slashIdx = $state(0);
	let showApproval = $state(false);

	// The model popover holds its own open flag so it can outlive an agent
	// switch (the new session ChatState starts with no picker) and open for
	// agents without a model catalog (ACP) — the rail inside it is the only
	// way to pick a coding agent.
	let modelOpen = $state(false);
	const modelPopoverVisible = $derived(modelOpen || chat.picker?.kind === 'model');
	function toggleModelPopover() {
		if (modelPopoverVisible) {
			closeModelPopover();
			return;
		}
		modelOpen = true;
		if (bcaps.modelPicker) onModel();
	}
	function closeModelPopover() {
		modelOpen = false;
		if (chat.picker?.kind === 'model') onModelClose?.();
	}
	function selectFromPopover(command: string) {
		modelOpen = false;
		onModelSelect?.(command);
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
	const TOKEN_RE = /\[网页元素#(\d+)(?::([^\]]*))?\]/g;

	const tokenLabel = (token: string) => {
		const m = /^\[网页元素#(\d+)(?::([^\]]*))?\]$/.exec(token);
		return m ? (m[2]?.trim() || `#${m[1]}`) : token;
	};
	function makeChip(token: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'refchip';
		span.contentEditable = 'false';
		span.dataset.token = token;
		span.textContent = tokenLabel(token);
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
				else if (e.tagName === 'BR') out += '\n';
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
	}
	function caretToEnd() {
		if (!el) return;
		const r = document.createRange();
		r.selectNodeContents(el);
		r.collapse(false);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(r);
	}
	function syncFromDom() {
		if (!el) return;
		const s = serialize(el);
		// Normalize a WebKit-left empty state so the placeholder shows.
		if (s === '' && el.childNodes.length) el.textContent = '';
		lastSync = s;
		input = s;
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
		const after = document.createRange();
		after.setStartAfter(lastNode);
		after.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(after);
		syncFromDom();
	}
	function insertTextAtCaret(text: string) {
		insertNodesAtCaret([document.createTextNode(text)]);
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
	const APPROVAL = $derived(
		bcaps.extendedApprovalModes
			? [
					{ value: 'ask', label: t('chat.approvalAsk') },
					{ value: 'plan', label: t('chat.approvalPlan') },
					{ value: 'auto', label: t('chat.approvalAuto') },
					{ value: 'edits', label: t('chat.approvalEdits') },
					{ value: 'all', label: t('chat.approvalAll') }
				]
			: [
					{ value: 'ask', label: t('chat.approvalAsk') },
					{ value: 'edits', label: t('chat.approvalEdits') },
					{ value: 'all', label: t('chat.approvalAll') }
				]
	);
	const approvalLabel = $derived(APPROVAL.find((a) => a.value === chat.approvalMode)?.label ?? t('chat.approvalAsk'));
	// Persisting + pushing the mode to the engine lives with the page (it owns
	// the session id); the picker only reports the choice.
	function setApproval(m: string) {
		onApproval(m as ApprovalMode);
		showApproval = false;
	}

	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

	const slashMatches = $derived.by(() => {
		const t = input.trim();
		if (!t.startsWith('/') || t.includes(' ')) return [];
		return chat.commands.filter((c) => c.command.startsWith(t) && c.command !== t).slice(0, 8);
	});
	$effect(() => {
		slashMatches;
		slashIdx = 0;
	});

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
		slashMatches.length ? `cmp-opt-${slashIdx}` : atMatches.length ? `cmp-opt-${atIdx}` : undefined
	);
	const menuOpen = $derived(slashMatches.length > 0 || atMatches.length > 0 || atQuery !== null);

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

	function onKey(e: KeyboardEvent) {
		// While an IME is composing (e.g. selecting a Chinese candidate with Enter),
		// don't treat keys as commands — Enter here confirms the candidate, not send.
		if (e.isComposing || e.keyCode === 229) return;
		if (slashMatches.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				slashIdx = (slashIdx + 1) % slashMatches.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				slashIdx = (slashIdx - 1 + slashMatches.length) % slashMatches.length;
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				input = slashMatches[slashIdx].command + ' ';
				return;
			}
		}
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
		if (e.key === 'Enter') {
			// contenteditable would otherwise insert a <div>/<br>; we control both:
			// plain Enter submits, Shift+Enter inserts a newline (rendered via pre-wrap).
			e.preventDefault();
			if (e.shiftKey) insertTextAtCaret('\n');
			else onSubmit();
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
				if (!attachments.some((a) => a.path === path)) attachments.push({ path, image: true });
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

	// Voice input: mic → 16 kHz WAV → MiMo ASR (Tauri backend) → append to the
	// composer. Auto-stops at 3 min so the base64 payload stays under MiMo's
	// 10 MB cap.
	let voice = $state<'idle' | 'rec' | 'busy'>('idle');
	let recorder: VoiceRecorder | null = null;
	let voiceTimer: ReturnType<typeof setTimeout> | undefined;

	async function toggleVoice() {
		if (voice === 'busy') return;
		if (voice === 'rec') return stopVoice();
		try {
			const r = new VoiceRecorder();
			await r.start();
			recorder = r;
			voice = 'rec';
			voiceTimer = setTimeout(stopVoice, 180_000);
		} catch (e) {
			recorder = null;
			await message(t('chat.voiceMicError', { error: String(e) }), { title: 'JuCode', kind: 'error' });
		}
	}

	async function stopVoice() {
		if (!recorder) return;
		clearTimeout(voiceTimer);
		const { base64, seconds } = recorder.stop();
		recorder = null;
		// Accidental tap — nothing worth a round-trip.
		if (seconds < 0.5) {
			voice = 'idle';
			return;
		}
		voice = 'busy';
		try {
			const text = (await transcribeAudio(base64)).trim();
			if (text) {
				input = input && !/\s$/.test(input) ? `${input} ${text}` : input + text;
				el?.focus();
			}
		} catch (e) {
			await message(String(e), { title: 'JuCode', kind: 'error' });
		} finally {
			voice = 'idle';
		}
	}

</script>

<div class="composer-wrap">
	{#if slashMatches.length}
		<SlashMenu matches={slashMatches} selected={slashIdx} onSelect={(c) => (input = c.command + ' ')} onHover={(i) => (slashIdx = i)} />
	{:else if atQuery !== null}
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
	{#if chat.pendingMessages.length}
		<div class="queued">
			<span class="queued-label">{t('chat.queuedLabel', { n: chat.pendingMessages.length })}</span>
			{#each chat.pendingMessages as q, i (i)}
				<span class="qchip" title={q}>{q}</span>
			{/each}
			{#if bcaps.steer}
				<button class="qsteer" onclick={onSteer} title={t('chat.steerTitle')}><FastForward size={12} />{t('chat.steerAction')}</button>
			{/if}
		</div>
	{/if}
	<div class="composer">
		<div
			class="rich"
			class:empty={input === ''}
			bind:this={el}
			contenteditable="true"
			role="combobox"
			tabindex="0"
			data-placeholder={t('chat.composerPlaceholder')}
			oninput={syncFromDom}
			onkeydown={onKey}
			onpaste={onPaste}
			oncompositionstart={() => (composing = true)}
			oncompositionend={() => {
				composing = false;
				syncFromDom();
			}}
			aria-expanded={menuOpen}
			aria-controls="composer-menu"
			aria-autocomplete="list"
			aria-activedescendant={activeOptionId}
		></div>
		<div class="composer-bar">
			<IconButton onclick={onPick} label="attach" title={t('chat.attachTitle')}><Paperclip size={16} /></IconButton>
			{#if bcaps.modelPicker || !backendLocked}
				<div class="modelsel">
					<button class="flatbtn model" onclick={toggleModelPopover} title={t('chat.switchModel')}>
						<BackendIcon backend={chat.backendId} size={15} />
						<span>{chat.modelLabel || chat.model || backendLabel}</span>
					</button>
					{#if modelPopoverVisible}
						<AgentModelPopover
							{chat}
							title={modelTitle || t('shell.picker.model')}
							rows={modelRows}
							showSearch={modelSearch}
							{backendLocked}
							bind:query={pickerQuery}
							bind:selIdx={pickerSelIdx}
							onClose={closeModelPopover}
							onSelect={selectFromPopover}
							{onBackend}
							onRefreshModels={() => onModel()}
						/>
					{/if}
				</div>
			{:else if chat.model}
				<span class="flatbtn model static"><BackendIcon backend={chat.backendId} size={15} /><span>{chat.modelLabel || chat.model}</span></span>
			{/if}
			<div class="cspace"></div>
			<button
				class="cact voice"
				class:on={voice === 'rec'}
				onclick={toggleVoice}
				disabled={voice === 'busy'}
				aria-label="voice input"
				title={voice === 'rec' ? t('chat.voiceStopTitle') : voice === 'busy' ? t('chat.voiceBusyTitle') : t('chat.voiceTitle')}
			>
				{#if voice === 'busy'}<span class="vspin"><LoaderCircle size={15} /></span>{:else if voice === 'rec'}<CircleStop size={15} />{:else}<Mic size={15} />{/if}
			</button>
			{#if chat.busy}
				<button class="cact stop" onclick={onStop} aria-label="stop" title={t('chat.stopTitle')}><Square size={15} /></button>
			{:else}
				<button class="cact send" onclick={onSubmit} disabled={!input.trim() && !attachments.length && !videos.length} aria-label="send" title={t('chat.sendTitle')}><Send size={15} /></button>
			{/if}
		</div>
	</div>
	<!-- Slim strip in the blank area under the card: branch · approval | context. -->
	<div class="composer-foot">
		{#if gitBranch}
			<span class="foot-branch" title={t('chat.gitBranch')}><GitBranch size={12} /><span class="branch-name">{gitBranch}</span></span>
		{/if}
		{#if bcaps.approvalModes}
			<div class="footsel">
				<button class="foot-chip" class:auto={chat.approvalMode !== 'ask'} onclick={() => (showApproval = !showApproval)} title={t('chat.approvalModeTitle')}>
					<ShieldCheck size={12} /><span>{approvalLabel}</span>
				</button>
				{#if showApproval}
					<button class="pop-backdrop" aria-label="close" onclick={() => (showApproval = false)}></button>
					<div class="effort-pop">
						<Segmented value={chat.approvalMode} options={APPROVAL} onChange={setApproval} />
					</div>
				{/if}
			</div>
		{/if}
		<div class="fspace"></div>
		{#if bcaps.contextUsage && ctxLimit > 0}
			<div class="foot-ctx">
				<ContextIndicator pct={ctxPct} atThreshold={ctxAtThreshold} contextTokens={chat.contextTokens} contextLimit={ctxLimit} totalIn={chat.totalIn} totalOut={chat.totalOut} cost={chat.cost} />
				<span class="ctx-text">{fmtTokens(chat.contextTokens)} / {fmtTokens(ctxLimit)}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.composer-wrap {
		padding: 0 18px 18px;
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
	}
	.composer {
		background: var(--panel);
		border: 1px solid var(--hairline);
		border-radius: var(--r-xl);
		padding: 12px 14px 10px;
		transition: border-color var(--t-med) var(--ease-out);
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--accent) 40%, var(--hairline));
	}
	.rich {
		width: 100%;
		min-height: 22px;
		max-height: 180px;
		overflow-y: auto;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 14px;
		line-height: 1.55;
		padding: 2px 0 8px;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: break-word;
		cursor: text;
	}
	.rich.empty::before {
		content: attr(data-placeholder);
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
		border-radius: 5px;
		padding: 1px 6px 1px 5px;
		margin: 0 1px;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
		font-size: 12.5px;
		-webkit-user-select: none;
		user-select: none;
		cursor: default;
	}
	.rich :global(.refchip)::before {
		content: '🌐';
		margin-right: 3px;
		font-size: 10px;
	}
	.composer-bar {
		display: flex;
		align-items: center;
		gap: 8px;
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
		font-size: 13px;
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
	.flatbtn.model span {
		font-family: var(--font-mono);
		font-size: 12px;
		max-width: 220px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	/* position:relative anchors for the model popover / the approval popover */
	.modelsel,
	.footsel {
		position: relative;
		display: inline-flex;
	}
	.pop-backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 20;
		cursor: default;
	}
	.effort-pop {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 21;
		padding: 6px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.cspace {
		flex: 1;
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
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
		background: var(--text);
		color: var(--panel);
	}
	.cact.send:hover:not(:disabled) {
		opacity: 0.85;
	}
	.cact.send:active:not(:disabled) {
		transform: scale(0.9);
	}
	.cact.send:disabled {
		background: var(--surface2);
		color: var(--dim2);
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
		animation: pulse 1.2s ease-in-out infinite;
	}
	.cact.voice:disabled {
		cursor: default;
		color: var(--dim2);
	}
	.vspin {
		display: inline-flex;
		animation: vspin 0.9s linear infinite;
	}
	@keyframes vspin {
		to {
			transform: rotate(360deg);
		}
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
	.foot-branch {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
		min-width: 0;
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
		gap: 5px;
		padding: 2px 9px;
		border: 1px solid var(--hairline);
		border-radius: 999px;
		background: none;
		color: var(--dim);
		font-size: 11px;
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.foot-chip:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.foot-chip.auto {
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 35%, transparent);
	}
	.fspace {
		flex: 1;
	}
	.foot-ctx {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.ctx-text {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
	}

	.queued {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.queued-label {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 2px 9px;
		flex-shrink: 0;
	}
	.qchip {
		font-size: 12px;
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
		font-size: 12px;
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
