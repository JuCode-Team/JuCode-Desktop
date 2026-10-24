<script lang="ts">
	// A new conversation not started yet, as one sentence: "in <place>
	// with <agent>", each a menu. The place is the project and, when it is
	// not the project's own folder, the folder inside it. In a git
	// repository a third menu says where in it: its checkout, a new worktree
	// from a branch (made with the first message, as t3code does), or a
	// worktree made before. The choices are only recorded until the first
	// message starts the engine there (SessionStore.moveDraft / setDraftCwd /
	// setDraftWorktree / useWorktree / switchBackend).
	import { open } from '@tauri-apps/plugin-dialog';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import GitBranchPlusIcon from '@lucide/svelte/icons/git-branch-plus';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { git, worktreeBase, worktreeBaseOf } from '$lib/protocol';
	import { parseBranches, parseWorktreeList, taskWorktrees, type TaskWorktree } from '$lib/gitops';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { BACKEND_LABELS, NATIVE_BACKEND_IDS, type BackendId } from '$lib/backends';
	import type { SessionStore } from '$lib/session.svelte';
	import { LOOSE_ID, type Session } from '$lib/types';
	import { agentCatalog } from '$lib/agentCatalog.svelte';

	let { store, session }: { store: SessionStore; session: Session } = $props();

	const OPEN_FOLDER = '\u0000open';
	// Menu keys: a project's id, or DIR + a folder of the current project.
	const DIR = '\u0000dir:';
	let menu = $state<'place' | 'backend' | 'where' | null>(null);
	const projects = $derived(store.workspaceProjects.filter((p) => !p.stale));
	const current = $derived(store.ownerOf(session.id));
	const cwd = $derived(session.cwd || current?.path || '');
	const trim = (x: string) => x.replace(/[\\/]+$/, '');
	const same = (a: string, b: string) => trim(a) === trim(b);
	const base = (path: string) => trim(path).split(/[\\/]/).pop() || path;
	// The home directory as ~, as a terminal shows it.
	const short = (path: string) => path.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
	const inProject = $derived(!!current && !current.loose);
	/** The current project's other folders, and the one picked. */
	const subdirs = $derived(inProject ? [...new Set([...(current!.dirs ?? []), cwd])].filter((d) => d && !same(d, current!.path)) : []);
	const label = $derived(inProject ? (same(cwd, current!.path) ? current!.name : `${current!.name} / ${base(cwd)}`) : base(cwd) || t('shell.noProject'));
	const items = $derived([
		...projects.flatMap((p) => [
			{ key: p.id, label: p.name, desc: short(p.path), icon: FolderIcon, checked: p.id === current?.id && same(cwd, p.path) },
			...(p.id === current?.id ? subdirs.map((d) => ({ key: DIR + d, label: `${p.name} / ${base(d)}`, desc: short(d), icon: FolderOpenIcon, checked: same(d, cwd) })) : [])
		]),
		{ key: LOOSE_ID, label: t('shell.noProject'), desc: current?.loose ? short(cwd) : undefined, checked: !!current?.loose },
		{ key: OPEN_FOLDER, label: t('shell.startPicker.openFolder'), icon: FolderPlusIcon }
	]);
	// The sentence around the two menus, in the UI language's word order.
	const parts = $derived(t('shell.startPicker.lead').split(/(\{place\}|\{backend\})/));

	async function pickPlace(key: string) {
		menu = null;
		if (key.startsWith(DIR)) return store.setDraftCwd(session.id, key.slice(DIR.length));
		if (key !== OPEN_FOLDER) {
			store.moveDraft(session.id, key);
			// The same project again: back to its own folder.
			if (key === current?.id && inProject) store.setDraftCwd(session.id, current.path);
			return;
		}
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		// A folder of the current project, or anywhere for a conversation of
		// no project: it works there. Elsewhere the folder is a project
		// (an existing one, or added).
		if (current?.loose || (inProject && [current!.path, ...(current!.dirs ?? [])].some((d) => same(d, path)))) return store.setDraftCwd(session.id, path);
		if (!store.projects.some((p) => !p.loose && same(p.path, path))) store.addProjectShell({ id: store.uid(), name: base(path), path });
		const target = store.projects.find((p) => !p.loose && same(p.path, path));
		if (target) store.moveDraft(session.id, target.id);
	}
	// Where in the repository: read once the project is known (a project
	// that is no git repository has no third menu).
	let repo = $state<{ path: string; current: string; branches: string[]; worktrees: TaskWorktree[] } | null>(null);
	$effect(() => {
		const path = inProject && !current!.worktree ? current!.path : '';
		repo = null;
		if (!path) return;
		let gone = false;
		(async () => {
			try {
				const [now, list, base, trees] = await Promise.all([
					git(['branch', '--show-current'], path),
					git(['branch', '--format=%(refname:short)'], path),
					worktreeBase(path),
					git(['worktree', 'list', '--porcelain'], path)
				]);
				if (!gone) repo = { path, current: now.trim(), branches: parseBranches(list), worktrees: taskWorktrees(parseWorktreeList(trees), base) };
			} catch {
				/* no repository */
			}
		})();
		return () => (gone = true);
	});
	const NEW = '\u0000new:';
	const TREE = '\u0000tree:';
	const whereLabel = $derived(
		session.draftWorktree
			? t('shell.startPicker.newWorktree', { base: session.draftWorktree.base })
			: session.worktree
				? session.worktree.slug
				: t('shell.startPicker.checkout')
	);
	const whereItems = $derived(
		repo
			? [
					{ key: '', label: t('shell.startPicker.checkout'), desc: repo.current, icon: MonitorIcon, checked: !session.draftWorktree && !session.worktree },
					// The current branch first, then the others.
					...[repo.current, ...repo.branches.filter((b) => b !== repo!.current)]
						.filter(Boolean)
						.slice(0, 8)
						.map((b) => ({ key: NEW + b, label: t('shell.startPicker.newWorktree', { base: b }), icon: GitBranchPlusIcon, checked: session.draftWorktree?.base === b })),
					...repo.worktrees
						.filter((w) => w.branch)
						.map((w) => ({ key: TREE + w.path, label: w.slug, desc: w.branch ?? '', icon: FolderGit2Icon, checked: !!session.cwd && same(session.cwd, w.path) }))
				]
			: []
	);
	async function pickWhere(key: string) {
		menu = null;
		if (!key) return store.setDraftWorktree(session.id, null);
		if (key.startsWith(NEW)) return store.setDraftWorktree(session.id, key.slice(NEW.length));
		const tree = repo?.worktrees.find((w) => w.path === key.slice(TREE.length));
		if (!tree?.branch || !repo) return;
		const base = (await worktreeBaseOf(repo.path, tree.branch).catch(() => null)) ?? repo.current;
		store.useWorktree(session.id, tree.path, { isWorktree: true, mainRepoPath: repo.path, branch: tree.branch, baseBranch: base, slug: tree.slug });
	}

	// The agents: the native backends, then the ACP presets and the agents
	// the user registered (agentCatalog: known at once, checked again here).
	const ACP = '\u0000acp:';
	const PRESET = '\u0000preset:';
	$effect(() => void agentCatalog.refresh());
	const agentItems = $derived([
		...NATIVE_BACKEND_IDS.map((id) => ({ key: id, label: BACKEND_LABELS[id], checked: id === session.backendId, disabled: agentCatalog.native[id]?.found === false })),
		...agentCatalog.presets.map((p) => ({
			key: PRESET + p.id,
			label: p.name,
			desc: p.status === 'ready' ? (p.approvals ? (p.version ?? undefined) : t('chat.noApproval')) : p.status === 'missing' ? t('settings.acp.notInstalled') : t('settings.acp.tooOld', { min: p.min_version ?? '' }),
			disabled: p.status !== 'ready',
			checked: session.backendId === 'acp' && session.chat.acpAgentId === p.id
		})),
		...agentCatalog.agents.map((a) => ({ key: ACP + a.id, label: a.name, checked: session.backendId === 'acp' && session.chat.acpAgentId === a.id }))
	]);
	const agentLabel = $derived(session.backendId === 'acp' ? session.chat.acpAgentName || BACKEND_LABELS.acp : BACKEND_LABELS[session.backendId]);
	function pickBackend(key: string) {
		menu = null;
		if (key.startsWith(PRESET)) {
			const p = agentCatalog.presets.find((x) => x.id === key.slice(PRESET.length));
			if (p) store.switchBackend(session.id, 'acp', { id: p.id, name: p.name, preset: true });
		} else if (key.startsWith(ACP)) {
			const a = agentCatalog.agents.find((x) => x.id === key.slice(ACP.length));
			if (a) store.switchBackend(session.id, 'acp', { id: a.id, name: a.name });
		} else store.switchBackend(session.id, key as BackendId);
	}
