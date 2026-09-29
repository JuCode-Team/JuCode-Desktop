<script lang="ts">
	import { onMount } from 'svelte';
	import { Folder, FileText, ArrowUp, RefreshCw } from 'lucide-svelte';
	import { projectRoot, listDir, type FsEntry } from '$lib/protocol';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

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
			entries = await listDir(path, root || rootDir || path);
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
			// Text files open in the built-in editor pane; binary/oversized files
			// keep the lightweight preview overlay (which reports why, as before).
			try {
				await editorStore.open(e.path, root);
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
		<div class="err"><Notice mono>{error}</Notice></div>
	{:else}
		<div class="list">
			{#each entries as e (e.path)}
				<button class="ent" onclick={() => open(e)}>
					{#if e.is_dir}<Folder size={15} class="fcol" />{:else}<FileText size={15} />{/if}
					<span class="ename">{e.name}</span>
				</button>
			{/each}
			{#if entries.length === 0}<div class="empty">{t('dock.files.empty')}</div>{/if}
		</div>
	{/if}
</div>

{#if viewer}
	<Modal title={viewer.name} width={720} padded={false} onClose={() => (viewer = null)}>
		<pre class="code">{viewer.content}</pre>
	</Modal>
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
		font-size: var(--fs-xs);
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
		font-size: var(--fs-sm);
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
	.empty {
		padding: 16px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		text-align: center;
	}
	.err {
		padding: 10px;
	}
	.code {
		margin: 0;
		padding: 14px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: 1.55;
		white-space: pre;
		color: var(--text);
	}
</style>
