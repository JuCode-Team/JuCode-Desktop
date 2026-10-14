<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import Collapse from '$lib/ui/Collapse.svelte';
	import { t } from '$lib/i18n';
	import Notice from '$lib/ui/Notice.svelte';
	import { diffStat, parseToolOutput, toolTarget, toolVerb, unwrapShell } from '$lib/toolSummary';
	import DiffStat from '$lib/DiffStat.svelte';
	import { fmtDur } from '$lib/turnStats';

	let {
		name,
		output,
		running,
		isError,
		subagent = '',
		trace,
		startedAt,
		endedAt,
		now = 0,
		framed = false
	}: {
		name: string;
		output: string;
		running: boolean;
		isError: boolean;
		/** The Task subagent that made the call. */
		subagent?: string;
		/** An Agent / Workflow call: opens what it ran in the agent trace. */
		trace?: { label: string; run: () => void };
		/** When the call started and returned, ms (absent: no time shown). */
		startedAt?: number;
		endedAt?: number;
		/** The clock a running call's time counts to. */
		now?: number;
		/** The call is a tool card of its own (a run of one call). */
		framed?: boolean;
	} = $props();

	const took = $derived(startedAt ? Math.max(0, (endedAt ?? (running ? now : startedAt)) - startedAt) : null);

	// Folded until opened: a running call shows its spinner and time, and the
	// conversation does not grow and shrink with each call's output.
	let collapsed = $state(true);

	const parsed = $derived(parseToolOutput(output));
	const s = (v: unknown) => (typeof v === 'string' ? v : '');
	const verb = $derived(toolVerb(name));
	const stat = $derived(diffStat(parsed));
	const target = $derived(toolTarget(name, parsed));

	const kind = $derived(s(parsed?.kind));
	const errorText = $derived(s(parsed?.error));
	// Readable body for tools we don't render specially (Task, MCP tools, unknown):
	// prefer a few common text fields, else a pretty-printed object.
	const fallbackText = $derived.by(() => {
		if (!parsed || typeof parsed !== 'object') return '';
		const p = parsed as Record<string, unknown>;
		const notable = ['description', 'prompt', 'query', 'summary', 'subagent_type', 'plan']
			.map((k) => (typeof p[k] === 'string' ? (p[k] as string) : ''))
			.filter(Boolean);
		if (notable.length) return notable.join('\n\n').slice(0, 4000);
		try {
			const json = JSON.stringify(p, null, 2);
			return json === '{}' ? '' : json.slice(0, 4000);
		} catch {
			return '';
		}
	});
	const diff = $derived(s(parsed?.diff));
	const exitCode = $derived(typeof parsed?.exit_code === 'number' ? (parsed!.exit_code as number) : null);

	const diffLines = $derived.by(() => {
		if (!diff) return [];
		return diff.split('\n').map((line) => {
			let cls = 'ctx';
			if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
			else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
			else if (line.startsWith('@@')) cls = 'hunk';
			else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) cls = 'meta';
			return { line, cls };
		});
	});

	// Partial hunk approval: the engine reports which hunks it applied/rejected
	// in the edit tool's JSON output. Surface a small "N/M applied" badge when
	// some hunks were rejected (nothing rejected → normal card).
	const partialApply = $derived.by(() => {
		const applied = parsed?.applied_hunks;
		const rejected = parsed?.rejected_hunks;
		if (!Array.isArray(applied) || !Array.isArray(rejected) || rejected.length === 0) return null;
		return { n: applied.length, m: applied.length + rejected.length };
	});

	const entries = $derived(Array.isArray(parsed?.entries) ? (parsed!.entries as string[]) : []);
	const hasEntries = $derived(Array.isArray(parsed?.entries));
	const command = $derived(unwrapShell(s(parsed?.command) || s(parsed?.cmd)));
	const stdout = $derived(s(parsed?.stdout));
	const stderr = $derived(s(parsed?.stderr));
	const content = $derived(s(parsed?.content));
	const symbols = $derived(
		Array.isArray(parsed?.symbols)
			? (parsed!.symbols as Array<{ line?: number; symbol?: string }>)
			: []
	);
	const truncated = $derived(parsed?.truncated === true);

	// Long output shows its first lines until expanded, per block.
	const CLAMP = 4;
	let fullBlocks = $state<Record<string, boolean>>({});
	const bytes = $derived(
		typeof parsed?.written_bytes === 'number'
			? (parsed!.written_bytes as number)
			: typeof parsed?.bytes === 'number'
				? (parsed!.bytes as number)
				: null
	);
	const fmtBytes = (n: number) =>
		n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

	// Read cards stay a single line — the header names the file; the contents add noise.
	const isRead = $derived(name === 'read' && !errorText);

	// Only render inline images for a whitelist of raster MIME types. SVG is
	// deliberately excluded: it can embed <script> and run in a data: URL.
	const IMG_MIME_WHITELIST = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
	// A plausible base64 payload: only base64 alphabet + padding, non-empty.
	const isPlausibleBase64 = (v: string) => v.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);

	const imageSrc = $derived.by(() => {
		const p = parsed;
		if (!p || kind !== 'image' || typeof p.base64 !== 'string') return null;
		const mime = s(p.mime) || 'image/png';
		const b64 = s(p.base64);
		if (!IMG_MIME_WHITELIST.has(mime.toLowerCase())) return null;
		if (!isPlausibleBase64(b64)) return null;
		return `data:${mime};base64,${b64}`;
	});
	// True when the tool reports an image but we refuse to render it.
	const unsupportedImage = $derived(kind === 'image' && typeof parsed?.base64 === 'string' && !imageSrc);
