<script lang="ts">
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import { fade, slide } from 'svelte/transition';
	import Markdown from '$lib/Markdown.svelte';
	import ToolCard from '$lib/ToolCard.svelte';
	import { parseToolOutput, toolIcon, toolTarget, toolVerb } from '$lib/toolSummary';
	import Indicator from '$lib/Indicator.svelte';
	import CallTimer from '$lib/CallTimer.svelte';
	import RetryNotice from '$lib/RetryNotice.svelte';
	import ErrorNotice from '$lib/ErrorNotice.svelte';
	import type { ErrorAction } from '$lib/errorInfo';
	import { t } from '$lib/i18n';
	import type { CallTiming, Msg, RetryState } from '$lib/chat.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { fmtDur, turnParts } from '$lib/turnStats';
	import { SvelteSet } from 'svelte/reactivity';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QuotesIcon from 'phosphor-svelte/lib/QuotesIcon';

	let {
		messages,
		streamingMsg,
		streamingReasoning,
		phase,
		call = null,
		compactionTokens = 0,
		retry = null,
		autoRetry = null,
		onAutoRetryNow,
		onAutoRetryCancel,
		findActive = null,
		scroller = null,
		onEdit,
		onCite,
		onRewind,
		onFile,
		onDismiss,
		backend = '',
		onErrorAction,
		mark = $bindable(-1)
	}: {
		messages: Msg[];
		streamingMsg: Msg | null;
		streamingReasoning: Msg | null;
		phase: string | null;
		/** The model request in flight, timed live (see CallTiming). */
		call?: CallTiming | null;
		compactionTokens?: number;
		/** A failed model request being re-sent: shown instead of the phase. */
		retry?: RetryState | null;
		/** The app's retry of a failed turn, waiting (autoRetry.ts). */
		autoRetry?: RetryState | null;
		onAutoRetryNow?: () => void;
		onAutoRetryCancel?: () => void;
		findActive?: number | null;
		// The scroll viewport (owned by +page). When provided and the history is
		// long, rows outside the viewport are windowed out.
		scroller?: HTMLElement | null;
		onEdit: (text: string) => void;
		/** Quote text selected in a reply into the composer. */
		onCite?: (text: string) => void;
		onRewind: (text: string, userIndex: number) => void;
		/** Open a workspace file referenced by a chat link (editor / browser). */
		onFile?: (href: string) => void;
		/** Remove a message the user closed (error notices). */
		onDismiss?: (m: Msg) => void;
		/** The session's engine, for reading its errors. */
		backend?: string;
		/** An error notice's fix (restart, sign in, compact …). */
		onErrorAction?: (action: ErrorAction) => void;
		/** Ordinal of the user message in view: at or above the upper third. */
		mark?: number;
	} = $props();

	// ── Virtual list (dynamic-height windowing) ─────────────────────────────
	// Only long histories are windowed; short conversations render in full so the
	// streaming/auto-scroll path is completely untouched. Heights are measured per
	// message (cached by object identity) with an estimate for not-yet-seen rows.
	const VIRTUAL_MIN = 40; // messages before windowing engages
	const EST_ROW = 120; // px estimate for an unmeasured row
	const GAP = 16; // px, matches .list gap
	const OVERSCAN = 800; // px rendered beyond the viewport on each side

	const heights = new Map<Msg, number>();
	let measureVersion = $state(0);
	let scrollTop = $state(0);
	let viewH = $state(0);
	let atEnd = $state(true);
	// The list's top within the scroller's content (the scroller's padding).
	let listTop = $state(0);
	let listEl: HTMLElement;
	let raf = 0;

	// Track the viewport's scroll position + height.
	$effect(() => {
		const el = scroller;
		if (!el) return;
		const sync = () => {
			scrollTop = el.scrollTop;
			viewH = el.clientHeight;
			atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
			cite = null;
			listTop = listEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
		};
		sync();
		el.addEventListener('scroll', sync, { passive: true });
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', sync);
			ro.disconnect();
		};
	});

	const virtual = $derived(!!scroller && messages.length >= VIRTUAL_MIN);

	// Cumulative top offset of each row (offsets[i] = top of row i, offsets[n] = end).
	const offsets = $derived.by(() => {
		measureVersion; // recompute when a measurement lands
		const offs = new Array(messages.length + 1);
		offs[0] = 0;
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			// Unshown placeholders occupy no row (and no gap).
			const h = shown(m) ? (heights.get(m) ?? EST_ROW) + GAP : 0;
			offs[i + 1] = offs[i] + h;
		}
		return offs;
	});
	const totalH = $derived(offsets[messages.length] ?? 0);

	// [first, last] inclusive window of rows to render.
	const range = $derived.by(() => {
		if (!virtual) return { first: 0, last: messages.length - 1 };
		const top = scrollTop - OVERSCAN;
		const bottom = scrollTop + viewH + OVERSCAN;
		let first = 0;
		while (first < messages.length && offsets[first + 1] < top) first++;
		let last = first;
		while (last < messages.length - 1 && offsets[last] < bottom) last++;
		return { first, last };
	});
	const windowRows = $derived(messages.slice(range.first, range.last + 1));
	const padTop = $derived(virtual ? offsets[range.first] : 0);
	const padBottom = $derived(virtual ? Math.max(0, totalH - offsets[range.last + 1]) : 0);

	// Measure a rendered row and cache its height, coalescing recomputes into one rAF.
	function measure(node: HTMLElement, msg: Msg) {
		const record = () => {
			const h = node.offsetHeight;
			if (h > 0 && heights.get(msg) !== h) {
				heights.set(msg, h);
				if (!raf)
					raf = requestAnimationFrame(() => {
						raf = 0;
						measureVersion++;
					});
			}
		};
		record();
		const ro = new ResizeObserver(record);
		ro.observe(node);
		return {
			update(next: Msg) {
				msg = next;
				record();
			},
			destroy() {
				ro.disconnect();
			}
		};
	}

	// Scroll the current find hit into view. Under windowing the row may be unrendered,
	// so scroll the viewport to the row's computed offset (which brings it into range).
	$effect(() => {
		if (findActive == null) return;
		if (virtual && scroller) {
			scroller.scrollTo({ top: Math.max(0, offsets[findActive] - viewH / 2), behavior: 'smooth' });
		} else {
			rowEls[findActive]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	});
	let rowEls: (HTMLElement | null)[] = [];

	// Index in `messages` of each user message, in order: the rail's marks.
	const markRows = $derived(messages.flatMap((m, i) => (m.kind === 'user' ? [i] : [])));
	$effect(() => {
		const rows = markRows;
		if (atEnd) {
			mark = rows.length - 1;
			return;
		}
		const line = scrollTop + viewH / 3 - listTop;
		let n = 0;
		while (n + 1 < rows.length && offsets[rows[n + 1]!]! <= line) n++;
		mark = rows.length ? n : -1;
	});

	/** Scroll mark `n`'s message to the top of the viewport. */
	export function jumpToMark(n: number) {
		const i = markRows[n];
		if (i === undefined || !scroller) return;
		const el = scroller;
		const alignRow = (behavior: ScrollBehavior) => {
			const row = rowEls[i];
			if (!row?.isConnected) return false;
			const top = el.scrollTop + row.getBoundingClientRect().top - el.getBoundingClientRect().top - 16;
			el.scrollTo({ top, behavior });
			return true;
		};
		if (alignRow('smooth')) return;
		// Windowed out: go to its estimated offset, which renders it, then align
		// on the real row once it has been measured.
		el.scrollTo({ top: listTop + offsets[i]! - 16 });
		requestAnimationFrame(() => requestAnimationFrame(() => alignRow('auto')));
	}

	// Map each user message to its 0-based ordinal so a rewind can target the
	// matching engine turn (the engine lists user turns in the same order).
	const userOrdinal = $derived.by(() => {
		const map = new Map<Msg, number>();
		let n = 0;
		for (const m of messages) if (m.kind === 'user') map.set(m, n++);
		return map;
	});

	// Selecting text inside one reply (or its reasoning) offers to quote it.
	let cite = $state<{ text: string; x: number; top: number; bottom: number } | null>(null);
	function offerCite() {
		const sel = window.getSelection();
		const text = sel?.toString().trim();
		if (!onCite || !sel || sel.isCollapsed || !text) return;
		const range = sel.getRangeAt(0);
		const node = range.commonAncestorContainer;
		const host = (node instanceof Element ? node : node.parentElement)?.closest('.answer, .reason-body');
		if (!host || !listEl.contains(host)) return;
		const r = range.getBoundingClientRect();
		cite = { text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
	}
	function takeCite() {
		if (!cite) return;
		onCite?.(cite.text);
		window.getSelection()?.removeAllRanges();
		cite = null;
	}

	let copied = $state<unknown>(null);
	function copy(text: string, m: unknown) {
		navigator.clipboard?.writeText(text).catch(() => {});
		copied = m;
		setTimeout(() => {
			if (copied === m) copied = null;
		}, 1500);
	}

	// A sent message's state shows on its bubble; the bottom indicator would
	// say the same thing ("connecting"), so it stays quiet meanwhile.
	const sendingShown = $derived.by(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]!;
			if (m.kind === 'user') return !!m.state && m.state !== 'failed';
		}
		return false;
	});
	const shownPhase = $derived(sendingShown && (phase === 'connecting' || phase === 'waiting') ? null : phase);

	// Smoothing buffer: SSE deltas arrive in big bursts every few seconds, which
	// reads as jerky chunk-by-chunk output. Reveal the received text at an adaptive
	// pace so it flows continuously. `shown` chases the active message's length with
	// a proportional controller (speed grows with backlog, floored so it never
	// stalls while content is pending), integrated over real time.
	const REVEAL_TAU = 0.5; // s — backlog time constant (higher = smoother, more lag)
	const MIN_CPS = 60; // chars/s floor while streaming
	let shownChars = $state(0);
	let smoothing: Msg | null = null;
	const active = $derived<Msg | null>(streamingMsg ?? streamingReasoning);
	const textOf = (m: Msg | null) => (m && 'text' in m ? m.text : '');

	$effect(() => {
		if (!active) {
			shownChars = 0;
			smoothing = null;
			return;
		}
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const cur = streamingMsg ?? streamingReasoning;
			if (!cur) return;
			if (cur !== smoothing) {
				smoothing = cur;
				shownChars = 0;
				last = now;
			}
			const len = textOf(cur).length;
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			const pending = len - shownChars;
			if (pending > 0) {
				const cps = Math.max(MIN_CPS, pending / REVEAL_TAU);
				shownChars = Math.min(len, shownChars + cps * dt);
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// Text to show for a message — smoothed slice for the one currently streaming.
	function revealed(m: Msg): string {
		return m === active ? textOf(m).slice(0, Math.floor(shownChars)) : textOf(m);
	}

	// Incremental streaming markdown: render completed blocks as markdown (memoized
	// by the slice, so it only re-parses when a block finalizes) and the in-progress
	// tail block as plain text. Per-token cost tracks the current block, not the
	// whole message. The split never lands inside an open code fence.
	//
	// Fences are matched anchored to line starts per CommonMark (optional ≤3 spaces,
	// then 3+ backticks or tildes). Counting every "```" occurrence — as before —
	// miscounts inline code spans and 4-backtick fences, splitting the block wrongly
	// mid-stream.
	const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/gm;
	function splitIdx(text: string): number {
		const fences = text.match(FENCE_RE);
		if (fences && fences.length % 2 === 1) {
			// Inside an open fence: keep the whole open block in the plain-text tail
			// so it isn't parsed as a finalized (broken) code block. Split at the
			// start of the last fence line.
			let idx = 0;
			const re = new RegExp(FENCE_RE.source, 'gm');
			for (let m = re.exec(text); m; m = re.exec(text)) idx = m.index;
			return idx;
		}
		const i = text.lastIndexOf('\n\n');
		return i < 0 ? 0 : i + 2;
	}

	// A user message's text split into runs of "> " quote lines (quoted
	// passages, shown as quotes) and the text between.
	function userBlocks(text: string): { text: string; quote: boolean }[] {
		const out: { text: string; quote: boolean }[] = [];
		for (const line of text.split('\n')) {
			const quote = /^>( |$)/.test(line);
			const last = out[out.length - 1];
			const body = quote ? line.replace(/^> ?/, '') : line;
			if (last?.quote === quote) last.text += `\n${body}`;
			else out.push({ text: body, quote });
		}
		// The blank lines around a quote are its spacing, not text.
		return out.map((b) => (b.quote ? b : { ...b, text: b.text.replace(/^\n+|\n+$/g, '') })).filter((b) => b.text);
	}

	// A user message's text with its [图片 #N] placeholders split out.
	function userSegments(text: string): { text: string; image?: string }[] {
		const out: { text: string; image?: string }[] = [];
		let last = 0;
		for (const m of text.matchAll(/\[图片 #(\d+)\]/g)) {
			if (m.index > last) out.push({ text: text.slice(last, m.index) });
			out.push({ text: m[0], image: m[1] });
			last = m.index + m[0].length;
		}
		if (last < text.length) out.push({ text: text.slice(last) });
		return out;
	}

	// Skip empty placeholders (e.g. an assistant message before its first delta).
	function hasContent(m: Msg): boolean {
		// Meta/status notices render in the collapsible status strip, not inline.
		if (m.kind === 'system') return false;
		if (m.kind === 'tool') return !!(m.name || m.output);
		return !!m.text && m.text.trim().length > 0;
	}

	// A run of consecutive tool calls (rows that show nothing don't break it)
	// renders as one row on its first call: a header naming the count and the
	// latest call, then — expanded — the calls in a tight list. The other calls
	// of the run render no row of their own.
	const GROUP_MIN = 2;
	const toolGroups = $derived.by(() => {
		const members = new Map<Msg, Msg[]>(); // first call → the run
		const headOf = new Map<Msg, Msg>();
		let run: Msg[] = [];
		const flush = () => {
			if (run.length >= GROUP_MIN) {
				members.set(run[0]!, run);
				for (const x of run) headOf.set(x, run[0]!);
			}
			run = [];
		};
		for (const m of messages) {
			if (!hasContent(m)) continue;
			if (m.kind === 'tool') run.push(m);
			else flush();
		}
		flush();
		return { members, headOf };
	});
	const openGroups = new SvelteSet<Msg>();
	function shown(m: Msg): boolean {
		return hasContent(m) && (!toolGroups.headOf.has(m) || toolGroups.members.has(m));
	}
	function groupInfo(run: Msg[]) {
		let running = false;
		let failed = 0;
		for (const x of run) {
			if (x.kind !== 'tool') continue;
			if (x.running) running = true;
			if (x.isError) failed++;
		}
		const last = run[run.length - 1];
		const latest =
			last?.kind === 'tool'
				? { Icon: toolIcon(last.name), verb: toolVerb(last.name), target: toolTarget(last.name, parseToolOutput(last.output)) }
				: null;
		return { running, failed, latest };
	}
</script>

<svelte:document onselectionchange={() => cite && window.getSelection()?.isCollapsed && (cite = null)} />

<div class="list" bind:this={listEl} onmouseup={() => setTimeout(offerCite)} role="presentation" style:padding-top="{padTop}px" style:padding-bottom="{padBottom}px">
	{#each windowRows as m, k (m)}
		{@const i = range.first + k}
		{#if shown(m)}
			<div class="mwrap" class:animate={!virtual} class:hit={i === findActive} bind:this={rowEls[i]} use:measure={m}>
				{#if m.kind === 'user'}
			{@const drop = userOrdinal.size - (userOrdinal.get(m) ?? 0)}
			<div class="row user">
				<button class="uedit rewind" onclick={() => onRewind(m.text, userOrdinal.get(m) ?? 0)} aria-label="rewind" title={t('chat.rewindTitleN', { n: drop })}>
					<ArrowCounterClockwiseIcon size={12} />{#if drop > 1}<span class="rwn">{drop}</span>{/if}
				</button>
				<button class="uedit" onclick={() => onEdit(m.text)} aria-label="quote" title={t('chat.quoteTitle')}><PencilSimpleIcon size={12} /></button>
				<div class="ucol">
					<!-- One line: the bubble is pre-wrap, so template whitespace would show. -->
					<div class="bubble" class:pending={m.state === 'sending'}>{#if m.images?.length}<div class="uimgs">{#each m.images as p (p)}<img src={convertFileSrc(p)} alt="" />{/each}</div>{/if}{#each userBlocks(m.text) as block, b (b)}{#if block.quote}<span class="uquote">{block.text}</span>{:else}<span class="utext">{#each userSegments(block.text) as seg, j (j)}{#if seg.image}<span class="utoken">{t('chat.imageToken', { n: seg.image })}</span>{:else}{seg.text}{/if}{/each}</span>{/if}{/each}</div>
					{#if m.state}
						{#key m.state}
							<div class="sendstate {m.state}" in:fade={{ duration: 160 }}>
								{#if m.state === 'failed'}<WarningCircleIcon size={13} />{:else}<span class="sdot"></span>{/if}
								<span>{t(`chat.send.${m.state}`)}</span>
								{#if call && (m.state === 'connecting' || m.state === 'waiting')}<CallTimer since={call.since} />{/if}
							</div>
						{/key}
					{/if}
				</div>
			</div>
		{:else if m.kind === 'assistant'}
			<div class="answer">
				{#if m === streamingMsg}
					{@const rt = revealed(m)}
					{@const si = splitIdx(rt)}
					{#if si > 0}<Markdown text={rt.slice(0, si)} />{/if}
					<div class="stream">{rt.slice(si)}</div>
				{:else}
					<Markdown text={m.text} {onFile} />
					<div class="foot">
						<!-- A turn of one segment: its time is the turn's. -->
						{#if m.segMs !== undefined && (m.turn?.segments ?? 2) > 1}
							<span class="stat mono" title={t('chat.stat.segment')}>{t('chat.stat.segShort', { t: fmtDur(m.segMs) })}</span>
						{/if}
						{#if m.turn}
							{#each turnParts(m.turn, prefs.turnStats) as part, j (j)}
								<span class="stat" class:mono={part.mono} title={part.title}>{part.text}</span>
							{/each}
						{:else if m.elapsed}
							<span class="mono">{fmtDur(m.elapsed)}</span>
							{#if m.tokens}<span class="mono">{t('chat.tokens', { n: m.tokens })}</span>{/if}
						{/if}
						<button class="copy" onclick={() => copy(m.text, m)} aria-label="copy">
							{#if copied === m}<CheckIcon size={13} /> {t('common.copied')}{:else}<CopyIcon size={13} /> {t('common.copy')}{/if}
						</button>
					</div>
				{/if}
			</div>
		{:else if m.kind === 'reasoning'}
			<div class="reason" class:open={!m.collapsed}>
				<button class="reason-head" onclick={() => (m.collapsed = !m.collapsed)}>
					<span>{t('chat.reasoning')}</span>
					<span class="rchev"><CaretRightIcon size={13} /></span>
				</button>
				{#if !m.collapsed}
					<div class="reason-body" transition:slide={{ duration: 180 }}>
						{#if m === streamingReasoning}
							<!-- Reasoning summaries are markdown (OpenAI's open with a
							     **bold** title): completed blocks parse once, the short
							     tail block re-parses as it grows. -->
							{@const rt = revealed(m)}
							{@const si = splitIdx(rt)}
							{#if si > 0}<Markdown text={rt.slice(0, si)} />{/if}
							<Markdown text={rt.slice(si)} />
						{:else}
							<Markdown text={m.text} {onFile} />
						{/if}
					</div>
				{/if}
			</div>
		{:else if m.kind === 'tool'}
			{@const run = toolGroups.members.get(m)}
			{#if run}
				{@const g = groupInfo(run)}
				{@const open = openGroups.has(m)}
				<button class="tgroup" class:open onclick={() => (open ? openGroups.delete(m) : openGroups.add(m))}>
					<span class="tg-count">{t('chat.toolGroup', { n: run.length })}</span>
					{#if g.failed}<span class="tg-fail">{t('chat.toolGroupFailed', { n: g.failed })}</span>{/if}
					{#if g.latest && !open}
						<span class="tg-latest">
							<g.latest.Icon size={13} />
							<span class="tg-verb">{g.latest.verb}</span>
							{#if g.latest.target}<span class="tg-target">{g.latest.target}</span>{/if}
						</span>
					{/if}
					{#if g.running}<CircleNotchIcon size={12} class="spin" />{/if}
					<span class="rchev"><CaretRightIcon size={13} /></span>
				</button>
				{#if open}
					<div class="tg-list">
						{#each run as x (x)}
							{#if x.kind === 'tool'}<ToolCard name={x.name} output={x.output} running={x.running} isError={x.isError} />{/if}
						{/each}
					</div>
				{/if}
			{:else}
				<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} />
			{/if}
		{:else if m.kind === 'error'}
			<ErrorNotice text={m.text} {backend} onAction={onErrorAction} onDismiss={onDismiss ? () => onDismiss(m) : undefined} />
				{/if}
			</div>
		{/if}
	{/each}
	{#if retry}
		<RetryNotice {retry} {backend} />
	{:else if autoRetry}
		<RetryNotice retry={autoRetry} {backend} onNow={onAutoRetryNow} onCancel={onAutoRetryCancel} />
	{:else}
		<Indicator phase={shownPhase} tokens={compactionTokens} {call} />
	{/if}
</div>
{#if cite}
	{@const below = cite.top < 60}
	<!-- mousedown would clear the selection before the click lands. -->
	<button
		class="cite"
		class:below
		style:left="{cite.x}px"
		style:top="{below ? cite.bottom + 8 : cite.top - 8}px"
		onmousedown={(e) => e.preventDefault()}
		onclick={takeCite}
	>
		<QuotesIcon size={13} />{t('chat.cite')}
	</button>
{/if}

<style>
	.cite {
		position: fixed;
		z-index: 300;
		transform: translate(-50%, -100%);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
		animation: cite-in var(--t-fast) var(--ease-out);
		transition: background var(--t-fast) var(--ease-out);
	}
	.cite.below {
		transform: translateX(-50%);
	}
	.cite:hover {
		background: var(--surface2);
	}
	@keyframes cite-in {
		from {
			opacity: 0;
		}
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	/* Never let a flex column squeeze an item below its content height — that
	   collapses tool cards into stray horizontal lines under content pressure. */
	.list > :global(*) {
		flex-shrink: 0;
	}
	.mwrap {
		border-radius: var(--r-md);
		transition: background var(--t-slow) var(--ease-out), box-shadow var(--t-slow) var(--ease-out);
	}
	/* New rows rise in; suppressed under windowing so re-entering rows don't replay. */
	.mwrap.animate {
		animation: rise var(--t-slow) var(--ease-out) both;
	}
	.mwrap.hit {
		background: var(--accent-soft);
		box-shadow: 0 0 0 6px var(--accent-soft);
	}
	.row {
		display: flex;
	}
	.row.user {
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
	}
	.uedit {
		opacity: 0;
		transform: translateX(4px);
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: var(--r-sm);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			opacity var(--t-med) var(--ease-out),
			transform var(--t-med) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.row.user:hover .uedit,
	.uedit:focus-visible {
		opacity: 1;
		transform: translateX(0);
	}
	.uedit:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.uedit:active {
		transform: scale(0.9);
	}
	.uedit.rewind {
		gap: 2px;
		align-items: center;
	}
	.rwn {
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.ucol {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		max-width: 78%;
		min-width: 0;
	}
	.bubble.pending {
		opacity: 0.7;
	}
	.sendstate {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding-right: 6px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.sendstate.failed {
		color: var(--err, var(--warn));
	}
	.sdot {
		position: relative;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--dim);
	}
	/* sending: the dot breathes; connecting: it sends out rings (the handshake
	   with the gateway); waiting: steady, connected. */
	.sending .sdot {
		animation: sbreathe 1.2s ease-in-out infinite;
	}
	.connecting .sdot {
		background: var(--accent-bright);
	}
	.connecting .sdot::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1.5px solid var(--accent-bright);
		animation: sring 1.3s ease-out infinite;
	}
	.waiting .sdot {
		background: var(--accent-bright);
	}
	@keyframes sbreathe {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
	@keyframes sring {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		100% {
			transform: scale(2.8);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sdot,
		.sdot::after {
			animation: none !important;
		}
	}
	.stat + .stat::before {
		content: '·';
		margin-right: 10px;
		opacity: 0.6;
	}
	.foot .stat + .stat {
		margin-left: -2px;
	}
	.bubble {
		background: var(--surface2);
		border-radius: var(--r-xl);
		padding: 11px 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 100%;
	}
	.uimgs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.uimgs img {
		max-width: 220px;
		max-height: 160px;
		border-radius: var(--r-md);
		object-fit: cover;
		display: block;
	}
	.uquote,
	.utext {
		display: block;
	}
	.uquote {
		position: relative;
		padding: 5px 10px 5px 29px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--text) 5%, transparent);
		color: var(--dim);
	}
	.uquote::before {
		content: '';
		position: absolute;
		left: 10px;
		top: calc(5px + 0.8em - 6px);
		width: 12px;
		height: 12px;
		background: var(--dim2);
		mask: var(--quote-mask) center / contain no-repeat;
	}
	.uquote + .utext,
	.utext + .uquote,
	.uquote + .uquote {
		margin-top: 8px;
	}
	.utoken {
		padding: 0 5px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	.answer {
		line-height: 1.65;
		word-break: break-word;
	}
	.stream {
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.65;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.copy {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: none;
		background: none;
		color: var(--dim2);
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--r-sm);
		font-size: var(--fs-2xs);
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
	}
	.copy:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.copy:active {
		transform: scale(0.94);
	}
	.reason {
		border-left: 2px solid var(--hairline);
		padding-left: 12px;
	}
	.reason-head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.reason-head {
		transition: color var(--t-fast) var(--ease-out);
	}
	.reason-head:hover {
		color: var(--text);
	}
	.rchev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-spring);
	}
	.reason.open .rchev,
	.tgroup.open .rchev {
		transform: rotate(90deg);
	}
	.tgroup {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		min-height: 26px;
		text-align: left;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		font-weight: 500;
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.tgroup:hover {
		color: var(--text);
	}
	.tg-count {
		flex-shrink: 0;
	}
	/* The latest call, in the card's own format, trailing the count. */
	.tg-latest {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding-left: 8px;
		border-left: 1px solid var(--border);
		color: var(--dim2);
		font-weight: 400;
	}
	.tg-latest :global(svg) {
		flex-shrink: 0;
	}
	.tg-verb {
		flex-shrink: 0;
	}
	.tg-target {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.tgroup .rchev,
	.tgroup :global(.spin) {
		flex-shrink: 0;
	}
	.tg-fail {
		font-size: var(--fs-2xs);
		font-weight: 400;
		color: var(--err);
	}
	/* The group's calls hang under its header behind a hairline rule. */
	.tg-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 6px 0 0 6px;
		padding-left: 12px;
		border-left: 1px solid var(--border);
	}
	.reason-body {
		margin-top: 4px;
		color: var(--dim);
		font-style: italic;
		font-size: var(--fs-sm);
		line-height: 1.6;
		word-break: break-word;
	}
</style>