</script>

<p class="lead">
	{#each parts as part, i (i)}
		{#if part === '{place}'}
			<span class="anchor">
				<button class="word" class:on={menu === 'place'} onclick={() => (menu = menu === 'place' ? null : 'place')} aria-haspopup="menu" aria-expanded={menu === 'place'} title={cwd} aria-label={t('shell.startPicker.project')}>
					<FolderIcon size={16} />
					<span class="wname">{label}</span>
					<ChevronDownIcon size={12} />
				</button>
				{#if menu === 'place'}
					<PopMenu placement="down-left" {items} onSelect={pickPlace} onClose={() => (menu = null)} />
				{/if}
			</span>
		{:else if part === '{backend}'}
			<span class="anchor">
				<button class="word" class:on={menu === 'backend'} onclick={() => (menu = menu === 'backend' ? null : 'backend')} aria-haspopup="menu" aria-expanded={menu === 'backend'} aria-label={t('shell.startPicker.backend')}>
					<BackendIcon backend={session.backendId} agent={session.chat.acpAgentId} size={14} />
					<span class="wname">{agentLabel}</span>
					<ChevronDownIcon size={12} />
				</button>
				{#if menu === 'backend'}
					<PopMenu placement="down-left" items={agentItems} onSelect={pickBackend} onClose={() => (menu = null)} />
				{/if}
			</span>
		{:else}{part}{/if}
	{/each}
	{#if repo}
		<span class="anchor">
			<button class="word" class:on={menu === 'where'} onclick={() => (menu = menu === 'where' ? null : 'where')} aria-haspopup="menu" aria-expanded={menu === 'where'} aria-label={t('shell.startPicker.where')} title={t('shell.startPicker.where')}>
				{#if session.draftWorktree}<GitBranchPlusIcon size={14} />{:else if session.worktree}<FolderGit2Icon size={14} />{:else}<MonitorIcon size={14} />{/if}
				<span class="wname">{whereLabel}</span>
				<ChevronDownIcon size={12} />
			</button>
			{#if menu === 'where'}
				<PopMenu placement="down-left" items={whereItems} title={t('shell.startPicker.where')} onSelect={pickWhere} onClose={() => (menu = null)} />
			{/if}
		</span>
	{/if}
</p>

<style>
	/* The welcome line itself: the same size and colour as the hint it
	   replaces; the two choices read as words in it. */
	.lead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 2px;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-md);
		white-space: pre-wrap;
	}
	.anchor {
		position: relative;
		display: inline-flex;
		text-align: left;
	}
	.word {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 260px;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.word:hover,
	.word.on {
		background: var(--surface2);
	}
	.word:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.word > :global(svg:last-child) {
		color: var(--dim2);
	}
	.wname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
