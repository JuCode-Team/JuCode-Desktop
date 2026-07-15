<script lang="ts">
	import { Plus, History, X, LoaderCircle, GitBranch, GitBranchPlus, Archive, ArchiveRestore, ChevronRight, Settings } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import { BACKEND_LABELS } from '$lib/backends';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import type { Project } from '$lib/types';

	let {
		projects,
		activeId,
		width,
		resizing = false,
		loggedIn,
		providerName,
		updateAvailable = false,
		onSelect,
		onNewProject,
		onNewSession,
		onNewTask,
		onCloseSession,
		onCloseProject,
		onArchiveSession,
		onUnarchiveSession,
		onHistory,
		onSettings
	}: {
		projects: Project[];
		activeId: string;
		width: number;
		/** True while the user drags the resizer — disables the width transition. */
		resizing?: boolean;
		loggedIn: boolean;
		providerName: string;
		updateAvailable?: boolean;
		onSelect: (id: string) => void;
		onNewProject: () => void;
		onNewSession: (p: Project) => void;
		onNewTask: (p: Project) => void;
		onCloseSession: (id: string) => void;
		onCloseProject: (p: Project) => void;
		onArchiveSession: (id: string) => void;
		onUnarchiveSession: (id: string) => void;
		onHistory: (p: Project) => void;
		onSettings: () => void;
	} = $props();

	// Which projects have their archived section expanded (collapsed by default).
	let showArchived = $state<Record<string, boolean>>({});

	// "New session" targets the active session's project (fallback: first project);
	// with no project open it falls through to the new-project flow.
	function newSessionHere() {
		const p = projects.find((pr) => pr.sessions.some((s) => s.id === activeId)) ?? projects[0];
		if (p) onNewSession(p);
		else onNewProject();
	}
</script>

