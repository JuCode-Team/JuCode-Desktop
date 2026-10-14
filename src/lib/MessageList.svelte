<script lang="ts">
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { flushSync, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import Markdown from '$lib/Markdown.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import ToolGroup from '$lib/ToolGroup.svelte';
	import SubagentCard from '$lib/agents/SubagentCard.svelte';
	import PlanCard, { type PlanAction } from '$lib/PlanCard.svelte';
	import type { ApprovalMode } from '$lib/approval';
	import { SPAWN_TOOLS, WAIT_TOOLS, type AgentRow } from '$lib/agentProgress';
	import type { OpenHow } from '$lib/agents/subagentPages.svelte';
	import DeliveryNotice from '$lib/DeliveryNotice.svelte';
	import { parseDelivery } from '$lib/delivery';
	import { stableBlocks } from '$lib/streamBlocks';
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
		onOpenAgent?: (row: AgentRow, how: OpenHow) => void;
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
	} = $props();

	// ── Virtual list (dynamic-height windowing) ─────────────────────────────
	// Only long histories are windowed; short conversations render in full so the
	// streaming/auto-scroll path is completely untouched. Heights are measured per
	// message (cached by object identity) with an estimate for not-yet-seen rows.
	const VIRTUAL_MIN = 40; // messages before windowing engages
	// An unmeasured row's height, px, from what it holds: a row that enters the
	// window above the view moves the view by however far this is off, which
	// measure() then takes back.
	function estimate(m: Msg): number {
		if (folds.head.has(m) && folded(m)) return 26; // the fold's line
		const lines = (text: string, perLine: number) =>
			text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
		switch (m.kind) {
			case 'tool':
				return 36; // a folded card
			case 'reasoning':
				return m.collapsed ? 26 : 30 + lines(m.text, 45) * 25;
			case 'user':
				return 46 + lines(m.text, 36) * 25;
			case 'assistant':
				return 8 + lines(m.text, 45) * 26;
			default:
				return 120;
		}
	}
	const GAP = 16; // px, matches .list gap
	const OVERSCAN = 800; // px rendered beyond the viewport on each side
	const SETTLE_MS = 150; // quiet after the last scroll event before the padding settles

	// Weak: a transcript replay replaces the messages, and the old ones (with
	// their tool output) must not stay alive here.
	const heights = new WeakMap<Msg, number>();
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
			lastScroll = performance.now();
			scrollTop = el.scrollTop;
			// Near the top the padding has no room left to give: settle now.
			if (shift && padBase + shift < 0) {
				const was = shift;
				shift = 0;
				flushSync();
				el.scrollTop -= was;
			}
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
			const h = shown(m) ? (heights.get(m) ?? estimate(m)) + GAP : 0;
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
	// Rows above the view that change height while the reader scrolls give or
	// take room in the top padding, so nothing below them moves and the
	// scroll position is not touched mid-scroll (WebKit cuts a momentum
	// scroll short when it is). Once scrolling stops, the padding goes back
	// to the offsets' value and the position moves with it, in one step.
	let shift = $state(0);
	let lastScroll = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	const padBase = $derived(virtual ? offsets[range.first] : 0);
	const padTop = $derived(Math.max(0, padBase + shift));
	/** Rows above the view grew by `delta` px. */
	function correct(delta: number) {
		if (!scroller) return;
		if (performance.now() - lastScroll < SETTLE_MS && padBase + shift - delta >= 0) {
			shift -= delta;
			clearTimeout(settleTimer);
			settleTimer = setTimeout(settle, SETTLE_MS);
		} else scroller.scrollTop += delta;
	}
	function settle() {
		if (!shift || !scroller) return;
		const left = SETTLE_MS - (performance.now() - lastScroll);
		if (left > 0) {
			settleTimer = setTimeout(settle, left);
			return;
		}
		const was = shift;
		shift = 0;
		flushSync();
		scroller.scrollTop -= was;
	}
	const padBottom = $derived(virtual ? Math.max(0, totalH - offsets[range.last + 1]) : 0);

	let clickedAt = 0;
	// Measure a rendered row and cache its height, coalescing recomputes into one rAF.
	function measure(node: HTMLElement, msg: Msg) {
		const record = () => {
			const h = node.getBoundingClientRect().height;
			const prev = heights.get(msg);
			if (h > 0 && prev !== h) {
				heights.set(msg, h);
				// A row that starts above the view has a height other than the one
				// the window laid out for it: windowed in on the way up, it took
				// the room of its estimate; or it changed on its own (an image
				// loaded). It grows upwards, so what is being read stays put. A
				// change right after a click opens or folds something in view and
				// is left alone.
				const was = prev ?? estimate(msg);
				const own = prev === undefined || performance.now() - clickedAt > 1000;
				if (scroller && own && h !== was && node.getBoundingClientRect().top < scroller.getBoundingClientRect().top)
					correct(h - was);
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
		// A hit inside a folded turn opens it.
		const fold = folds.of.get(messages[findActive]!);
		if (fold) untrack(() => openFolds.add(fold.key));
		if (virtual && scroller) {
			scroller.scrollTo({ top: Math.max(0, offsets[findActive] - viewH / 2), behavior: 'smooth' });
		} else {
			rowEls[findActive]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	});
	let rowEls: (HTMLElement | null)[] = [];

	// Index in `messages` of each message the user wrote, in order: the rail's marks.
	const markRows = $derived(messages.flatMap((m, i) => (m.kind === 'user' && !parseDelivery(m.text) ? [i] : [])));
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
		if (m.kind === 'plan') return !!(m.title || m.text);
		return !!m.text && m.text.trim().length > 0;
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
		return !!agents && m.kind === 'tool' && (SPAWN_TOOLS.has(m.name) || WAIT_TOOLS.has(m.name));
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

<div class="list" bind:this={listEl} onclickcapture={() => (clickedAt = performance.now())} onmouseup={() => setTimeout(offerCite)} role="presentation" style:padding-top="{padTop}px" style:padding-bottom="{padBottom}px">
	{#each windowRows as m, k (m)}
		{@const i = range.first + k}
		{#if shown(m)}
			{@const run = toolGroups.members.get(m)}
			{@const fold = folds.head.get(m)}
			<div class="mwrap" class:animate={!virtual} class:hit={i === findActive} bind:this={rowEls[i]} use:measure={m}>
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
					<div class="bubble" class:pending={m.state === 'sending'}>{#if m.images?.length}<div class="uimgs">{#each m.images as p (p)}<UserImage path={p} load={loadImage} group={m.images} />{/each}</div>{/if}{#each userBlocks(m.text) as block, b (b)}{#if block.quote}<span class="uquote">{block.text}</span>{:else}<span class="utext">{#each userSegments(block.text) as seg, j (j)}{#if seg.image}<span class="utoken">{t('chat.imageToken', { n: seg.image })}</span>{:else}{seg.text}{/if}{/each}</span>{/if}{/each}</div>
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
	/* New rows come in once: unblur and rise over --t-enter. Suppressed under
	   windowing so rows scrolling back into the window don't replay. */
	.mwrap.animate {
		animation: msg-in var(--t-enter) var(--ease-enter) both;
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
		transition: transform var(--t-base) var(--ease-base);
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
