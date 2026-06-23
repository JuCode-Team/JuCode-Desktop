<script lang="ts">
	import { onMount } from 'svelte';
	import { Folder, FileText, ArrowUp, RefreshCw, X } from 'lucide-svelte';
	import { projectRoot, listDir, readText, type FsEntry } from '$lib/protocol';
	import IconButton from '$lib/ui/IconButton.svelte';

	let { rootDir = '' }: { rootDir?: string } = $props();
	let root = $state('');
	let cwd = $state('');
	let entries = $state<FsEntry[]>([]);
	let error = $state('');
	let viewer = $state<{ name: string; content: string } | null>(null);

	const rel = $derived(root && cwd.startsWith(root) ? cwd.slice(root.length).replace(/^\//, '') || '/' : cwd);

	async function load(path: string) {
		error = '';
		try {
			entries = await listDir(path);
			cwd = path;
		} catch (e) {
			error = String(e);
		}
	}
	onMount(async () => {
		root = rootDir || (await projectRoot());
		await load(root);
	});

	function up() {
		const parent = cwd.replace(/\/+$/, '').split('/').slice(0, -1).join('/');
		if (parent && parent.length >= root.length) load(parent);
	}
	async function open(e: FsEntry) {
		if (e.is_dir) {
			load(e.path);
		} else {
			try {
				viewer = { name: e.name, content: await readText(e.path) };
			} catch (err) {
				viewer = { name: e.name, content: `Error: ${err}` };
			}
		}
	}
</script>

<div class="files">
	<div class="bar">
		<IconButton size="sm" onclick={up} disabled={cwd === root} label="up"><ArrowUp size={14} /></IconButton>
		<span class="crumb" title={cwd}>{rel}</span>
		<IconButton size="sm" onclick={() => load(cwd)} label="refresh"><RefreshCw size={13} /></IconButton>
	</div>
	{#if error}
		<div class="err">{error}</div>
	{:else}
		<div class="list">
			{#each entries as e (e.path)}
				<button class="ent" onclick={() => open(e)}>
					{#if e.is_dir}<Folder size={15} class="fcol" />{:else}<FileText size={15} />{/if}
					<span class="ename">{e.name}</span>
				</button>
			{/each}
			{#if entries.length === 0}<div class="empty">空目录</div>{/if}
		</div>
	{/if}
</div>

{#if viewer}
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && (viewer = null)}>
		<div class="sheet" role="dialog" tabindex="-1" aria-label={viewer.name}>
			<div class="sheet-head">
				<span class="sheet-name">{viewer.name}</span>
				<IconButton onclick={() => (viewer = null)} label="close"><X size={15} /></IconButton>
			</div>
			<pre class="code">{viewer.content}</pre>
		</div>
	</div>
{/if}

<style>
	.files {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.crumb {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		direction: rtl;
		text-align: left;
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}
	.ent {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 7px 9px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.ent:hover {
		background: var(--surface2);
	}
	:global(.fcol) {
		color: var(--accent-bright);
	}
	.ename {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.empty,
	.err {
		padding: 16px;
		font-size: 12px;
		color: var(--dim2);
		text-align: center;
	}
	.err {
		font-family: var(--font-mono);
		color: var(--err);
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
		width: min(720px, 90vw);
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
	.code {
		margin: 0;
		padding: 14px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.55;
		white-space: pre;
		color: var(--text);
	}
</style>
