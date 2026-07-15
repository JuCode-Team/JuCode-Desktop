<script lang="ts">
	import { LoaderCircle, ChevronRight } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { t } from '$lib/i18n';

	let { name, output, running, isError }: { name: string; output: string; running: boolean; isError: boolean } =
		$props();

	let collapsed = $state(false);
	// Auto-expand while the tool runs, auto-collapse once it finishes. Re-runs only
	// when `running` flips, so a manual toggle on a finished card still sticks.
	$effect(() => {
		collapsed = !running;
	});

	const parsed = $derived.by<Record<string, unknown> | null>(() => {
		try {
			const v = JSON.parse(output);
			return v && typeof v === 'object' ? v : null;
		} catch {
			return null;
		}
	});

	const s = (v: unknown) => (typeof v === 'string' ? v : '');
	const base = (p: string) => p.split('/').pop() || p;

	const verb = $derived(
		(
			{
				read: 'Read',
				write: 'Wrote',
				str_replace: 'Edited',
				hashline_edit: 'Edited',
				apply_patch: 'Edited',
				bash: 'Ran',
				exec_command: 'Ran',
				write_stdin: 'Wrote stdin',
				ls: 'Listed',
				ripgrep: 'Searched',
				outline: 'Outlined'
			} as Record<string, string>
		)[name] ?? name
	);

	const target = $derived.by(() => {
		const p = parsed;
		if (!p) return '';
		if (name === 'bash' || name === 'exec_command' || name === 'ripgrep') {
			const cmd = s(p.command) || s(p.pattern);
			return cmd.length > 64 ? cmd.slice(0, 64) + '…' : cmd;
		}
		if (typeof p.path === 'string') return base(p.path);
		return '';
	});

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
	const command = $derived(s(parsed?.command) || s(parsed?.cmd));
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
		<span class="verb">{verb}</span>
		{#if target}<span class="target">{target}</span>{/if}
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
			<LoaderCircle size={12} class="spin" />
		{:else if !isRead}
			<span class="chev" class:open={!collapsed}><ChevronRight size={13} /></span>
		{/if}
	</button>

	{#if !collapsed && !isRead}
		<div class="body" transition:slide={{ duration: 180 }}>
			{#if errorText}
				<div class="err-text">{errorText}</div>
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
	{/if}
</div>

<style>
	/* Flat, card-less row: a muted one-line label with a trailing chevron,
	 * matching the reasoning header's aesthetic. The expanded body hangs below
	 * behind a hairline left rule instead of inside a bordered box. */
	.head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		text-align: left;
		padding: 2px 0;
		font-size: 12.5px;
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
		transition: transform var(--t-med) var(--ease-spring);
		flex-shrink: 0;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.verb {
		font-weight: 500;
		flex-shrink: 0;
	}
	.target {
		font-family: var(--font-mono);
		font-size: 11.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.exit {
		font-family: var(--font-mono);
		font-size: 11px;
		flex-shrink: 0;
	}
	.exit.bad {
		color: var(--err);
	}
	.fail {
		font-size: 11px;
		color: var(--err);
		flex-shrink: 0;
	}
	.tool.err .head {
		color: color-mix(in oklab, var(--err) 70%, var(--dim));
	}
	.body {
		margin-top: 4px;
		border-left: 2px solid var(--hairline);
		padding-left: 12px;
	}
	.partial {
		font-size: 10.5px;
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--warn) 30%, transparent);
		border-radius: 999px;
		padding: 0 7px;
		flex-shrink: 0;
	}
	.body pre {
		margin: 0;
		padding: 4px 0;
		font-family: var(--font-mono);
		font-size: 11px;
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
		font-size: 11.5px;
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
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--err);
		white-space: pre-wrap;
	}
	.meta {
		padding: 4px 0;
		font-family: var(--font-mono);
		font-size: 11.5px;
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
