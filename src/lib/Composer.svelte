<script lang="ts">
	import { Send, Square, Paperclip, FastForward, ShieldCheck, Camera, Video, CircleStop, Mic, LoaderCircle } from 'lucide-svelte';
	import { message } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import EffortSlider from '$lib/ui/EffortSlider.svelte';
	import { listFiles, saveTempImage, transcribeAudio } from '$lib/protocol';
	import { VoiceRecorder } from '$lib/audio';
	import { buildEntries, mentionMatches, type AtEntry } from '$lib/mention';
	import { t } from '$lib/i18n';
	import SlashMenu from '$lib/composer/SlashMenu.svelte';
	import MentionMenu from '$lib/composer/MentionMenu.svelte';
	import AttachmentChips from '$lib/composer/AttachmentChips.svelte';
	import ContextIndicator from '$lib/composer/ContextIndicator.svelte';
	import type { ChatState } from '$lib/chat.svelte';
	import type { ApprovalMode } from '$lib/approval';
	import { caps } from '$lib/backends';

	let {
		chat,
		input = $bindable(),
		attachments = $bindable(),
		videos = $bindable([]),
		el = $bindable(),
		recording = false,
		onSubmit,
		onStop,
		onSteer,
		onPick,
		onScreenshot,
		onRecord,
		onModel,
		onEffort,
		onApproval
	}: {
		chat: ChatState;
		input: string;
		attachments: { path: string; image: boolean }[];
		videos?: { path: string; frames: string[]; duration: number }[];
		el: HTMLElement | null;
		recording?: boolean;
		onSubmit: () => void;
		onStop: () => void;
		onSteer: () => void;
		onPick: () => void;
		onScreenshot?: () => void;
		onRecord?: () => void;
		onModel: () => void;
		onEffort: (ef: string) => void;
		onApproval: (mode: ApprovalMode) => void;
	} = $props();

	let slashIdx = $state(0);
	let showEffort = $state(false);
	let showApproval = $state(false);

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

	const APPROVAL = $derived([
		{ value: 'ask', label: t('chat.approvalAsk') },
		{ value: 'edits', label: t('chat.approvalEdits') },
		{ value: 'all', label: t('chat.approvalAll') }
	]);
	const approvalLabel = $derived(APPROVAL.find((a) => a.value === chat.approvalMode)?.label ?? t('chat.approvalAsk'));
	// Persisting + pushing the mode to the engine lives with the page (it owns
	// the session id); the picker only reports the choice.
	function setApproval(m: string) {
		onApproval(m as ApprovalMode);
		showApproval = false;
	}

	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

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
			{#if onScreenshot}
				<IconButton onclick={onScreenshot} label="screenshot" title={t('chat.screenshotTitle')}><Camera size={16} /></IconButton>
			{/if}
			{#if onRecord}
				<button
					class="recbtn"
					class:on={recording}
					onclick={onRecord}
					aria-label="record screen"
					title={recording ? t('chat.recordStopTitle') : t('chat.recordTitle')}
				>
					{#if recording}<CircleStop size={16} />{:else}<Video size={16} />{/if}
				</button>
			{/if}
			<button
				class="recbtn"
				class:on={voice === 'rec'}
				onclick={toggleVoice}
				disabled={voice === 'busy'}
				aria-label="voice input"
				title={voice === 'rec' ? t('chat.voiceStopTitle') : voice === 'busy' ? t('chat.voiceBusyTitle') : t('chat.voiceTitle')}
			>
				{#if voice === 'busy'}<span class="vspin"><LoaderCircle size={16} /></span>{:else if voice === 'rec'}<CircleStop size={16} />{:else}<Mic size={16} />{/if}
			</button>
			{#if bcaps.modelPicker}
				<button class="flatbtn model" onclick={onModel} title={t('chat.switchModel')}>
					<Vendor model={chat.model} size={15} /><span>{chat.model || 'model'}</span>
				</button>
			{:else if chat.model}
				<span class="flatbtn model static"><Vendor model={chat.model} size={15} /><span>{chat.model}</span></span>
			{/if}
			{#if bcaps.modelPicker && chat.efforts.length}
				<div class="effortsel">
					<button class="flatbtn" onclick={() => (showEffort = !showEffort)} title={t('chat.effortTitle')}>
						{cap(chat.effort) || 'Effort'}
					</button>
					{#if showEffort}
						<button class="pop-backdrop" aria-label="close" onclick={() => (showEffort = false)}></button>
						<div class="effort-pop wide">
							<EffortSlider value={chat.effort} options={chat.efforts} onChange={(e) => { onEffort(e); showEffort = false; }} />
						</div>
					{/if}
				</div>
			{/if}
			{#if bcaps.approvalModes}
				<div class="effortsel">
					<button class="flatbtn appr" class:auto={chat.approvalMode !== 'ask'} onclick={() => (showApproval = !showApproval)} title={t('chat.approvalModeTitle')}>
						<ShieldCheck size={14} /><span>{approvalLabel}</span>
					</button>
					{#if showApproval}
						<button class="pop-backdrop" aria-label="close" onclick={() => (showApproval = false)}></button>
						<div class="effort-pop">
							<Segmented value={chat.approvalMode} options={APPROVAL} onChange={setApproval} />
						</div>
					{/if}
				</div>
			{/if}
			<div class="cspace"></div>
			{#if bcaps.contextUsage && ctxLimit > 0}
				<ContextIndicator pct={ctxPct} contextTokens={chat.contextTokens} contextLimit={ctxLimit} totalIn={chat.totalIn} totalOut={chat.totalOut} cost={chat.cost} />
			{/if}
			{#if chat.busy}
				<button class="cact stop" onclick={onStop} aria-label="stop" title={t('chat.stopTitle')}><Square size={15} /></button>
			{:else}
				<button class="cact send" onclick={onSubmit} disabled={!input.trim() && !attachments.length && !videos.length} aria-label="send" title={t('chat.sendTitle')}><Send size={16} /></button>
			{/if}
		</div>
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
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		padding: 12px 14px 10px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
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
	}
	.flatbtn:hover {
		background: var(--surface2);
	}
	.flatbtn.model span {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	/* read-only model label for backends without an in-chat model picker */
	.flatbtn.static {
		cursor: default;
	}
	.flatbtn.static:hover {
		background: none;
	}
	.flatbtn.appr span {
		font-size: 12px;
	}
	.flatbtn.appr.auto {
		color: var(--warn);
	}
	.effortsel {
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
		animation: rise 0.12s ease;
	}
	.effort-pop.wide {
		padding: 12px 14px 8px;
		border-radius: 14px;
	}
	.cspace {
		flex: 1;
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: var(--r-md);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
	}
	.cact.send {
		background: linear-gradient(145deg, var(--accent-bright), var(--accent));
		color: var(--on-accent);
		box-shadow: 0 4px 14px var(--accent-soft);
	}
	.cact.send:disabled {
		opacity: 0.4;
		box-shadow: none;
		cursor: default;
	}
	.cact.stop {
		background: var(--surface2);
		border: 1px solid var(--border);
		color: var(--err);
	}
	.recbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 7px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.recbtn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.recbtn.on {
		color: var(--err);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.recbtn:disabled {
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
		border-radius: 7px;
		padding: 3px 9px;
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
		border-radius: 7px;
		padding: 3px 9px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.qsteer:hover {
		background: var(--accent-soft);
	}
</style>
