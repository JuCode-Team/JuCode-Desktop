<script lang="ts">
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { flushSync, tick, untrack, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import Markdown from '$lib/Markdown.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import ToolGroup from '$lib/ToolGroup.svelte';
	import SubagentCard from '$lib/agents/SubagentCard.svelte';
	import PlanCard, { type PlanAction } from '$lib/PlanCard.svelte';
	import type { ApprovalMode } from '$lib/approval';
	import { agentOfCall, SPAWN_TOOLS, WAIT_TOOLS, type AgentRow } from '$lib/agentProgress';
	import DeliveryNotice from '$lib/DeliveryNotice.svelte';
	import { parseDelivery } from '$lib/delivery';
	import { stableBlocks } from '$lib/streamBlocks';
	import { splitMentions } from '$lib/fileMention';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import { turnFolds, type TurnFold } from '$lib/turnFold';
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
	import UserImage from '$lib/UserImage.svelte';
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import ListPlusIcon from '@lucide/svelte/icons/list-plus';

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
		onNote,
		onRewind,
		onFile,
		onDismiss,
		backend = '',
		onErrorAction,
		traceOf,
		agents,
		onOpenAgent,
		onPlan,
		onOpenPlan,
		planMode = 'edits',
		loadImage,
		busy = false,
		foldTurns = false,
		tail,
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
		/** Notes the selected passage as a requirement (offered beside quoting). */
		onNote?: (text: string) => void;
		onRewind: (text: string, userIndex: number) => void;
		/** Open a workspace file referenced by a chat link (editor / browser). */
		onFile?: (href: string) => void;
		/** Remove a message the user closed (error notices). */
		onDismiss?: (m: Msg) => void;
		/** The session's engine, for reading its errors. */
		backend?: string;
		/** An error notice's fix (restart, sign in, compact …). */
		onErrorAction?: (action: ErrorAction) => void;
		/** A tool call whose run the agent trace shows (claude's Agent / Workflow). */
		traceOf?: (m: Msg) => { label: string; run: () => void } | null;
		/** The conversation's subagents: spawn and wait calls render as their
		 *  cards (absent: plain tool rows). */
		agents?: AgentRow[];
		/** Shows a subagent's own conversation. */
		onOpenAgent?: (row: AgentRow) => void;
		/** Approves or revises a proposed plan (absent: plans have no actions). */
		onPlan?: (id: string, action: PlanAction) => void;
		/** The mode a plan's approval offers first. */
		/** Shows a plan in its page beside the chat. */
		onOpenPlan?: (id: string) => void;
		planMode?: ApprovalMode;
		/** Reads a sent image where the desktop can't open its path (the remote page). */
		loadImage?: (path: string) => Promise<string>;
		/** Ordinal of the user message in view: at or above the upper third. */
		mark?: number;
		/** A turn is running: the last turn stays unfolded. */
		busy?: boolean;
		/** Finished turns fold their work into one line (turnFold.ts). */
		foldTurns?: boolean;
		/** Shown after the last message (the background tasks entry). */
		tail?: Snippet;
	} = $props();

	// ── Rendered rows ────────────────────────────────────────────────────────
	// The rows from `start` to the end are in the page. A rendered row stays
	// while the reader is away from the end, so scrolling never swaps rows in
	// or out under the view: the scroll is the browser's alone, with no
	// guessed heights to correct. Older rows join above in batches before the
	// reader reaches them; the browser's scroll anchoring keeps the view
	// still (where it has none, the position moves by the height they add).
	// Back at the end, rows far above are let go again, so a long
	// conversation stays light while a reply streams.
	const KEEP = 120; // messages rendered at the end
	const BATCH = 20; // messages added above at a time
	const AHEAD = 3; // viewports of rendered room kept above the view
	const TRIM_MS = 1500; // at the end this long before rows above are let go
	const nativeAnchor = typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto');

	let start = $state(0);
	let listEl: HTMLElement;
	let rowEls: (HTMLElement | null)[] = [];
	// Messages arriving one or two at a time after the list is shown come
	// in with an entrance; a conversation loading, a replay or older rows
	// joining above do not.
	const arriving = new WeakSet<Msg>();
	let shownList: Msg[] | null = null;
	let shownCount = -1;
	$effect.pre(() => {
		const list = messages;
		const n = list.length;
		// Driven by the list and its length only.
		untrack(() => {
			if (list !== shownList) {
				// Another list (a replay, a closed notice): keep the first rendered
				// row if it is still there, else start near the end.
				const kept = shownList?.[start];
				const at = kept ? list.indexOf(kept) : -1;
				start = at >= 0 ? at : Math.max(0, n - KEEP);
				shownList = list;
			} else if (shownCount >= 0 && n > shownCount && n - shownCount <= 2) {
				for (let i = shownCount; i < n; i++) arriving.add(list[i]!);
			}
			if (start > n) start = Math.max(0, n - KEEP);
			shownCount = n;
		});
	});

	/** Render older rows down to `to`, keeping the view where it is. */
	function extend(to: number) {
		to = Math.max(0, to);
		if (to >= start) return;
		const el = scroller;
		const height = el?.scrollHeight ?? 0;
		const top = el?.scrollTop ?? 0;
		start = to;
		flushSync();
		if (el && !nativeAnchor) el.scrollTop = top + el.scrollHeight - height;
	}

	// One pass per frame while scrolling: add rows above before the reader
	// gets there, follow the user message in view for the rail, and let
	// rows far above go once the reader has stayed at the end.
	let atEnd = $state(true);
	let frame = 0;
	let trimTimer: ReturnType<typeof setTimeout> | undefined;
	function onScrollFrame() {
		frame = 0;
		const el = scroller;
		if (!el || !listEl) return;
		const viewH = el.clientHeight;
		// How far the rendered rows reach above the view.
		const above = el.getBoundingClientRect().top - listEl.getBoundingClientRect().top;
		if (start > 0 && above < AHEAD * viewH) extend(start - BATCH);
		atEnd = el.scrollHeight - el.scrollTop - viewH < 8;
		updateMark();
		// Following a reply scrolls every frame: count from reaching the end,
		// not from the last scroll.
		if (!atEnd) {
			clearTimeout(trimTimer);
			trimTimer = undefined;
		} else if (!trimTimer && start < messages.length - KEEP - BATCH) trimTimer = setTimeout(trim, TRIM_MS);
	}
	function trim() {
		trimTimer = undefined;
		if (atEnd) start = Math.max(start, messages.length - KEEP);
	}
	$effect(() => {
		const el = scroller;
		if (!el) return;
		const onScroll = () => {
			if (cite) cite = null;
			if (!frame) frame = requestAnimationFrame(onScrollFrame);
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		// The view's height or the content changing (a reply growing, a row
		// folding) can leave too little rendered above, or move the rail's mark.
		const ro = new ResizeObserver(onScroll);
		ro.observe(el);
		ro.observe(listEl);
		onScroll();
		return () => {
			el.removeEventListener('scroll', onScroll);
			ro.disconnect();
			cancelAnimationFrame(frame);
			frame = 0;
			clearTimeout(trimTimer);
		};
	});

	// Scroll the current find hit into view (rendering down to it first).
	// A hit inside a folded turn opens it.
	$effect(() => {
		if (findActive == null) return;
		const i = findActive;
		const fold = folds.of.get(messages[i]!);
		untrack(() => {
			if (fold) openFolds.add(fold.key);
			// A jump: no view to keep, and no flushSync inside an effect.
			if (i < start) start = Math.max(0, i - 2);
		});
		tick().then(() => rowEls[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
	});

	// Index in `messages` of each message the user wrote, in order: the rail's marks.
	const markRows = $derived(messages.flatMap((m, i) => (m.kind === 'user' && !parseDelivery(m.text) ? [i] : [])));
	/** The mark at or above the upper third of the view; the last at the end. */
	function updateMark() {
		const rows = markRows;
		if (!rows.length) return void (mark = -1);
		if (atEnd || !scroller) return void (mark = rows.length - 1);
		const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
		const topOf = (k: number) => (rows[k]! < start ? -Infinity : (rowEls[rows[k]!]?.getBoundingClientRect().top ?? -Infinity));
		// The last mark whose row starts above the line (rows are in order).
		let lo = 0;
		let hi = rows.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (topOf(mid) <= line) lo = mid;
			else hi = mid - 1;
		}
		mark = lo;
	}
	$effect(() => {
		void markRows;
		untrack(updateMark);
	});

	/** Scroll mark `n`'s message to the top of the viewport. */
	export function jumpToMark(n: number) {
		const i = markRows[n];
		if (i === undefined || !scroller) return;
		extend(Math.min(start, i - 2));
		const row = rowEls[i];
		if (!row) return;
		const top = scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
		scroller.scrollTo({ top, behavior: 'smooth' });
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
	function takeCite(to: ((text: string) => void) | undefined = onCite) {
		if (!cite) return;
		to?.(cite.text);
		window.getSelection()?.removeAllRanges();
		cite = null;
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
	// …and its mentioned files (fileMention.ts) as chips naming the file.
	function userSegments(text: string): { text: string; image?: string; file?: string }[] {
		const out: { text: string; image?: string; file?: string }[] = [];
		let last = 0;
		for (const m of text.matchAll(/\[图片 #(\d+)\]/g)) {
			if (m.index > last) out.push(...splitMentions(text.slice(last, m.index)));
			out.push({ text: m[0], image: m[1] });
			last = m.index + m[0].length;
		}
		if (last < text.length) out.push(...splitMentions(text.slice(last)));
		return out;
	}
	const fileName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

	// Skip empty placeholders (e.g. an assistant message before its first delta).
	function hasContent(m: Msg): boolean {
		// Meta/status notices render in the collapsible status strip, not inline.
		if (m.kind === 'system') return false;
		if (m.kind === 'tool') return !!(m.name || m.output);
		if (m.kind === 'plan') return !!(m.title || m.text);
		// Not trim(): this runs over every message whenever a reply grows.
		return /\S/.test(m.text);
	}

	// A run of consecutive tool calls (rows that show nothing don't break it),
	// with the reasoning that led to each of them, renders as one card on its
	// first row; the run's other rows render no row of their own. Reasoning
	// that no call follows (yet) stays a block of its own.
	const toolGroups = $derived.by(() => {
		const members = new Map<Msg, Msg[]>(); // first row → the run
		const headOf = new Map<Msg, Msg>();
		let run: Msg[] = [];
		let thoughts: Msg[] = [];
		const flush = () => {
			if (run.length) {
				members.set(run[0]!, run);
				for (const x of run) headOf.set(x, run[0]!);
			}
			run = [];
			thoughts = [];
		};
		for (const m of messages) {
			if (!hasContent(m)) continue;
			if (m.kind === 'tool' && !isAgentCall(m)) {
				run.push(...thoughts, m);
				thoughts = [];
			} else if (m.kind === 'reasoning') thoughts.push(m);
			else flush();
		}
		flush();
		return { members, headOf };
	});
	const openGroups = new SvelteSet<Msg>();
	// The last message with something to show (a plan's actions show there only).
	const lastShown = $derived(messages.findLast((m) => hasContent(m)));
	/** A spawn or wait call that renders as a subagent card. */
	function isAgentCall(m: Msg): boolean {
		if (!agents || m.kind !== 'tool') return false;
		// A Workflow is a card once its run is known (agent_runs), else a plain tool row.
		if (m.name === 'Workflow') return !!agentOfCall(agents, m.callId);
		return SPAWN_TOOLS.has(m.name) || WAIT_TOOLS.has(m.name);
	}
	// Finished turns' work, folded into a line on its first row; a turn's
	// open state is kept by its user message.
	const folds = $derived.by(() => {
		const head = new Map<Msg, TurnFold>();
		const of = new Map<Msg, TurnFold>();
		if (foldTurns)
			for (const f of turnFolds(messages, hasContent, busy)) {
				head.set(f.members[0]!, f);
				for (const m of f.members) of.set(m, f);
			}
		return { head, of };
	});
	const openFolds = new SvelteSet<Msg>();
	function folded(m: Msg): boolean {
		const f = folds.of.get(m);
		return !!f && !openFolds.has(f.key);
	}
	function shown(m: Msg): boolean {
		return hasContent(m) && (!toolGroups.headOf.has(m) || toolGroups.members.has(m)) && (!folded(m) || folds.head.has(m));
	}
	function foldLine(f: TurnFold): string {
		const parts = [f.elapsed !== null ? t('chat.fold.worked', { t: fmtDur(f.elapsed) }) : t('chat.fold.steps', { n: f.calls })];
		if (f.files) parts.push(t('chat.fold.files', { n: f.files }));
		if (f.commands) parts.push(t('chat.fold.commands', { n: f.commands }));
		return parts.join(' · ');
	}
</script>

<svelte:document onselectionchange={() => cite && window.getSelection()?.isCollapsed && (cite = null)} />

<div class="list" bind:this={listEl} onmouseup={() => setTimeout(offerCite)} role="presentation">
	{#each messages.slice(start) as m, k (m)}
		{@const i = start + k}
		{#if shown(m)}
			{@const run = toolGroups.members.get(m)}
			{@const fold = folds.head.get(m)}
			<div class="mwrap" class:animate={arriving.has(m)} class:hit={i === findActive} bind:this={rowEls[i]}>
				{#if fold}
					{@const open = openFolds.has(fold.key)}
					<button class="fold" class:open onclick={() => (open ? openFolds.delete(fold.key) : openFolds.add(fold.key))} aria-expanded={open}>
						<span class="rchev"><ChevronRightIcon size={14} /></span>
						<span>{foldLine(fold)}</span>
						<span class="fold-rule"></span>
					</button>
				{/if}
				{#if fold && folded(m)}
					<!-- Folded: the line is the whole row. -->
				{:else if run}
					<ToolGroup {run} open={openGroups.has(m)} onToggle={() => (openGroups.has(m) ? openGroups.delete(m) : openGroups.add(m))} {onFile} {traceOf} />
				{:else if m.kind === 'user'}
			{@const delivery = parseDelivery(m.text)}
			{@const drop = userOrdinal.size - (userOrdinal.get(m) ?? 0)}
			{#if delivery}
				<DeliveryNotice {delivery} />
			{:else}
			<div class="row user">
				<button class="uedit rewind" onclick={() => onRewind(m.text, userOrdinal.get(m) ?? 0)} aria-label="rewind" title={t('chat.rewindTitleN', { n: drop })}>
					<RotateCcwIcon size={12} />{#if drop > 1}<span class="rwn">{drop}</span>{/if}
				</button>
				<button class="uedit" onclick={() => onEdit(m.text)} aria-label="quote" title={t('chat.quoteTitle')}><PencilIcon size={12} /></button>
				<div class="ucol">
					<!-- One line: the bubble is pre-wrap, so template whitespace would show. -->
					<div class="bubble" class:pending={m.state === 'sending'}>{#if m.images?.length}<div class="uimgs">{#each m.images as p (p)}<UserImage path={p} load={loadImage} group={m.images} />{/each}</div>{/if}{#each userBlocks(m.text) as block, b (b)}{#if block.quote}<span class="uquote">{block.text}</span>{:else}<span class="utext">{#each userSegments(block.text) as seg, j (j)}{#if seg.image}<span class="utoken">{t('chat.imageToken', { n: seg.image })}</span>{:else if seg.file}<button class="utoken ufile" title={seg.file} data-file={seg.file} onclick={() => onFile?.(seg.file!)}><FileTextIcon size={12} />{fileName(seg.file)}</button>{:else}{seg.text}{/if}{/each}</span>{/if}{/each}</div>
					{#if m.state}
						{#key m.state}
							<div class="sendstate {m.state}" in:fade={{ duration: 160 }}>
								{#if m.state === 'failed'}<CircleAlertIcon size={14} />{:else}<span class="sdot"></span>{/if}
								<span>{t(`chat.send.${m.state}`)}</span>
								{#if call && (m.state === 'connecting' || m.state === 'waiting')}<CallTimer since={call.since} />{/if}
							</div>
						{/key}
					{/if}
				</div>
			</div>
			{/if}
		{:else if m.kind === 'assistant'}
			<div class="answer">
				{#if m === streamingMsg}
					{@const rt = revealed(m)}
					{@const si = splitIdx(rt)}
					{#each stableBlocks(rt.slice(0, si)) as block (block.key)}<Markdown text={block.text} />{/each}
					<div class="stream">{rt.slice(si)}</div>
				{:else}
					<Markdown text={m.text} {onFile} />
					<!-- Only the turn's last reply carries the request's totals. -->
					{#if m.turn}
						<div class="foot">
							{#each turnParts(m.turn, prefs.turnStats) as part, j (j)}
								<span class="stat" class:mono={part.mono} title={part.title}>{part.text}</span>
							{/each}
						</div>
					{:else if m.elapsed}
						<div class="foot">
							<span class="mono">{fmtDur(m.elapsed)}</span>
							{#if m.tokens}<span class="mono">{t('chat.tokens', { n: m.tokens })}</span>{/if}
						</div>
					{/if}
				{/if}
			</div>
		{:else if m.kind === 'reasoning'}
			<div class="reason" class:open={!m.collapsed}>
				<button class="reason-head" onclick={() => (m.collapsed = !m.collapsed)}>
					<span>{t('chat.reasoning')}</span>
					<span class="rchev"><ChevronRightIcon size={14} /></span>
				</button>
				<Collapse open={!m.collapsed}>
					<div class="reason-body">
						{#if m === streamingReasoning}
							<!-- Reasoning summaries are markdown (OpenAI's open with a
							     **bold** title): completed blocks parse once, the short
							     tail block re-parses as it grows. -->
							<!-- While it streams: plain text (no per-frame Markdown);
							     it renders as Markdown once finished. -->
							<div class="stream">{revealed(m)}</div>
						{:else}
							<Markdown text={m.text} {onFile} />
						{/if}
					</div>
				</Collapse>
			</div>
		{:else if m.kind === 'tool' && agents}
			<SubagentCard name={m.name} callId={m.callId} output={m.output} args={m.args} running={m.running} isError={m.isError} rows={agents} onOpen={onOpenAgent} />
		{:else if m.kind === 'plan'}
			<PlanCard id={m.id} title={m.title} text={m.text} status={m.status} actionable={m === lastShown} defaultMode={planMode} onAction={onPlan} onOpen={onOpenPlan} />
		{:else if m.kind === 'error'}
			<ErrorNotice text={m.text} {backend} onAction={onErrorAction} onDismiss={onDismiss ? () => onDismiss(m) : undefined} />
				{/if}
			</div>
		{/if}
	{/each}
	{@render tail?.()}
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
	<div class="cite" class:below style:left="{cite.x}px" style:top="{below ? cite.bottom + 8 : cite.top - 8}px">
		<button onmousedown={(e) => e.preventDefault()} onclick={() => takeCite()}>
			<QuoteIcon size={14} />{t('chat.cite')}
		</button>
		{#if onNote}
			<button onmousedown={(e) => e.preventDefault()} onclick={() => takeCite(onNote)}>
				<ListPlusIcon size={14} />{t('shell.requirement.note')}
			</button>
		{/if}
	</div>
{/if}

<style>
	.cite {
		position: fixed;
		z-index: 300;
		transform: translate(-50%, -100%);
		display: inline-flex;
		border-radius: var(--r);
		border: 1px solid var(--border);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
		animation: cite-in var(--t-fast) var(--ease-out);
	}
	.cite button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.cite button + button {
		border-left: 1px solid var(--border);
	}
	.cite.below {
		transform: translateX(-50%);
	}
	.cite button:hover {
		background: var(--surface2);
	}
	@keyframes cite-in {
		from {
			opacity: 0;
		}
	}
	.list {
		font-family: var(--font-chat);
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
		border-radius: var(--r);
		transition: background var(--t-slow) var(--ease-out), box-shadow var(--t-slow) var(--ease-out);
	}
	/* A message arriving while the conversation is shown comes in once;
	   rows loading or joining above do not. */
	.mwrap.animate {
		animation: rise var(--t-med) var(--ease-out) both;
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
		border-radius: var(--r);
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
		border-radius: var(--r);
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
	.uquote,
	.utext {
		display: block;
	}
	.uquote {
		position: relative;
		padding: 5px 10px 5px 29px;
		border-radius: var(--r);
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
	.ufile {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		vertical-align: -1px;
		cursor: pointer;
	}
	.ufile:hover {
		background: color-mix(in oklab, var(--text) 10%, transparent);
	}
	.utoken {
		padding: 0 5px;
		border-radius: var(--r);
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
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin-top: 8px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.mono {
		font-family: var(--font-mono);
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
		transition: transform var(--t-med) var(--ease-out);
	}
	.reason.open .rchev,
	.fold.open .rchev {
		transform: rotate(90deg);
	}
	.fold {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 26px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.fold:hover {
		color: var(--text);
	}
	.fold-rule {
		flex: 1;
		height: 1px;
		background: var(--hairline);
	}
	/* Open, the line heads the work it folds. */
	.fold.open {
		margin-bottom: 12px;
	}
	.reason-body {
		margin-top: 4px;
		color: var(--dim);
		font-style: italic;
		font-size: var(--fs-sm);
		line-height: 1.6;
		word-break: break-word;
	}
	.foot .stat {
		white-space: nowrap;
	}
</style>
