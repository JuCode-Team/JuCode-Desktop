<script lang="ts">
	import { Send, Square, Paperclip, X, FileText, FastForward, File, Folder, ShieldCheck } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import Vendor from '$lib/Vendor.svelte';
	import ContextRing from '$lib/ContextRing.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { listFiles, saveTempImage } from '$lib/protocol';
	import { buildEntries, mentionMatches, type AtEntry } from '$lib/mention';
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

	const APPROVAL = [
		{ value: 'ask', label: '谨慎' },
		{ value: 'edits', label: '自动改文件' },
		{ value: 'all', label: '全自动' }
	];
	const approvalLabel = $derived(APPROVAL.find((a) => a.value === chat.approvalMode)?.label ?? '谨慎');
	function setApproval(m: string) {
		chat.approvalMode = m as 'ask' | 'edits' | 'all';
		localStorage.setItem('jucode-approval-mode', m);
		showApproval = false;
	}

	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
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
	// keeps drilling into their contents.
	function applyAt(entry: AtEntry) {
		const suffix = entry.dir ? '/' : ' ';
		input = input.replace(/(?:^|\s)@([^\s@]*)$/, (full) => {
			const lead = /^\s/.test(full) ? full[0] : '';
			return `${lead}@${entry.path}${suffix}`;
		});
	}

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
		<div class="slash">
			{#each slashMatches as c, i (c.command)}
				<button class="slash-item" class:sel={i === slashIdx} onclick={() => (input = c.command + ' ')} onmouseenter={() => (slashIdx = i)}>
					<span class="slash-cmd">{c.command}</span>
					{#if c.args}<span class="slash-args">{c.args}</span>{/if}
					{#if c.description}<span class="slash-desc">{c.description}</span>{/if}
					{#if c.marker}<span class="slash-marker">{c.marker}</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
	{#if atMatches.length}
		<div class="slash">
			{#each atMatches as e, i (e.path)}
				<button class="slash-item" class:sel={i === atIdx} onclick={() => applyAt(e)} onmouseenter={() => (atIdx = i)}>
					{#if e.dir}<Folder size={13} class="atfolder" />{:else}<File size={13} />{/if}
					<span class="at-name">{base(e.path)}{#if e.dir}/{/if}</span>
					<span class="at-path">{e.path}</span>
				</button>
			{/each}
		</div>
	{/if}
	{#if attachments.length}
		<div class="chips">
			{#each attachments as a, i (a.path)}
				<span class="chip" class:imgchip={a.image}>
					{#if a.image}<img class="chip-thumb" src={convertFileSrc(a.path)} alt="" />{:else}<FileText size={12} />{/if}
					<span class="chip-name">{base(a.path)}</span>
					<IconButton size="xs" onclick={() => attachments.splice(i, 1)} label="remove"><X size={12} /></IconButton>
				</span>
			{/each}
		</div>
	{/if}
	{#if chat.pendingMessages.length}
		<div class="queued">
			<span class="queued-label">排队 {chat.pendingMessages.length}</span>
			{#each chat.pendingMessages as q, i (i)}
				<span class="qchip" title={q}>{q}</span>
			{/each}
			<button class="qsteer" onclick={onSteer} title="打断当前回合，立即执行队首消息"><FastForward size={12} />插队执行</button>
		</div>
	{/if}
	<div class="composer">
		<textarea bind:this={el} bind:value={input} onkeydown={onKey} onpaste={onPaste} rows="1" placeholder="给 JuCode 指派一个任务…  (拖入/粘贴图片 · 回形针附加文件 · / 唤起命令)"></textarea>
		<div class="composer-bar">
			<IconButton onclick={onPick} label="attach" title="附加文件"><Paperclip size={16} /></IconButton>
			<button class="flatbtn model" onclick={onModel} title="切换模型">
				<Vendor model={chat.model} size={15} /><span>{chat.model || 'model'}</span>
			</button>
			{#if chat.efforts.length}
				<div class="effortsel">
					<button class="flatbtn" onclick={() => (showEffort = !showEffort)} title="思考强度">
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
				<button class="flatbtn appr" class:auto={chat.approvalMode !== 'ask'} onclick={() => (showApproval = !showApproval)} title="工具审批模式">
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
				<div class="ctxwrap">
					<ContextRing pct={ctxPct} label="" />
					<div class="ctx-pop">
						<div class="ctx-row"><span>上下文</span><span class="ctx-val">{fmtTokens(chat.contextTokens)} / {fmtTokens(ctxLimit)}</span></div>
						<div class="ctx-bar"><span class="ctx-fill" class:warn={ctxPct >= 85} style:width="{ctxPct}%"></span></div>
						<div class="ctx-sub">{ctxPct}% · 到压缩点</div>
						{#if chat.totalIn || chat.totalOut}<div class="ctx-row mt"><span>本会话用量</span><span class="ctx-val">↑{fmtTokens(chat.totalIn)} ↓{fmtTokens(chat.totalOut)}</span></div>{/if}
						{#if chat.cost > 0}<div class="ctx-row"><span>成本</span><span class="ctx-val">${chat.cost.toFixed(3)}</span></div>{/if}
					</div>
				</div>
			{/if}
			{#if chat.busy}
				<button class="cact stop" onclick={onStop} aria-label="stop" title="停止"><Square size={15} /></button>
			{:else}
				<button class="cact send" onclick={onSubmit} disabled={!input.trim() && !attachments.length} aria-label="send" title="发送"><Send size={16} /></button>
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
	.ctxwrap {
		position: relative;
		display: inline-flex;
	}
	.ctx-pop {
		position: absolute;
		bottom: calc(100% + 10px);
		right: 0;
		z-index: 21;
		width: 200px;
		padding: 11px 12px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		opacity: 0;
		transform: translateY(4px);
		pointer-events: none;
		transition: opacity 0.13s, transform 0.13s;
	}
	.ctxwrap:hover .ctx-pop {
		opacity: 1;
		transform: translateY(0);
	}
	.ctx-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
		color: var(--dim);
	}
	.ctx-row.mt {
		margin-top: 9px;
	}
	.ctx-val {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.ctx-bar {
		height: 5px;
		border-radius: 999px;
		background: var(--surface2);
		overflow: hidden;
		margin: 7px 0 4px;
	}
	.ctx-fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--accent);
	}
	.ctx-fill.warn {
		background: var(--warn);
	}
	.ctx-sub {
		font-size: 11px;
		color: var(--dim2);
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

	.slash {
		margin-bottom: 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		overflow: hidden;
		box-shadow: var(--shadow-pop);
	}
	.slash-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.slash-item.sel {
		background: var(--surface2);
	}
	.slash-cmd {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.slash-args {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.slash-desc {
		flex: 1;
		color: var(--dim);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.slash-marker {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--accent-bright);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.at-name {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	:global(.atfolder) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.at-path {
		flex: 1;
		color: var(--dim2);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: right;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-family: var(--font-mono);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 3px 5px 3px 8px;
		max-width: 200px;
	}
	.chip.imgchip {
		padding: 3px 5px 3px 3px;
	}
	.chip-thumb {
		width: 26px;
		height: 26px;
		border-radius: 4px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.chip-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
