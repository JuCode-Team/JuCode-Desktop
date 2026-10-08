<script lang="ts">
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import ArrowUUpLeftIcon from 'phosphor-svelte/lib/ArrowUUpLeftIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { git, revertAgentEdits } from '$lib/protocol';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import { t } from '$lib/i18n';

	// `files` is the session-tracked set of agent-edited paths; onRevert removes one.
	// `agentDiffs`: the agent's own edits per project-relative path, so a
	// revert undoes only them and keeps the user's changes.
	let {
		cwd = '',
		files = [],
		agentDiffs = {},
		onRevert
	}: { cwd?: string; files?: string[]; agentDiffs?: Record<string, string[]>; onRevert?: (p: string) => void } = $props();
	/** The recorded diffs for a listed path (absolute or project-relative). */
	function diffsOf(path: string): string[] {
		const root = cwd.replace(/\/+$/, '');
		const rel = root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
		return agentDiffs[rel] ?? [];
	}
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

	// Open a changed file in the built-in editor (relative paths resolve
	// against the project cwd inside the store).
	async function openInEditor(path: string) {
		try {
			await editorStore.open(path, cwd || undefined);
		} catch (e) {
			error = String(e);
		}
	}

	async function revert(path: string) {
		const diffs = diffsOf(path);
		// The agent's own edits are known: undo exactly them, keep the user's.
		if (diffs.length && cwd) {
			const ok = await confirm({
				title: t('dock.changes.revertTitle'),
				message: t('dock.changes.revertAgentConfirm', { path }),
				confirmLabel: t('dock.changes.revert'),
				danger: true
			});
			if (!ok) return;
			busy = true;
			error = '';
			try {
				const root = cwd.replace(/\/+$/, '');
				const rel = path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
				await revertAgentEdits(cwd, rel, diffs);
				onRevert?.(path);
				return;
			} catch (e) {
				// The file changed too much since: fall through to the full revert.
				error = t('dock.changes.revertAgentFailed', { error: String(e) });
			} finally {
				busy = false;
			}
		}
		const ok = await confirm({
			title: t('dock.changes.revertTitle'),
			message: t('dock.changes.revertConfirm', { path }),
			confirmLabel: t('dock.changes.revert'),
			danger: true
		});
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
		<GitDiffIcon size={14} class="ccol" />
		<span class="title">{t('dock.changes.title')} <span class="count">{files.length}</span></span>
		<IconButton size="sm" onclick={refresh} label="refresh"><ArrowsClockwiseIcon size={13} /></IconButton>
	</div>
	{#if error}
		<div class="oerr"><Notice mono onDismiss={() => (error = '')}>{error}</Notice></div>
	{/if}
	{#if files.length === 0}
		<div class="empty">
			<GitDiffIcon size={26} />
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
					<IconButton size="sm" onclick={() => openInEditor(f)} label={t('editor.openInEditor')} title={t('editor.openInEditor')}><NotePencilIcon size={13} /></IconButton>
					<IconButton size="sm" onclick={() => revert(f)} disabled={busy} label={t('dock.changes.revert')} title={t('dock.changes.revertFile')}><ArrowUUpLeftIcon size={13} /></IconButton>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if diff}
	<Modal title={diff.path} width={760} padded={false} onClose={() => (diff = null)}>
		<pre class="diff">{#each diff.lines as d (d)}<span class={d.cls}>{d.line}
</span>{/each}</pre>
	</Modal>
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
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		background: var(--surface2);
		border-radius: var(--r-full);
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
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rpath:hover .rname {
		color: var(--accent-bright);
	}
	.rdir {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
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
		font-size: var(--fs-md);
		color: var(--dim);
	}
	.empty span {
		font-size: var(--fs-xs);
	}
	.oerr {
		margin: 8px 12px 0;
	}
	.diff {
		margin: 0;
		padding: 12px 14px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
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