</script>

{#snippet clamped(key: string, lines: { text: string; cls?: string }[], cls = '')}
	{@const full = fullBlocks[key] || lines.length <= CLAMP}
	<pre class={cls}>{#each full ? lines : lines.slice(0, CLAMP) as l, i (i)}<span class={l.cls}>{l.text}
</span>{/each}</pre>
	{#if lines.length > CLAMP}
		<button class="more" onclick={() => (fullBlocks[key] = !fullBlocks[key])}>
			{#if full}{t('chat.lines.less')}{:else}{t('chat.lines.shown', { n: CLAMP, m: lines.length })} · {t('chat.lines.all')}{/if}
		</button>
	{/if}
{/snippet}
{#snippet plain(key: string, text: string, cls = '')}
	{@render clamped(key, text.replace(/\n$/, '').split('\n').map((l) => ({ text: l })), cls)}
{/snippet}

<div class="tool" class:framed class:err={isError || !!errorText}>
	<button class="head" class:static={isRead} onclick={() => !isRead && (collapsed = !collapsed)}>
		<span class="st">
			{#if running}<LoaderCircleIcon size={14} class="spin" />{:else if isError || errorText}<XIcon size={14} class="bad" />{:else}<CheckIcon size={14} class="good" />{/if}
		</span>
		<span class="verb">{verb}</span>
		{#if target}<span class="target">{target}</span>{/if}
		{#if subagent}<span class="by" title={t('chat.bySubagent', { name: subagent })}>{subagent}</span>{/if}
		{#if exitCode !== null && exitCode !== 0}
			<span class="exit bad">exit {exitCode}</span>
		{/if}
		{#if partialApply}
			<span class="partial">{t('chat.partialApply', { n: partialApply.n, m: partialApply.m })}</span>
		{/if}
		<span class="grow"></span>
		{#if stat}<DiffStat {...stat} />{/if}
		{#if took !== null}<span class="took">{fmtDur(took)}</span>{/if}
		{#if !isRead}
			<span class="chev" class:open={!collapsed}><ChevronRightIcon size={14} /></span>
		{/if}
	</button>

	{#if trace}
		<button class="trace" onclick={trace.run}>{trace.label}</button>
	{/if}
	{#if !isRead}
		<Collapse open={!collapsed}>
			<div class="body">
				{#if errorText}
					<div class="err-text"><Notice mono>{errorText}</Notice></div>
				{:else if !parsed}
					{#if output}{@render plain('out', output)}{/if}
				{:else if imageSrc}
					<img class="img" src={imageSrc} alt={target} />
				{:else if unsupportedImage}
					<div class="meta">{t('chat.unsupportedImage')}</div>
				{:else if kind === 'binary'}
					<div class="meta">{t('chat.binaryFile')}{#if bytes !== null} · {fmtBytes(bytes)}{/if}</div>
				{:else if diffLines.length}
					{@render clamped('diff', diffLines.map((d) => ({ text: d.line, cls: d.cls })), 'diff')}
				{:else if command || stdout || stderr || exitCode !== null}
					{#if command}<div class="cmd">$ {command}</div>{/if}
					{#if stdout}{@render plain('stdout', stdout)}{/if}
					{#if stderr}{@render plain('stderr', stderr, 'stderr')}{/if}
				{:else if hasEntries}
					{#if entries.length}{@render clamped('entries', entries.map((e) => ({ text: e })), 'entries')}{:else}<div class="meta">{t('chat.emptyDir')}</div>{/if}
				{:else if symbols.length}
					{@render clamped('symbols', symbols.map((sym) => ({ text: `${sym.line}  ${sym.symbol}` })), 'entries')}
				{:else if kind === 'text'}
					{#if content}{@render plain('content', content)}{:else}<div class="meta">{t('chat.emptyFile')}</div>{/if}
				{:else if bytes !== null || truncated}
					<div class="meta">{[bytes !== null ? fmtBytes(bytes) : '', truncated ? t('chat.truncated') : ''].filter(Boolean).join(' · ')}</div>
				{:else if fallbackText}
					{@render plain('fallback', fallbackText)}
				{/if}
			</div>
		</Collapse>
	{/if}
</div>

<style>
	/* One call as a row of its tool card (ToolGroup.svelte): its status, what it
	 * did, its time and a chevron; the output expands below. `framed`: the row
	 * is the card's header itself. */
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		min-height: 26px;
		text-align: left;
		padding: 2px 0;
		font-size: var(--fs-sm);
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.head:hover:not(.static) {
		color: var(--text);
	}
	.head.static {
		cursor: default;
	}
	.chev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-base) var(--ease-base);
		flex-shrink: 0;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.st {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
	}
	.st :global(.good) {
		color: var(--ok);
	}
	.st :global(.bad) {
		color: var(--err);
	}
	.grow {
		flex: 1;
	}
	.took {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	.framed {
		border: 1px solid var(--border);
		border-radius: var(--r);
	}
	.framed .head {
		padding: 4px 10px;
		min-height: 34px;
	}
	.framed .body {
		margin: 0;
		padding: 2px 10px 8px 31px;
	}
	.framed .trace {
		margin: 0 0 6px 31px;
	}
	.verb {
		font-weight: 500;
		flex-shrink: 0;
	}
	.target {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.trace {
		margin: 2px 0 2px 21px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.trace:hover {
		color: var(--text);
		text-decoration: underline;
	}
	.by {
		flex-shrink: 1;
		min-width: 0;
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.exit {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		flex-shrink: 0;
	}
	.exit.bad {
		color: var(--err);
	}
	.tool.err .head {
		color: color-mix(in oklab, var(--err) 70%, var(--dim));
	}
	.body {
		margin: 2px 0 6px 21px;
	}
	.partial {
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border-radius: var(--r);
		padding: 0 7px;
		flex-shrink: 0;
	}
	.body pre {
		margin: 0;
		padding: 4px 0;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.45;
		color: var(--dim);
		max-height: 480px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.more {
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		cursor: pointer;
	}
	.more:hover {
		color: var(--text);
	}
	.cmd {
		padding: 4px 0 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.stderr {
		color: var(--err);
	}
	.entries {
		color: var(--text) !important;
	}
	.err-text {
		padding: 4px 0;
	}
	.meta {
		padding: 4px 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.img {
		display: block;
		max-width: 100%;
		max-height: 320px;
		margin: 8px 0;
		border-radius: var(--r);
		border: 1px solid var(--border);
	}
	.diff {
		color: var(--text) !important;
	}
	.diff .add {
		color: var(--ok);
		background: color-mix(in oklch, var(--ok) 10%, transparent);
		display: block;
	}
	.diff .del {
		color: var(--err);
		background: color-mix(in oklch, var(--err) 10%, transparent);
		display: block;
	}
	.diff .hunk {
		color: var(--accent);
		display: block;
	}
	.diff .meta {
		color: var(--dim);
		display: block;
	}
	.diff .ctx {
		display: block;
	}
</style>
