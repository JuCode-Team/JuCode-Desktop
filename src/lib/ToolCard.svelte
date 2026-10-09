<script lang="ts">
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { untrack } from 'svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import { t } from '$lib/i18n';
	import Notice from '$lib/ui/Notice.svelte';
	import { parseToolOutput, toolIcon, toolTarget, toolVerb, unwrapShell } from '$lib/toolSummary';

	let {
		name,
		output,
		running,
		isError,
		subagent = '',
		trace
	}: {
		name: string;
		output: string;
		running: boolean;
		isError: boolean;
		/** The Task subagent that made the call. */
		subagent?: string;
		/** An Agent / Workflow call: opens what it ran in the agent trace. */
		trace?: { label: string; run: () => void };
	} = $props();

	// Auto-expand while the tool runs, auto-collapse once it finishes. Starts in
	// that state (a card remounting — windowed back in, its group reopened — must
	// not flash open) and follows only flips of `running`, so a manual toggle on a
	// finished card still sticks.
	let collapsed = $state(untrack(() => !running));
	let wasRunning = untrack(() => running);
	$effect(() => {
		if (running === wasRunning) return;
		wasRunning = running;
		collapsed = !running;
	});

	const parsed = $derived(parseToolOutput(output));
	const s = (v: unknown) => (typeof v === 'string' ? v : '');
	const verb = $derived(toolVerb(name));
	const Icon = $derived(toolIcon(name));
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

<div class="tool" class:err={isError || !!errorText}>
	<button class="head" class:static={isRead} onclick={() => !isRead && (collapsed = !collapsed)}>
		<span class="ico"><Icon size={14} /></span>
		<span class="verb">{verb}</span>
		{#if target}<span class="target">{target}</span>{/if}
		{#if subagent}<span class="by" title={t('chat.bySubagent', { name: subagent })}>{subagent}</span>{/if}
		{#if exitCode !== null && exitCode !== 0}
			<span class="exit bad">exit {exitCode}</span>
		{/if}
		{#if partialApply}
			<span class="partial">{t('chat.partialApply', { n: partialApply.n, m: partialApply.m })}</span>
		{/if}
		{#if isError || errorText}
			<span class="fail">{t('chat.toolError')}</span>
		{/if}
		{#if running}
			<CircleNotchIcon size={12} class="spin" />
		{:else if !isRead}
			<span class="chev" class:open={!collapsed}><CaretRightIcon size={13} /></span>
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
					{#if output}<pre>{output}</pre>{/if}
				{:else if imageSrc}
					<img class="img" src={imageSrc} alt={target} />
				{:else if unsupportedImage}
					<div class="meta">{t('chat.unsupportedImage')}</div>
				{:else if kind === 'binary'}
					<div class="meta">{t('chat.binaryFile')}{#if bytes !== null} · {fmtBytes(bytes)}{/if}</div>
				{:else if diffLines.length}
					<pre class="diff">{#each diffLines as d (d)}<span class={d.cls}>{d.line}
	</span>{/each}</pre>
				{:else if command || stdout || stderr || exitCode !== null}
					{#if command}<div class="cmd">$ {command}</div>{/if}
					{#if stdout}<pre>{stdout}</pre>{/if}
					{#if stderr}<pre class="stderr">{stderr}</pre>{/if}
				{:else if hasEntries}
					{#if entries.length}<pre class="entries">{entries.join('\n')}</pre>{:else}<div class="meta">{t('chat.emptyDir')}</div>{/if}
				{:else if symbols.length}
					<pre class="entries">{#each symbols as sym (sym.line)}{sym.line}  {sym.symbol}
	{/each}</pre>
				{:else if kind === 'text'}
					{#if content}<pre>{content}</pre>{:else}<div class="meta">{t('chat.emptyFile')}</div>{/if}
				{:else if bytes !== null || truncated}
					<div class="meta">{[bytes !== null ? fmtBytes(bytes) : '', truncated ? t('chat.truncated') : ''].filter(Boolean).join(' · ')}</div>
				{:else if fallbackText}
					<pre>{fallbackText}</pre>
				{/if}
			</div>
		</Collapse>
	{/if}
</div>

<style>
	/* Flat, card-less row: a muted one-line label with a trailing chevron,
	 * matching the reasoning header's aesthetic. The expanded body hangs below
	 * behind a hairline left rule instead of inside a bordered box. */
	.head {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		max-width: 100%;
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
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
		transition: color var(--t-fast) var(--ease-out);
	}
	.head:hover:not(.static) .ico {
		color: var(--text);
	}
	.tool.err .ico {
		color: color-mix(in oklab, var(--err) 70%, var(--dim));
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
		margin: 2px 0 2px 22px;
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
	.fail {
		font-size: var(--fs-2xs);
		color: var(--err);
		flex-shrink: 0;
	}
	.tool.err .head {
		color: color-mix(in oklab, var(--err) 70%, var(--dim));
	}
	.body {
		margin: 2px 0 6px 20px;
	}
	.partial {
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border-radius: var(--r-full);
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
		max-height: 200px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
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
		border-radius: var(--r-sm);
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
