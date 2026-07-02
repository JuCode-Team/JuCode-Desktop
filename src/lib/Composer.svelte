<script lang="ts">
	import { Send, Square, Paperclip, FastForward, ShieldCheck } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { listFiles, saveTempImage } from '$lib/protocol';
	import { buildEntries, mentionMatches, type AtEntry } from '$lib/mention';
	import { t } from '$lib/i18n';
	import SlashMenu from '$lib/composer/SlashMenu.svelte';
	import MentionMenu from '$lib/composer/MentionMenu.svelte';
	import AttachmentChips from '$lib/composer/AttachmentChips.svelte';
	import ContextIndicator from '$lib/composer/ContextIndicator.svelte';
	import type { ChatState } from '$lib/chat.svelte';

	let {
		chat,
		input = $bindable(),
		attachments = $bindable(),
		el = $bindable(),
		onSubmit,
		onStop,
		onSteer,
		onPick,
		onModel,
		onEffort
	}: {
		chat: ChatState;
		input: string;
		attachments: { path: string; image: boolean }[];
		el: HTMLTextAreaElement | null;
		onSubmit: () => void;
		onStop: () => void;
		onSteer: () => void;
		onPick: () => void;
		onModel: () => void;
		onEffort: (ef: string) => void;
	} = $props();

	let slashIdx = $state(0);
	let showEffort = $state(false);
	let showApproval = $state(false);

	const APPROVAL = $derived([
		{ value: 'ask', label: t('chat.approvalAsk') },
		{ value: 'edits', label: t('chat.approvalEdits') },
		{ value: 'all', label: t('chat.approvalAll') }
	]);
	const approvalLabel = $derived(APPROVAL.find((a) => a.value === chat.approvalMode)?.label ?? t('chat.approvalAsk'));
	function setApproval(m: string) {
		chat.approvalMode = m as 'ask' | 'edits' | 'all';
		localStorage.setItem('jucode-approval-mode', m);
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
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSubmit();
		}
	}

	// Paste an image straight from the clipboard: write it to a temp file and
	// attach the path (screenshots, copied images — no need to save to disk first).
	async function onPaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const it of items) {
			if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
			const file = it.getAsFile();
			if (!file) continue;
			e.preventDefault();
			const ext = (it.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
			try {
				const buf = new Uint8Array(await file.arrayBuffer());
				const path = await saveTempImage(buf, ext);
				if (!attachments.some((a) => a.path === path)) attachments.push({ path, image: true });
			} catch {
				/* ignore */
			}
		}
	}

	// Grow the textarea with its content (up to the CSS max-height, then scroll).
	// Tracks `input` so it also resizes on programmatic fills (slash/@/edit/rewind).
	$effect(() => {
		input;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
	});
</script>

<div class="composer-wrap">
	{#if slashMatches.length}
		<SlashMenu matches={slashMatches} selected={slashIdx} onSelect={(c) => (input = c.command + ' ')} onHover={(i) => (slashIdx = i)} />
	{:else if atQuery !== null}
		<MentionMenu matches={atMatches} query={atQuery} selected={atIdx} onSelect={applyAt} onHover={(i) => (atIdx = i)} />
	{/if}
	{#if attachments.length}
		<AttachmentChips {attachments} onRemove={(i) => attachments.splice(i, 1)} />
	{/if}
	{#if chat.pendingMessages.length}
		<div class="queued">
			<span class="queued-label">{t('chat.queuedLabel', { n: chat.pendingMessages.length })}</span>
			{#each chat.pendingMessages as q, i (i)}
				<span class="qchip" title={q}>{q}</span>
			{/each}
			<button class="qsteer" onclick={onSteer} title={t('chat.steerTitle')}><FastForward size={12} />{t('chat.steerAction')}</button>
		</div>
	{/if}
	<div class="composer">
		<textarea
			bind:this={el}
			bind:value={input}
			onkeydown={onKey}
			onpaste={onPaste}
			rows="1"
			placeholder={t('chat.composerPlaceholder')}
			role="combobox"
			aria-expanded={menuOpen}
			aria-controls="composer-menu"
			aria-autocomplete="list"
			aria-activedescendant={activeOptionId}
		></textarea>
		<div class="composer-bar">
			<IconButton onclick={onPick} label="attach" title={t('chat.attachTitle')}><Paperclip size={16} /></IconButton>
			<button class="flatbtn model" onclick={onModel} title={t('chat.switchModel')}>
				<Vendor model={chat.model} size={15} /><span>{chat.model || 'model'}</span>
			</button>
			{#if chat.efforts.length}
				<div class="effortsel">
					<button class="flatbtn" onclick={() => (showEffort = !showEffort)} title={t('chat.effortTitle')}>
						{cap(chat.effort) || 'Effort'}
					</button>
					{#if showEffort}
						<button class="pop-backdrop" aria-label="close" onclick={() => (showEffort = false)}></button>
						<div class="effort-pop">
							<Segmented value={chat.effort} options={chat.efforts.map((e) => ({ value: e, label: cap(e) }))} onChange={(e) => { onEffort(e); showEffort = false; }} />
						</div>
					{/if}
				</div>
			{/if}
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
			<div class="cspace"></div>
			{#if ctxLimit > 0}
				<ContextIndicator pct={ctxPct} contextTokens={chat.contextTokens} contextLimit={ctxLimit} totalIn={chat.totalIn} totalOut={chat.totalOut} cost={chat.cost} />
			{/if}
			{#if chat.busy}
				<button class="cact stop" onclick={onStop} aria-label="stop" title={t('chat.stopTitle')}><Square size={15} /></button>
			{:else}
				<button class="cact send" onclick={onSubmit} disabled={!input.trim() && !attachments.length} aria-label="send" title={t('chat.sendTitle')}><Send size={16} /></button>
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
	textarea {
		width: 100%;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 14px;
		line-height: 1.55;
		max-height: 180px;
		padding: 2px 0 8px;
	}
	textarea::placeholder {
		color: var(--dim2);
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
