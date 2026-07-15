<script lang="ts">
	import { Pencil, Copy, Check, ChevronRight, RotateCcw } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import Markdown from '$lib/Markdown.svelte';
	import ToolCard from '$lib/ToolCard.svelte';
	import Indicator from '$lib/Indicator.svelte';
	import { t } from '$lib/i18n';
	import type { Msg } from '$lib/chat.svelte';

	let {
		messages,
		streamingMsg,
		streamingReasoning,
		phase,
		compactionTokens = 0,
		findActive = null,
		scroller = null,
		onEdit,
		onRewind,
		onFile
	}: {
		messages: Msg[];
		streamingMsg: Msg | null;
		streamingReasoning: Msg | null;
		phase: string | null;
		compactionTokens?: number;
		findActive?: number | null;
		// The scroll viewport (owned by +page). When provided and the history is
		// long, rows outside the viewport are windowed out.
		scroller?: HTMLElement | null;
		onEdit: (text: string) => void;
		onRewind: (text: string, userIndex: number) => void;
		/** Open a workspace file referenced by a chat link (editor / browser). */
		onFile?: (href: string) => void;
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
	let raf = 0;

	// Track the viewport's scroll position + height.
	$effect(() => {
		const el = scroller;
		if (!el) return;
		const sync = () => {
			scrollTop = el.scrollTop;
			viewH = el.clientHeight;
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
	let rowEls: HTMLElement[] = [];

	// Map each user message to its 0-based ordinal so a rewind can target the
	// matching engine turn (the engine lists user turns in the same order).
	const userOrdinal = $derived.by(() => {
		const map = new Map<Msg, number>();
		let n = 0;
		for (const m of messages) if (m.kind === 'user') map.set(m, n++);
		return map;
	});

	let copied = $state<unknown>(null);
	function copy(text: string, m: unknown) {
		navigator.clipboard?.writeText(text).catch(() => {});
		copied = m;
		setTimeout(() => {
			if (copied === m) copied = null;
		}, 1500);
	}

	const fmtDur = (ms: number) =>
		ms < 1000
			? `${ms}ms`
			: ms < 60000
				? `${(ms / 1000).toFixed(1)}s`
				: `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;

	// Smoothing buffer: SSE deltas arrive in big bursts every few seconds, which
	// reads as jerky chunk-by-chunk output. Reveal the received text at an adaptive
	// pace so it flows continuously. `shown` chases the active message's length with
	// a proportional controller (speed grows with backlog, floored so it never
	// stalls while content is pending), integrated over real time.
	const REVEAL_TAU = 1.2; // s — backlog time constant (higher = smoother, more lag)
	const MIN_CPS = 24; // chars/s floor while streaming
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

	// Skip empty placeholders (e.g. an assistant message before its first delta).
	function shown(m: Msg): boolean {
		// Meta/status notices render in the collapsible status strip, not inline.
		if (m.kind === 'system') return false;
		if (m.kind === 'tool') return !!(m.name || m.output);
		return !!m.text && m.text.trim().length > 0;
	}
</script>

<div class="list" style:padding-top="{padTop}px" style:padding-bottom="{padBottom}px">
	{#each windowRows as m, k (m)}
		{@const i = range.first + k}
		{#if shown(m)}
			<div class="mwrap" class:hit={i === findActive} bind:this={rowEls[i]} use:measure={m}>
				{#if m.kind === 'user'}
			{@const drop = userOrdinal.size - (userOrdinal.get(m) ?? 0)}
			<div class="row user">
				<button class="uedit rewind" onclick={() => onRewind(m.text, userOrdinal.get(m) ?? 0)} aria-label="rewind" title={t('chat.rewindTitleN', { n: drop })}>
					<RotateCcw size={12} />{#if drop > 1}<span class="rwn">{drop}</span>{/if}
				</button>
				<button class="uedit" onclick={() => onEdit(m.text)} aria-label="quote" title={t('chat.quoteTitle')}><Pencil size={12} /></button>
				<div class="bubble">{m.text}</div>
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
						{#if m.elapsed}<span class="mono">{fmtDur(m.elapsed)}</span>{/if}
						{#if m.tokens}<span class="mono">{t('chat.tokens', { n: m.tokens })}</span>{/if}
						<button class="copy" onclick={() => copy(m.text, m)} aria-label="copy">
							{#if copied === m}<Check size={13} /> {t('common.copied')}{:else}<Copy size={13} /> {t('common.copy')}{/if}
						</button>
					</div>
				{/if}
			</div>
		{:else if m.kind === 'reasoning'}
			<div class="reason" class:open={!m.collapsed}>
				<button class="reason-head" onclick={() => (m.collapsed = !m.collapsed)}>
					<span class="rchev"><ChevronRight size={13} /></span>
					<span>{t('chat.reasoning')}</span>
				</button>
				{#if !m.collapsed}
					<div class="reason-body" transition:slide={{ duration: 180 }}>
						{#if m === streamingReasoning}
							{#each revealed(m).split('\n') as line, i (i)}
								<div class="rline">{line || ' '}</div>
							{/each}
						{:else}
							<Markdown text={m.text} {onFile} />
						{/if}
					</div>
				{/if}
			</div>
		{:else if m.kind === 'tool'}
			<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} />
		{:else if m.kind === 'error'}
			<div class="error">{m.text}</div>
				{/if}
			</div>
		{/if}
	{/each}
	<Indicator {phase} tokens={compactionTokens} />
</div>

<style>
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
		border-radius: 10px;
		transition: background 0.3s ease, box-shadow 0.3s ease;
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
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: 5px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.row.user:hover .uedit {
		opacity: 1;
	}
	.uedit:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.uedit.rewind {
		gap: 2px;
		align-items: center;
	}
	.rwn {
		font-size: 9.5px;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.bubble {
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 14px 14px 4px 14px;
		padding: 11px 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 78%;
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
		font-size: 11px;
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
		padding: 2px 4px;
		border-radius: 5px;
		font-size: 11px;
	}
	.copy:hover {
		background: var(--surface2);
		color: var(--text);
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
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.reason-head:hover {
		color: var(--text);
	}
	.rchev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform 0.12s;
	}
	.reason.open .rchev {
		transform: rotate(90deg);
	}
	.reason-body {
		margin-top: 4px;
		color: var(--dim);
		font-style: italic;
		font-size: 13px;
		line-height: 1.6;
		word-break: break-word;
	}
	.rline {
		white-space: pre-wrap;
		animation: rline-in 0.26s ease both;
	}
	@keyframes rline-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.error {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 32%, transparent);
		padding: 9px 12px;
		border-radius: var(--r-sm);
	}
</style>
