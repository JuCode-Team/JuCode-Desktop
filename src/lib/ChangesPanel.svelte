<script lang="ts">
	import { FileDiff, RefreshCw, X, Undo2 } from 'lucide-svelte';
	import { ask } from '@tauri-apps/plugin-dialog';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { git } from '$lib/protocol';
	import { t } from '$lib/i18n';

	// `files` is the session-tracked set of agent-edited paths; onRevert removes one.
	let { cwd = '', files = [], onRevert }: { cwd?: string; files?: string[]; onRevert?: (p: string) => void } = $props();
	const dir = () => cwd || undefined;

	let stats = $state<Record<string, { add: number; del: number }>>({});
	let busy = $state(false);
	let error = $state('');
	let diff = $state<{ path: string; lines: { line: string; cls: string }[] } | null>(null);

	function classify(text: string) {
		return text.split('\n').map((line) => {
			let cls = 'ctx';
			if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
			else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
			else if (line.startsWith('@@')) cls = 'hunk';
			else if (line.startsWith('diff ') || line.startsWith('+++') || line.startsWith('---')) cls = 'meta';
			return { line, cls };
		});
	}
	const baseName = (p: string) => p.split('/').pop() || p;

	// Refresh +/- line stats for the tracked files (untracked new files show none).
	async function refresh() {
		if (!files.length) {
			stats = {};
			return;
		}
		try {
			const out = await git(['diff', '--numstat', '--', ...files], dir());
			const next: Record<string, { add: number; del: number }> = {};
			for (const l of out.split('\n').filter(Boolean)) {
				const [a, d, ...rest] = l.split('\t');
				next[rest.join('\t')] = { add: Number(a) || 0, del: Number(d) || 0 };
			}
			stats = next;
		} catch {
			/* ignore — stats are best-effort */
		}
	}
	// Re-pull stats whenever the file set changes.
	$effect(() => {
		files;
		refresh();
	});

	async function showDiff(path: string) {
		try {
			const text = await git(['diff', '--no-color', '--', path], dir());
			diff = { path, lines: classify(text || t('dock.changes.newFileDiff')) };
		} catch (e) {
			diff = { path, lines: classify(String(e)) };
		}
	}

	async function revert(path: string) {
		const ok = await ask(t('dock.changes.revertConfirm', { path }), { title: t('dock.changes.revertTitle'), kind: 'warning' });
		if (!ok) return;
		busy = true;
		error = '';
		try {
			const st = await git(['status', '--porcelain=v1', '--', path], dir());
			const untracked = st.trimStart().startsWith('??');
			if (untracked) await git(['clean', '-fd', '--', path], dir());
			else await git(['restore', '--worktree', '--', path], dir());
			onRevert?.(path);
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="changes">
	<div class="bar">
		<FileDiff size={14} class="ccol" />
		<span class="title">{t('dock.changes.title')} <span class="count">{files.length}</span></span>
		<IconButton size="sm" onclick={refresh} label="refresh"><RefreshCw size={13} /></IconButton>
	</div>
	{#if error}
		<div class="oerr" role="button" tabindex="0" onclick={() => (error = '')} onkeydown={(e) => e.key === 'Enter' && (error = '')}>{error}</div>
	{/if}
	{#if files.length === 0}
		<div class="empty">
			<FileDiff size={26} />
			<p>{t('dock.changes.empty')}</p>
			<span>{t('dock.changes.emptyHint')}</span>
		</div>
	{:else}
		<div class="list">
			{#each files as f (f)}
				{@const s = stats[f]}
				<div class="row">
					<button class="rpath" onclick={() => showDiff(f)} title={f}>
						<span class="rname">{baseName(f)}</span>
						<span class="rdir">{f}</span>
					</button>
					{#if s}<span class="stat"><span class="add">+{s.add}</span> <span class="del">−{s.del}</span></span>{/if}
					<IconButton size="sm" onclick={() => revert(f)} disabled={busy} label={t('dock.changes.revert')} title={t('dock.changes.revertFile')}><Undo2 size={13} /></IconButton>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if diff}
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (diff = null)}>
		<div class="sheet" role="dialog" tabindex="-1" aria-label={diff.path}>
			<div class="sheet-head">
				<span class="sheet-name">{diff.path}</span>
				<IconButton onclick={() => (diff = null)} label="close"><X size={15} /></IconButton>
			</div>
			<pre class="diff">{#each diff.lines as d (d)}<span class={d.cls}>{d.line}
</span>{/each}</pre>
		</div>
	</div>
{/if}

<style>
	.changes {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	:global(.ccol) {
		color: var(--accent-bright);
	}
	.title {
		flex: 1;
		font-size: 13px;
		font-weight: 600;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 999px;
		padding: 1px 7px;
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px 8px 14px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px 5px 9px;
		border-radius: var(--r-sm);
	}
	.row:hover {
		background: var(--surface2);
	}
	.rpath {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		text-align: left;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		padding: 2px 0;
	}
	.rname {
		font-family: var(--font-mono);
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rpath:hover .rname {
		color: var(--accent-bright);
	}
	.rdir {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat {
		font-family: var(--font-mono);
		font-size: 11px;
		flex-shrink: 0;
	}
	.stat .add {
		color: var(--ok);
	}
	.stat .del {
		color: var(--err);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--dim2);
		padding: 30px;
		text-align: center;
	}
	.empty p {
		margin: 4px 0 0;
		font-size: 14px;
		color: var(--dim);
	}
	.empty span {
		font-size: 12px;
	}
	.oerr {
		margin: 8px 12px 0;
		padding: 7px 10px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 30%, transparent);
		border-radius: var(--r-sm);
		white-space: pre-wrap;
		word-break: break-word;
		cursor: pointer;
	}
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 55;
	}
	.sheet {
		width: min(760px, 92vw);
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.sheet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.sheet-name {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.diff {
		margin: 0;
		padding: 12px 14px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		color: var(--text);
	}
	.diff .add {
		color: var(--ok);
		background: color-mix(in oklab, var(--ok) 10%, transparent);
		display: block;
	}
	.diff .del {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 10%, transparent);
		display: block;
	}
	.diff .hunk {
		color: var(--accent-bright);
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
