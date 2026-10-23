<script lang="ts">
	// The title bar's project menu: the button shows the branch and the
	// uncommitted line counts; the menu holds the folder (shown in Finder), the
	// external editor, the branch, commit / push / pull and the changes (the
	// Git panel). Without a repository only the folder and the editor show.
	import { onMount } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import FileDiffIcon from '@lucide/svelte/icons/file-diff';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { t } from '$lib/i18n';
	import { git } from '$lib/protocol';
	import { parseNumstat, parseSyncStatus, type SyncInfo } from '$lib/gitops';
	import { editors } from '$lib/editors.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { overBrowser } from '$lib/browser.svelte';
	import { popOut } from '$lib/ui/motion';
	import DiffStat from '$lib/DiffStat.svelte';
	import BranchMenu from '$lib/composer/BranchMenu.svelte';
	import { isMac } from '$lib/shortcuts';

	let { path, name, onOpenGit }: { path: string; name: string; onOpenGit: () => void } = $props();

	let open = $state(false);
	let editorList = $state(false);
	let branchOpen = $state(false);
	/** null: not a repository (or not read yet). */
	let branch = $state<string | null>(null);
	let sync = $state<SyncInfo>({ upstream: null, ahead: 0, behind: 0 });
	let add = $state(0);
	let del = $state(0);
	/** Files with changes (tracked and new). */
	let files = $state(0);
	let syncBusy = $state<'' | 'push' | 'pull'>('');

	const editor = $derived(editors.preferred);
	const revealLabel = isMac() ? 'chat.fileMenu.revealMac' : /Windows/.test(navigator.userAgent) ? 'chat.fileMenu.revealWin' : 'chat.fileMenu.revealLinux';
	const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
	const short = (p: string) => p.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');

	// Its own reads only: the git calls are cheap, and a stale answer for a
	// folder switched away from is dropped.
	let reading = 0;
	async function read() {
		const dir = path;
		const n = ++reading;
		try {
			const current = (await git(['branch', '--show-current'], dir)).trim();
			const [status, stat, porcelain] = await Promise.all([
				git(['status', '-sb'], dir),
				git(['diff', 'HEAD', '--numstat', '--no-color'], dir).catch(() => git(['diff', '--numstat', '--no-color'], dir)),
				git(['status', '--porcelain=v1'], dir)
			]);
			if (n !== reading) return;
			const counts = parseNumstat(stat).filter((f) => f.added >= 0);
			branch = current || 'HEAD';
			sync = parseSyncStatus(status);
			add = counts.reduce((s, f) => s + f.added, 0);
			del = counts.reduce((s, f) => s + f.removed, 0);
			files = porcelain.split('\n').filter(Boolean).length;
		} catch {
			if (n === reading) branch = null;
		}
	}

	onMount(() => {
		void editors.load();
		// Agents change files and branches outside: read again on focus and
		// now and then.
		const onFocus = () => void read();
		window.addEventListener('focus', onFocus);
		const timer = setInterval(read, 20_000);
		return () => {
			window.removeEventListener('focus', onFocus);
			clearInterval(timer);
		};
	});
	$effect(() => {
		void path;
		void read();
	});

	function toggle() {
		open = !open;
		editorList = false;
		branchOpen = false;
		if (open) void read();
	}
	function close() {
		open = false;
		editorList = false;
		branchOpen = false;
	}
	async function openEditor(id: string) {
		close();
		const label = editors.list.find((e) => e.id === id)?.name ?? id;
		await editors.open(id, path).catch((e) => toast.error(t('editor.external.failed', { name: label, error: String(e) })));
	}
	function reveal() {
		close();
		revealItemInDir(path).catch((e) => toast.error(String(e)));
	}
	function openGit() {
		close();
		onOpenGit();
	}
	async function syncWith(kind: 'push' | 'pull') {
		if (syncBusy || !branch) return;
		syncBusy = kind;
		try {
			if (kind === 'pull') await git(['pull', '--ff-only'], path);
			else if (sync.upstream) await git(['push'], path);
			else await git(['push', '-u', 'origin', branch], path);
			toast.success(t(kind === 'push' ? 'shell.projectMenu.pushed' : 'shell.projectMenu.pulled'));
		} catch (e) {
			toast.error(String(e).trim());
		} finally {
			syncBusy = '';
			void read();
		}
	}
	// Push: commits ahead, or a branch with no upstream yet.
	const canPush = $derived(!!branch && branch !== 'HEAD' && (sync.ahead > 0 || !sync.upstream));
</script>

