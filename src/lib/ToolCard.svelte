<script lang="ts">
	import { LoaderCircle, ChevronRight } from 'lucide-svelte';

	let { name, output, running, isError }: { name: string; output: string; running: boolean; isError: boolean } =
		$props();

	let collapsed = $state(false);

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
</script>

<div class="tool" class:err={isError || !!errorText}>
	<button class="head" class:static={isRead} onclick={() => !isRead && (collapsed = !collapsed)}>
		{#if running}
			<LoaderCircle size={13} class="spin" />
		{:else if !isRead}
			<span class="chev" class:open={!collapsed}><ChevronRight size={13} /></span>
		{/if}
		<span class="verb">{verb}</span>
		{#if target}<span class="target">{target}</span>{/if}
		{#if exitCode !== null}
			<span class="exit" class:bad={exitCode !== 0}>exit {exitCode}</span>
		{/if}
		<span class="state">{running ? 'running' : isError || errorText ? 'error' : 'done'}</span>
	</button>

	{#if !collapsed && !isRead}
		<div class="body">
			{#if errorText}
				<div class="err-text">{errorText}</div>
			{:else if !parsed}
				{#if output}<pre>{output}</pre>{/if}
			{:else if kind === 'image' && typeof parsed.base64 === 'string'}
				<img class="img" src={`data:${s(parsed.mime) || 'image/png'};base64,${s(parsed.base64)}`} alt={target} />
			{:else if kind === 'binary'}
				<div class="meta">二进制文件{#if bytes !== null} · {fmtBytes(bytes)}{/if}</div>
			{:else if diffLines.length}
				<pre class="diff">{#each diffLines as d (d)}<span class={d.cls}>{d.line}
</span>{/each}</pre>
			{:else if command || stdout || stderr || exitCode !== null}
				{#if command}<div class="cmd">$ {command}</div>{/if}
				{#if stdout}<pre>{stdout}</pre>{/if}
				{#if stderr}<pre class="stderr">{stderr}</pre>{/if}
			{:else if hasEntries}
				{#if entries.length}<pre class="entries">{entries.join('\n')}</pre>{:else}<div class="meta">空目录</div>{/if}
			{:else if symbols.length}
				<pre class="entries">{#each symbols as sym (sym.line)}{sym.line}  {sym.symbol}
{/each}</pre>
			{:else if kind === 'text'}
				{#if content}<pre>{content}</pre>{:else}<div class="meta">空文件</div>{/if}
			{:else if bytes !== null || truncated}
				<div class="meta">{[bytes !== null ? fmtBytes(bytes) : '', truncated ? '已截断' : ''].filter(Boolean).join(' · ')}</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool {
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--panel);
		overflow: hidden;
	}
	.tool.err {
		border-color: color-mix(in oklch, var(--err) 40%, transparent);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		text-align: left;
		padding: 5px 10px;
		font-size: 11.5px;
		background: var(--surface2);
		border: none;
		color: var(--text);
		cursor: pointer;
	}
	.head.static {
		cursor: default;
	}
	.chev {
		display: inline-flex;
		color: var(--dim);
		transition: transform 0.12s;
		flex-shrink: 0;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.verb {
		font-weight: 600;
	}
	.target {
		font-family: var(--font-mono);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.exit {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
	}
	.exit.bad {
		color: var(--err);
	}
	.state {
		margin-left: auto;
		color: var(--dim);
		font-size: 11px;
		flex-shrink: 0;
	}
	.body pre {
		margin: 0;
		padding: 7px 10px;
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
		padding: 7px 10px 0;
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
		padding: 7px 10px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--err);
		white-space: pre-wrap;
	}
	.meta {
		padding: 6px 10px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--dim);
	}
	.img {
		display: block;
		max-width: 100%;
		max-height: 320px;
		margin: 10px 12px;
		border-radius: 6px;
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