<aside class="sidebar" class:resizing style:width="{width}px">
	<div class="brand" data-tauri-drag-region>
		<span class="word">JuCode</span>
	</div>

	<div class="nav">
		<button class="navcard" onclick={newSessionHere}><Plus size={14} /><span>{t('shell.newSession')}</span></button>
	</div>

	<div class="sess-head">
		<span>{t('shell.sessionsByProject')}</span>
		<div class="sess-actions">
			<button onclick={onNewProject} aria-label="new project" title={t('shell.newProjectTitle')}><Plus size={15} /></button>
		</div>
	</div>

	{#snippet sessRow(s: Project['sessions'][number])}
		<button class="sess" class:on={s.id === activeId} class:arch={s.archived} onclick={() => onSelect(s.id)}>
			<span class="sess-dot" class:busy={s.chat.busy} class:err={s.chat.engineState === 'exited'} class:unseen={s.chat.unseen && !s.chat.busy} class:attn={!!(s.chat.pendingApproval || s.chat.trustPrompt)} title={s.chat.pendingApproval || s.chat.trustPrompt ? t('shell.awaitConfirm') : ''}></span>
			<span class="sess-title">{s.chat.title}</span>
			{#if s.backendId && s.backendId !== 'jucode'}
				<!-- engine-backend badge (only when not the native engine) -->
				<span class="backend-chip" title={BACKEND_LABELS[s.backendId]}>
					<BackendIcon backend={s.backendId} size={11} />{BACKEND_LABELS[s.backendId].split(' ')[0]}
				</span>
			{/if}
			{#if s.chat.busy}<LoaderCircle size={12} class="spin" />{/if}
			<span
				class="sess-act"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					s.archived ? onUnarchiveSession(s.id) : onArchiveSession(s.id);
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), s.archived ? onUnarchiveSession(s.id) : onArchiveSession(s.id))}
				aria-label={s.archived ? 'unarchive' : 'archive'}
				title={s.archived ? t('shell.unarchive') : t('shell.archive')}
			>
				{#if s.archived}<ArchiveRestore size={12} />{:else}<Archive size={12} />{/if}
			</span>
			<span
				class="sess-x"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					onCloseSession(s.id);
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onCloseSession(s.id))}
				aria-label="close"><X size={12} /></span
			>
		</button>
	{/snippet}

	<div class="sess-list">
		{#each projects as p (p.id)}
			<div class="group">
				{#if p.worktree}
					<!-- 并行任务 worktree 项目：分支角标 + 「task/<slug> ← base」提示 -->
					<span class="wt-mark" class:stale={p.stale} title={t('shell.task.worktreeTip', { branch: p.worktree.branch, base: p.worktree.baseBranch || '?' })}>
						<GitBranch size={11} />
					</span>
				{/if}
				<span class="group-name" title={p.worktree ? t('shell.task.worktreeTip', { branch: p.worktree.branch, base: p.worktree.baseBranch || '?' }) : p.path}>{p.name}</span>
				{#if p.stale}
					<span class="stale-badge" title={p.path}>{t('shell.task.stale')}</span>
				{:else}
					<span class="group-count">{p.sessions.length}</span>
					<button class="group-add" onclick={() => onHistory(p)} aria-label="history" title={t('shell.history')}><History size={13} /></button>
					{#if !p.worktree}
						<button class="group-add no-auto" onclick={() => onNewTask(p)} aria-label="new parallel task" title={t('shell.newTask')}><GitBranchPlus size={13} /></button>
					{/if}
					<button class="group-add no-auto" onclick={() => onNewSession(p)} aria-label="new session" title={t('shell.newSessionInProject')}><Plus size={13} /></button>
				{/if}
				{#if projects.length > 1 || p.stale}
					<button class="group-x" class:always={p.stale} onclick={() => onCloseProject(p)} aria-label="close project" title={p.stale ? t('shell.task.staleRemove') : t('shell.closeProject')}><X size={12} /></button>
				{/if}
			</div>
			{@const active = p.sessions.filter((s) => !s.archived)}
			{@const arch = p.sessions.filter((s) => s.archived)}
			{#each active as s (s.id)}
				{@render sessRow(s)}
			{/each}
			{#if active.length === 0 && arch.length === 0 && !p.stale}
				<button class="sess-empty" onclick={() => onNewSession(p)}>{t('shell.newSession')}</button>
			{/if}
			{#if arch.length}
				<button class="arch-head" onclick={() => (showArchived[p.id] = !showArchived[p.id])}>
					<span class="arch-chev" class:open={showArchived[p.id]}><ChevronRight size={12} /></span>
					<Archive size={11} />
					<span>{t('shell.archived')} · {arch.length}</span>
				</button>
				{#if showArchived[p.id]}
					{#each arch as s (s.id)}
						{@render sessRow(s)}
					{/each}
				{/if}
			{/if}
		{/each}
	</div>

	<button class="account" onclick={onSettings} title={t('shell.accountSettings')}>
		<Settings size={14} class="acc-gear" />
		<span class="acc-dot" class:on={loggedIn}></span>
		<span class="acc-name">{loggedIn ? providerName : t('shell.notLoggedIn')}</span>
		<span class="acc-go">{t('shell.settings')}</span>
		{#if updateAvailable}<span class="upd-dot" title={t('shell.updateAvailable')}></span>{/if}
	</button>
</aside>

<style>
	.sidebar {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--sidebar);
		border-right: 1px solid var(--hairline);
		min-width: 0;
		overflow: hidden;
		transition: width var(--t-med) var(--ease-out);
	}
	.sidebar.resizing {
		transition: none;
	}
	/* Under macOS vibrancy the sidebar becomes translucent so the native frost
	 * shows through; everywhere else it stays fully opaque. */
	:global(:root[data-vibrancy='on']) .sidebar {
		background: var(--vibrancy-tint);
	}
	/* Bottom-left settings entry. */
	.account {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 8px 10px 10px;
		padding: 9px 11px;
		border: none;
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		font-size: 12px;
		transition: background var(--t-fast) var(--ease-out);
	}
	.account:hover {
		background: var(--surface2);
	}
	.account :global(.acc-gear) {
		color: var(--dim);
		flex-shrink: 0;
	}
	.acc-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.acc-dot.on {
		background: var(--ok);
	}
	.acc-name {
		flex: 1;
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}
	.acc-go {
		color: var(--dim2);
		font-size: 11px;
	}
	/* 有新版本时设置入口右侧的小圆点 */
	.upd-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent-bright);
		box-shadow: 0 0 0 3px var(--accent-soft);
		flex-shrink: 0;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		/* extra top inset clears the macOS traffic lights + sidebar-toggle row */
		padding: 48px 18px 12px;
	}
	.word {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 17px;
		letter-spacing: -0.01em;
	}
	.nav {
		display: flex;
		gap: 6px;
		padding: 0 14px 10px;
	}
	.navcard {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 7px 0;
		border-radius: var(--r-md);
		border: none;
		background: var(--surface);
		color: var(--dim);
		font-size: 12px;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.navcard:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.navcard:active {
		transform: scale(0.97);
	}
	.sess-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 16px 8px;
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.sess-actions {
		display: flex;
		gap: 4px;
	}
	.sess-actions button {
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: 6px;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.sess-actions button:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 8px 6px;
	}
	.group-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* 并行任务 worktree 项目的分支角标 */
	.wt-mark {
		display: inline-flex;
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.wt-mark.stale {
		color: var(--dim2);
	}
	.stale-badge {
		font-size: 10px;
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 14%, transparent);
		border-radius: 999px;
		padding: 1px 7px;
		flex-shrink: 0;
	}
	.group-x.always {
		opacity: 1;
		margin-left: auto;
	}
	.group-count {
		font-size: 10px;
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 999px;
		padding: 1px 7px;
		flex-shrink: 0;
	}
	.group-add,
	.group-x {
		display: inline-flex;
		padding: 3px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: 5px;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0;
		transition:
			opacity var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.group-add {
		margin-left: auto;
	}
	.group-add.no-auto {
		margin-left: 0;
	}
	.group:hover .group-add,
	.group:hover .group-x {
		opacity: 1;
	}
	.group-add:hover,
	.group-x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-empty {
		display: block;
		width: 100%;
		text-align: left;
		padding: 7px 12px;
		margin-left: 2px;
		border: none;
		background: none;
		color: var(--dim2);
		font-size: 12px;
		cursor: pointer;
		border-radius: var(--r-md);
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.sess-empty:hover {
		background: var(--surface);
		color: var(--text);
	}
	.sess {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
		transition: background var(--t-fast) var(--ease-out);
	}
	.sess:hover {
		background: var(--surface);
	}
	.sess.on {
		background: var(--surface2);
	}
	.sess-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.sess-dot.busy {
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.sess-dot.err {
		background: var(--err);
	}
	.sess-dot.unseen {
		background: var(--accent-bright);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	/* Defined last so a pending approval/trust wins over busy/unseen. */
	.sess-dot.attn {
		background: var(--warn);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--warn) 24%, transparent);
		animation: none;
	}
	.sess-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* 非 jucode 引擎的小角标 */
	.backend-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		padding: 1px 7px 1px 5px;
		flex-shrink: 0;
	}
	.sess-x,
	.sess-act {
		display: inline-flex;
		color: var(--dim2);
		opacity: 0;
		border-radius: 4px;
		transition: opacity var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.sess:hover .sess-x,
	.sess:hover .sess-act {
		opacity: 1;
	}
	.sess-x:hover,
	.sess-act:hover {
		color: var(--text);
	}
	.sess.arch .sess-title {
		color: var(--dim);
	}
	/* Collapsible "Archived · n" header per project. */
	.arch-head {
		display: flex;
		align-items: center;
		gap: 5px;
		width: 100%;
		padding: 4px 10px 4px 14px;
		border: none;
		background: none;
		color: var(--dim2);
		font-size: 11.5px;
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.arch-head:hover {
		color: var(--text);
	}
	.arch-chev {
		display: inline-flex;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.arch-chev.open {
		transform: rotate(90deg);
	}
	</style>