<div class="anchor">
	<button class="trigger" class:on={open} onclick={toggle} aria-haspopup="menu" aria-expanded={open} title={t('shell.projectMenu.title')} aria-label={t('shell.projectMenu.title')}>
		{#if branch !== null}
			<GitBranchIcon size={15} />
			<span class="tname">{branch}</span>
			{#if add || del}<DiffStat {add} {del} />{/if}
		{:else}
			<FolderIcon size={15} />
			<span class="tname">{name || base(path)}</span>
		{/if}
		<ChevronDownIcon size={12} />
	</button>

	{#if open}
		<button class="backdrop" aria-label={t('common.close')} tabindex="-1" onclick={close}></button>
		<div use:overBrowser class="pop menu" role="menu" out:popOut={{ y: -3 }}>
			<button class="pop-row two" role="menuitem" onclick={reveal} title={t(revealLabel)}>
				<span class="pop-ico"><FolderIcon size={18} /></span>
				<span class="pop-txt"><span class="pop-label">{name || base(path)}</span><span class="pop-desc">{short(path)}</span></span>
			</button>
			{#if editor}
				<div class="split">
					<button class="pop-row" role="menuitem" onclick={() => openEditor(editor.id)}>
						<span class="pop-ico">{#if editor.icon}<img src={editor.icon} alt="" width="18" height="18" />{:else}<CodeXmlIcon size={18} />{/if}</span>
						<span class="pop-txt"><span class="pop-label">{t('editor.external.openIn', { name: editor.name })}</span></span>
					</button>
					<button class="more" class:on={editorList} onclick={() => (editorList = !editorList)} aria-expanded={editorList} aria-label={t('editor.external.choose')} title={t('editor.external.choose')}>
						<ChevronDownIcon size={14} />
					</button>
				</div>
				{#if editorList}
					<div class="sub">
						{#each editors.list as e (e.id)}
							<button class="pop-row" role="menuitemradio" aria-checked={e.id === editor.id} onclick={() => openEditor(e.id)}>
								<span class="pop-ico">{#if e.icon}<img src={e.icon} alt="" width="18" height="18" />{:else}<CodeXmlIcon size={18} />{/if}</span>
								<span class="pop-txt"><span class="pop-label">{e.name}</span></span>
								{#if e.id === editor.id}<span class="pop-check"><CheckIcon size={16} /></span>{/if}
							</button>
						{/each}
					</div>
				{/if}
			{/if}

			{#if branch !== null}
				<div class="sep"></div>
				<div class="split branch">
					<button class="pop-row" role="menuitem" onclick={() => (branchOpen = !branchOpen)} aria-expanded={branchOpen}>
						<span class="pop-ico"><GitBranchIcon size={18} /></span>
						<span class="pop-txt"><span class="pop-label bname" title={branch}>{branch}</span></span>
						{#if sync.behind || sync.ahead}<span class="pop-hint">{sync.ahead ? `↑${sync.ahead}` : ''}{sync.behind ? ` ↓${sync.behind}` : ''}</span>{/if}
						<span class="pop-hint"><ChevronDownIcon size={14} /></span>
					</button>
					{#if branchOpen}
						<BranchMenu
							cwd={path}
							repo={name || base(path)}
							current={branch}
							down
							onChanged={() => void read()}
							onClose={() => (branchOpen = false)}
						/>
					{/if}
				</div>
				<button class="pop-row" role="menuitem" onclick={openGit}>
					<span class="pop-ico"><GitCommitHorizontalIcon size={18} /></span>
					<span class="pop-txt"><span class="pop-label">{t('shell.projectMenu.commit')}</span></span>
					{#if files}<span class="pop-hint">{t('shell.projectMenu.files', { n: files })}</span>{/if}
				</button>
				{#if canPush}
					<button class="pop-row" role="menuitem" disabled={!!syncBusy} onclick={() => syncWith('push')}>
						<span class="pop-ico">{#if syncBusy === 'push'}<LoaderCircleIcon size={18} class="spin" />{:else}<ArrowUpIcon size={18} />{/if}</span>
						<span class="pop-txt"><span class="pop-label">{sync.upstream ? t('shell.projectMenu.push', { n: sync.ahead }) : t('shell.projectMenu.publish')}</span></span>
					</button>
				{/if}
				{#if sync.behind}
					<button class="pop-row" role="menuitem" disabled={!!syncBusy} onclick={() => syncWith('pull')}>
						<span class="pop-ico">{#if syncBusy === 'pull'}<LoaderCircleIcon size={18} class="spin" />{:else}<ArrowDownIcon size={18} />{/if}</span>
						<span class="pop-txt"><span class="pop-label">{t('shell.projectMenu.pull', { n: sync.behind })}</span></span>
					</button>
				{/if}
				<button class="pop-row" role="menuitem" onclick={openGit}>
					<span class="pop-ico"><FileDiffIcon size={18} /></span>
					<span class="pop-txt"><span class="pop-label">{t('shell.projectMenu.changes')}</span></span>
					{#if add || del}<DiffStat {add} {del} />{:else}<span class="pop-hint">{t('shell.projectMenu.clean')}</span>{/if}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.anchor {
		position: relative;
		display: inline-flex;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		max-width: 320px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.trigger:hover,
	.trigger.on {
		background: var(--surface2);
		color: var(--text);
	}
	.tname {
		min-width: 0;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 81;
		width: 320px;
		max-width: calc(100vw - 32px);
		transform-origin: top right;
		animation: pop-in var(--t-med) var(--ease-out);
	}
	.split {
		position: relative;
		display: flex;
		align-items: center;
	}
	.split > .pop-row {
		flex: 1;
		min-width: 0;
	}
	.more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		margin-left: 2px;
		border: none;
		border-left: 1px solid var(--hairline);
		border-radius: 0 var(--r) var(--r) 0;
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.more:hover,
	.more.on {
		color: var(--text);
		background: var(--surface2);
	}
	.sub {
		padding-left: 12px;
	}
	.sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--hairline);
	}
	.bname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.branch :global(.bm) {
		width: 100%;
	}
</style>
