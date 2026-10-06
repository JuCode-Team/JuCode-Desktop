<script lang="ts">
	// The workbench: a page over the content panel, like Settings. The nav
	// lists the overview, the requirements, the scheduled tasks and every
	// agent with what it is doing, the shown agent with its sessions under it;
	// the main column shows the overview (DeskContent), the requirements (one
	// of them, or the list), the scheduled tasks, one agent's page, or one of
	// its sessions (`chatView`, rendered by the page).
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlankIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import type { Snippet } from 'svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import AgentPage from '$lib/AgentPage.svelte';
	import DeskContent from '$lib/DeskContent.svelte';
	import ScheduleBoard from '$lib/ScheduleBoard.svelte';
	import RequirementBoard from '$lib/requirements/RequirementBoard.svelte';
	import RequirementDetail from '$lib/requirements/RequirementDetail.svelte';
	import type { StartHow } from '$lib/requirements/StartButton.svelte';
	import { needsYou, useRequirements, type Requirement } from '$lib/requirements.svelte';
	import { agentDirectory, agentsOfWorkspace, agentWorkspace, type AgentView } from '$lib/agents.svelte';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import { t } from '$lib/i18n';

	let {
		agentId = $bindable(null),
		sessionId = $bindable(null),
		page = $bindable('overview'),
		requirementId = $bindable(null),
		openSid = null,
		chatView,
		navWidth,
		projects,
		currentProject,
		captureSignal = 0,
		currentStep,
		onClose,
		onOpenSession,
		onNewAgent,
		onNewSession,
		onStartRequirement
	}: {
		/** The agent shown; null for the overview. */
		agentId?: string | null;
		/** The desktop session shown in the main column (one of the agent's). */
		sessionId?: string | null;
		/** With no agent shown: the overview, the requirements or the
		 *  scheduled tasks. */
		page?: 'overview' | 'requirements' | 'schedules';
		/** The requirement shown on the requirements page; null for the list. */
		requirementId?: string | null;
		/** The daemon session `sessionId` is, for the nav's highlight. */
		openSid?: string | null;
		/** A desktop session's chat pane. */
		chatView: Snippet<[string]>;
		navWidth: number;
		/** The open workspace's projects: its requirements are those about them
		 *  (or about none), and sessions start in them. */
		projects: { id: string; path: string; name: string }[];
		/** The open project's id: new requirements are noted in it. */
		currentProject?: string;
		/** Bumped to focus the box that notes an idea. */
		captureSignal?: number;
		/** What a running session is doing now, when this computer shows it. */
		currentStep?: (session: string) => string | undefined;
		onClose: () => void;
		/** `agent`: whose it is, when the caller knows (the list may lag). */
		onOpenSession: (session: string, agent?: string) => void;
		onNewAgent: () => void;
		/** Open a new, empty session of the agent. */
		onNewSession: (agent: AgentView) => void;
		onStartRequirement: (r: Requirement, how: StartHow) => void;
	} = $props();

	const reqs = useRequirements();
	const projectIds = $derived(new Set(projects.map((p) => p.id)));
	/** The open workspace's requirements: about its projects, or about none. */
	const shownReqs = $derived(reqs.list.filter((r) => !r.project || projectIds.has(r.project)));
	/** An agent's project, by name (any workspace's). */
	function projectName(id: string | null | undefined): string {
		if (!id) return '';
		return (
			projects.find((p) => p.id === id)?.name ??
			workspaces.workspaces.flatMap((w) => w.projects).find((p) => p.id === id)?.name ??
			''
		);
	}
	const yourTurn = $derived(
		shownReqs.filter(needsYou).sort((a, b) => b.updated_at - a.updated_at)
	);
	const shownReq = $derived(requirementId ? reqs.get(requirementId) : undefined);
	function openRequirement(id: string | null) {
		page = 'requirements';
		requirementId = id;
		agentId = null;
		sessionId = null;
	}
	/** J: the next requirement on the user's turn (outside text fields). */
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'j' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
		const el = e.target as HTMLElement | null;
		if (el?.closest('input, textarea, [contenteditable="true"]')) return;
		if (sessionId || agentId || !yourTurn.length) return;
		e.preventDefault();
		const i = yourTurn.findIndex((r) => r.id === requirementId);
		openRequirement(yourTurn[(i + 1) % yourTurn.length].id);
	}

	const shown = $derived(agentId ? agentDirectory.agents.find((a) => a.id === agentId) : undefined);
	/** The agents listed: the open workspace's, or every agent. */
	let showAll = $state(false);
	const listed = $derived(
		showAll ? agentDirectory.agents : agentsOfWorkspace(agentDirectory.agents, workspaces.workspaces, workspaces.activeId)
	);
	const listedIds = $derived(listed.map((a) => a.id));
	const pending = $derived(listed.reduce((n, a) => n + agentDirectory.pendingFor(a.id), 0) + yourTurn.length);
	const workspaceName = (a: AgentView) =>
		workspaces.workspaces.find((w) => w.id === agentWorkspace(a, workspaces.workspaces))?.name ?? '';
	/** The shown agent's sessions, most recently active first. */
	const shownSessions = $derived(
		shown
			? agentDirectory.sessions
					.filter((s) => s.agent === shown.id)
					.sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at))
			: []
	);

	const scheduleCount = $derived(agentDirectory.schedules.filter((s) => s.enabled && listedIds.includes(s.agent)).length);
	const onOverview = $derived(!shown && page === 'overview');
	const onSchedules = $derived(!shown && page === 'schedules');
	const onRequirements = $derived(!shown && !sessionId && page === 'requirements');
	function openPage(p: typeof page) {
		page = p;
		agentId = null;
		sessionId = null;
		requirementId = null;
	}
	function openAgent(id: string) {
		agentId = id;
		sessionId = null;
	}

	function nextRun(agent: string): number | null {
		const runs = agentDirectory.schedules
			.filter((s) => s.agent === agent && s.enabled && s.next_run_at)
			.map((s) => s.next_run_at! * 1000);
		return runs.length ? Math.min(...runs) : null;
	}

	/** `summary`: fall back to the role's first line when nothing else applies. */
	function status(agent: AgentView, summary = true): string {
		if (!agent.enabled) return t('shell.desk.statusOff');
		if (agent.busy) return t('shell.desk.statusWorking');
		const next = nextRun(agent.id);
		if (next)
			return t('shell.desk.statusNext', {
				time: new Date(next).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
			});
		return (summary && agent.summary) || t('shell.desk.statusIdle');
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="desk-page">
	<nav class="nav" style:width="{navWidth}px" aria-label={t('shell.desk.title')}>
		<div class="nav-head">
			<button class="back" title={t('shell.desk.back')} aria-label={t('shell.desk.back')} onclick={onClose}>
				<ArrowLeftIcon size={18} />
			</button>
			<h2>{t('shell.desk.title')}</h2>
		</div>
		<div class="nav-list">
			<button class="item" class:on={onOverview} aria-current={onOverview ? 'page' : undefined} onclick={() => openPage('overview')}>
				<TrayIcon size={18} weight={onOverview ? 'fill' : 'regular'} />
				<span class="label">{t('shell.desk.overview')}</span>
				{#if pending}<span class="badge">{pending}</span>{/if}
			</button>
			<button class="item" class:on={onRequirements} aria-current={onRequirements ? 'page' : undefined} onclick={() => openPage('requirements')}>
				<ListChecksIcon size={18} weight={onRequirements ? 'fill' : 'regular'} />
				<span class="label">{t('shell.requirement.title')}</span>
				{#if yourTurn.length}<span class="badge">{yourTurn.length}</span>{/if}
			</button>
			<button class="item" class:on={onSchedules} aria-current={onSchedules ? 'page' : undefined} onclick={() => openPage('schedules')}>
				<CalendarBlankIcon size={18} weight={onSchedules ? 'fill' : 'regular'} />
				<span class="label">{t('shell.schedule.title')}</span>
				{#if scheduleCount}<span class="count">{scheduleCount}</span>{/if}
			</button>
			<div class="group-label">
				<span>{showAll ? t('shell.agents.allTitle') : t('shell.agents.title')}</span>
				<span class="grow"></span>
				<button class="scope" class:on={showAll} aria-pressed={showAll} onclick={() => (showAll = !showAll)} title={t('shell.agents.allHint')}>
					{t('shell.agents.all')}
				</button>
				<button class="add" onclick={onNewAgent} aria-label={t('shell.agents.add')} title={t('shell.agents.add')}><PlusIcon size={14} /></button>
			</div>
			{#each listed as a (a.id)}
				{@const waiting = agentDirectory.pendingFor(a.id)}
				<button class="item agent" class:on={shown?.id === a.id && !sessionId} class:off={!a.enabled} onclick={() => openAgent(a.id)}>
					<AgentAvatar agent={a} size={22} />
					<span class="two">
						<span class="label">{a.name}</span>
						<span class="sub" class:live={a.busy && a.enabled}>{[showAll ? workspaceName(a) : '', projectName(a.project), status(a)].filter(Boolean).join(' · ')}</span>
					</span>
					{#if waiting}<span class="badge" title={t('shell.desk.pendingFor', { n: waiting })}>{waiting}</span>
					{:else if a.busy && a.enabled}<CircleNotchIcon size={14} class="spin busy" />{/if}
				</button>
				{#if shown?.id === a.id}
					{#each shownSessions as s (s.session)}
						<button class="item sess" class:on={!!sessionId && openSid === s.session} onclick={() => onOpenSession(s.session, a.id)}>
							<span class="label">{s.title || t('shell.agentPage.untitled')}</span>
							{#if a.running?.includes(s.session)}<CircleNotchIcon size={12} class="spin busy" />{/if}
						</button>
					{/each}
				{/if}
			{:else}
				<button class="item ghost" onclick={onNewAgent}><PlusIcon size={16} /><span class="label">{t('shell.agents.add')}</span></button>
			{/each}
		</div>
	</nav>

	<div class="main" class:chat={!!sessionId}>
		{#if sessionId}
			{@render chatView(sessionId)}
		{:else if shown}
			{#key shown.id}
				<div class="col">
					<AgentPage
						agentId={shown.id}
						{projects}
						onDeleted={() => (agentId = null)}
						onOpenSession={(session) => onOpenSession(session, shown.id)}
						onOpenAgent={openAgent}
						onNewSession={() => onNewSession(shown)}
					/>
				</div>
			{/key}
		{:else if page === 'schedules'}
			<div class="col">
				<ScheduleBoard agents={listed} {onOpenSession} onOpenAgent={openAgent} />
			</div>
		{:else if page === 'requirements'}
			{#if shownReq}
				<div class="col wide">
					{#key shownReq.id}
						<RequirementDetail
							requirement={shownReq}
							{projects}
							onBack={() => (requirementId = null)}
							onStart={onStartRequirement}
							onOpenSession={(s) => onOpenSession(s)}
						/>
					{/key}
				</div>
			{:else}
				<div class="col">
					<RequirementBoard
						list={shownReqs}
						{projects}
						{currentProject}
						focusSignal={captureSignal}
						{currentStep}
						onOpen={openRequirement}
						onStart={onStartRequirement}
					/>
				</div>
			{/if}
		{:else}
			<div class="col">
				<h1>{t('shell.desk.title')}</h1>
				<p class="lede">{t('shell.desk.subtitle')}</p>
				{#if listed.length}
					<div class="roster">
						{#each listed as a (a.id)}
							{@const waiting = agentDirectory.pendingFor(a.id)}
							<button class="card" class:off={!a.enabled} onclick={() => openAgent(a.id)}>
								<span class="card-head">
									<AgentAvatar agent={a} size={28} />
									<span class="card-name">{a.name}</span>
									{#if projectName(a.project)}<span class="card-project">{projectName(a.project)}</span>{/if}
									{#if waiting}<span class="badge">{waiting}</span>{/if}
								</span>
								<span class="card-status" class:live={a.busy && a.enabled}>
									{#if a.busy && a.enabled}<CircleNotchIcon size={12} class="spin" />{/if}{status(a, false)}
								</span>
								{#if a.summary}<span class="card-role">{a.summary}</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
				<DeskContent agents={listedIds} {onOpenSession} onOpenAgent={openAgent} requirements={yourTurn} onOpenRequirement={openRequirement} />
			</div>
		{/if}
	</div>
</div>

<style>
	/* Covers the content panel, as Settings does. */
	.desk-page {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		min-width: 0;
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.nav {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--sidebar);
	}
	:global(:root[data-vibrancy='on']) .nav {
		background: var(--vibrancy-tint);
	}
	.nav-head {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 40px;
		margin: 14px 12px 8px;
	}
	.nav-head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--text);
	}
	.back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.back:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.nav-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 12px 16px;
	}
	.group-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 6px 6px 12px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.grow {
		flex: 1;
	}
	.scope {
		margin-right: 2px;
		padding: 1px 7px;
		border: 1px solid transparent;
		border-radius: var(--r-full);
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-2xs);
		cursor: pointer;
	}
	.scope:hover {
		color: var(--text);
	}
	.scope.on {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.add:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 36px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.item.agent {
		padding-top: 7px;
		padding-bottom: 7px;
	}
	.item > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.item:hover,
	.item.on {
		background: var(--surface2);
	}
	.item.on > :global(svg) {
		color: var(--text);
	}
	.item.off .label,
	.item.off > :global(.avatar) {
		opacity: 0.55;
	}
	.item.ghost {
		color: var(--dim);
	}
	.two {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub.live {
		color: var(--accent-bright);
	}
	.badge {
		flex: none;
		min-width: 20px;
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--accent);
		color: var(--on-accent);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 20px;
		text-align: center;
	}
	.count {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	/* An agent's sessions, indented under it. */
	.item.sess {
		min-height: 30px;
		padding-left: 44px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.item.sess.on {
		color: var(--text);
	}
	.item :global(.busy) {
		color: var(--accent-bright);
	}

	.main {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		background: var(--bg);
	}
	/* A session fills the column; its chat pane scrolls itself. */
	.main.chat {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.col {
		max-width: 760px;
		margin: 0 auto;
		padding: 56px 32px 80px;
		animation: rise var(--t-med) var(--ease-out);
	}
	/* A requirement's two columns. */
	.col.wide {
		max-width: 1120px;
		padding-top: 40px;
	}
	h1 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
	}
	.roster {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 10px;
		margin-bottom: 18px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.card:hover {
		border-color: var(--border);
	}
	.card.off {
		opacity: 0.6;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.card-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.card-project {
		flex: none;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.card-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.card-status.live {
		color: var(--accent-bright);
	}
	.card-role {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim2);
	}
	.lede {
		margin: 10px 0 22px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
</style>
