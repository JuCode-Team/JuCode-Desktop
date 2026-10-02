<script lang="ts">
	// One paired computer on the remote page: its list (sessions and desk) and
	// the pages opened over it, or, until its daemon has accepted this device,
	// a connecting / pair-again screen. The page keeps one mounted per
	// computer and hides all but the shown one, so each keeps its open pages
	// and their sessions keep streaming while another computer is shown.
	import { cubicOut } from 'svelte/easing';
	import type { Component, Snippet } from 'svelte';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import ListIcon from 'phosphor-svelte/lib/ListIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QrCodeIcon from 'phosphor-svelte/lib/QrCodeIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ChatsCircleIcon from 'phosphor-svelte/lib/ChatsCircleIcon';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import DispatchList from './DispatchList.svelte';
	import DispatchComposer from './DispatchComposer.svelte';
	import DispatchScreen from './DispatchScreen.svelte';
	import DeskList from './DeskList.svelte';
	import DeskHome from './DeskHome.svelte';
	import DeskItemScreen from './DeskItemScreen.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import type { AgentView } from '$lib/agents.svelte';
	import { t } from '$lib/i18n';
	import Projects from './Projects.svelte';
	import NewSessionDialog from './NewSessionDialog.svelte';
	import ProjectScreen from './ProjectScreen.svelte';
	import AddProjectScreen from './AddProjectScreen.svelte';
	import { baseName, type ProjectView } from './store.svelte';
	import { provideHost, type HostConnection } from './connection.svelte';

	/* eslint-disable @typescript-eslint/no-explicit-any -- lazily loaded components */
	let {
		conn,
		name,
		hostName,
		hidden,
		wide,
		screens,
		switcher,
		resizer,
		onAdd,
		onForget,
		onRepair
	}: {
		conn: HostConnection;
		/** The computer's name. */
		name: string;
		/** Its name on session pages, when several computers are paired. */
		hostName?: string;
		/** Another computer is shown. */
		hidden: boolean;
		wide: boolean;
		/** The heavy pages, once loaded. */
		screens: {
			RemoteSession: Component<any> | null;
			FilesScreen: Component<any> | null;
			ChangesScreen: Component<any> | null;
		};
		/** The computer switcher, in the list header. */
		switcher: Snippet;
		/** The list column's resize handle (wide screens). */
		resizer: Snippet;
		/** Opens pairing (to scan this computer's code again). */
		onAdd: () => void;
		onForget: (ask?: boolean) => void;
		/** LAN: pair this device again. */
		onRepair: () => void;
	} = $props();
	/* eslint-enable @typescript-eslint/no-explicit-any */

	// The view keeps its computer: the page mounts a new one when it changes.
	// svelte-ignore state_referenced_locally
	provideHost(conn);

	type Tab = 'projects' | 'dispatch' | 'desk';
	const TABS: Tab[] = ['projects', 'dispatch', 'desk'];
	let tab = $state<Tab>('projects');
	const TAB_TITLES = { projects: 'shell.remote.sessions', dispatch: 'shell.dispatch.title', desk: 'shell.desk.title' } as const;
	/** Pages opened over the tabs, last on top. */
	type Screen = { key: number } & (
		| { kind: 'session'; session?: string; agent?: string; cwd?: string; chat?: boolean; engine?: string; title: string }
		| { kind: 'project'; project: ProjectView }
		| { kind: 'add' }
		| { kind: 'files' | 'changes'; root: string; title: string }
		| { kind: 'dispatch'; id: string }
		| { kind: 'compose' }
		| { kind: 'desk'; item: string }
	);
	/** Each tab keeps its own pages: switching tabs on a wide page shows that
	 *  tab's pane as it was left (and keeps its sessions streaming). */
	let stacks = $state<Record<Tab, Screen[]>>({ projects: [], dispatch: [], desk: [] });
	const stack = $derived(stacks[tab]);
	let nextKey = 0;
	type NewScreen = Screen extends infer S ? (S extends Screen ? Omit<S, 'key'> : never) : never;
	function push(screen: NewScreen) {
		stacks[tab] = [...stacks[tab], { ...screen, key: nextKey++ } as Screen];
	}
	function pop() {
		stacks[tab] = stacks[tab].slice(0, -1);
	}
	/** Opens a page from the list: on a wide screen it replaces the right
	 *  pane's pages; on a phone it goes on top. */
	function open(screen: NewScreen) {
		if (wide) stacks[tab] = [];
		push(screen);
	}

	// Pages slide in from the right on a phone and fade in on a wide pane
	// (CSS, .layer); a page closed with back slides out the same way. On a wide
	// pane the old page is replaced at once, not cross-faded.
	const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	function layerOut(_node: Element) {
		if (wide || reducedMotion()) return { duration: 0 };
		return { duration: 200, easing: cubicOut, css: (t: number, u: number) => `transform: translateX(${u * 40}%); opacity: ${t}` };
	}

	/** The new-session dialog, for a given project or a choice of them. */
	let creating = $state<{ project?: ProjectView; replace: boolean } | null>(null);
	const ENGINE_TITLES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };
	function create(project: ProjectView, engine: string) {
		const replace = creating?.replace ?? true;
		creating = null;
		const screen: NewScreen = {
			kind: 'session',
			cwd: project.path,
			chat: project.chats,
			engine: engine === 'jucode' ? undefined : engine,
			title: ENGINE_TITLES[engine] ?? t('shell.remote.newSession')
		};
		if (replace) open(screen);
		else push(screen);
	}

	/** Past pairing and connected once: the lists and pages are showing. */
	const ready = $derived(conn.everConnected && !conn.relayError?.fatal);

	/** What the page on top shows, highlighted in its tab's list. */
	const top = $derived(stack.at(-1));
	const currentSession = $derived(top?.kind === 'session' ? top.session : undefined);
	const currentDispatch = $derived(top?.kind === 'dispatch' ? top.id : undefined);
	const currentDeskItem = $derived(top?.kind === 'desk' ? top.item : undefined);

	/** A daemon session's page, from what the daemon's list knows of it. */
	function sessionScreen(session: string, title?: string): NewScreen {
		const agent = conn.agents.agentOfSession(session);
		const known = conn.agents.sessions.find((s) => s.session === session);
		return {
			kind: 'session',
			session,
			cwd: known?.cwd,
			engine: known?.engine && known.engine !== 'jucode' ? known.engine : undefined,
			title: title ?? agent?.name ?? known?.title ?? session
		};
	}

	/** An agent's latest session, or a new one. */
	function agentScreen(id: string): NewScreen {
		const agent = conn.agents.agents.find((a) => a.id === id);
		const name = agent?.name ?? id;
		const latest = conn.agents.latestSession(id);
		return latest ? { kind: 'session', session: latest.session, title: name } : { kind: 'session', agent: id, title: name };
	}

	function openAgent(agent: AgentView) {
		open(agentScreen(agent.id));
	}
</script>

<div class="host" class:wide {hidden}>
	{#if conn.relayError?.fatal}
		<div class="pair">
			<div class="corner">{@render switcher()}</div>
			<span class="hero warn"><QrCodeIcon size={28} /></span>
			<h1>{t('shell.remote.relayFatalTitle')}</h1>
			<p>
				{conn.relayError.kind === 'pair-invalid' ? t('shell.remote.relayPairInvalid') : t('shell.remote.relayRevoked')}
			</p>
			<div class="actions">
				<Button variant="primary" onclick={onAdd}><QrCodeIcon size={16} /> {t('shell.remote.scanQr')}</Button>
				<Button variant="ghost" onclick={() => onForget(false)}>{t('shell.remote.forget')}</Button>
			</div>
		</div>
	{:else if !ready}
		<div class="pair">
			<div class="corner">{@render switcher()}</div>
			<span class="hero" class:warn={conn.state.tone === 'off'}>
				{#if conn.state.tone === 'wait'}<CircleNotchIcon size={28} class="spin" />{:else}<DesktopIcon size={28} />{/if}
			</span>
			<h1>{name}</h1>
			{#key conn.state.text}<p class="status">{t(conn.state.text)}</p>{/key}
			<div class="actions"><Button variant="ghost" size="sm" onclick={() => onForget()}>{t('shell.remote.forget')}</Button></div>
		</div>
	{:else}
		<aside class="side">
			<nav>
				<button class:on={tab === 'projects'} onclick={() => (tab = 'projects')}>
					<ListIcon size={18} weight={tab === 'projects' ? 'fill' : 'regular'} />
					<span class="label">{t('shell.remote.sessions')}</span>
				</button>
				<button class:on={tab === 'dispatch'} onclick={() => (tab = 'dispatch')}>
					<PaperPlaneTiltIcon size={18} weight={tab === 'dispatch' ? 'fill' : 'regular'} />
					<span class="label">{t('shell.dispatch.title')}</span>
					{#if conn.dispatches.pending > 0}<span class="badge">{conn.dispatches.pending}</span>{/if}
				</button>
				<button class:on={tab === 'desk'} onclick={() => (tab = 'desk')}>
					<TrayIcon size={18} weight={tab === 'desk' ? 'fill' : 'regular'} />
					<span class="label">{t('shell.desk.title')}</span>
					{#if conn.agents.pending > 0}<span class="badge">{conn.agents.pending}</span>{/if}
				</button>
			</nav>
			<!-- Outside the scrolling list, so the switcher's menu is not cut off. -->
			<div class="top">
				<h1>{t(TAB_TITLES[tab])}</h1>
				{@render switcher()}
			</div>
			<main>
				{#if conn.kind === 'lan' && conn.agents.status === 'unreachable'}
					<!-- The daemon served this page, so a failing connection most likely
					     means this device's token was revoked; offer to pair again. -->
					<div class="refused">
						<div class="refused-msg"><Notice tone="warn">{t('shell.remote.refused')}</Notice></div>
						<Button size="sm" onclick={onRepair}>{t('shell.remote.repair')}</Button>
					</div>
				{/if}
				<!-- Both tabs stay mounted so a switch keeps their scroll and
				     folded state; the shown one fades in. -->
				<div class="tabbody" hidden={tab !== 'projects'}>
					<Projects
						current={currentSession}
						onOpenSession={(s, project) =>
							open({
								kind: 'session',
								session: s.session,
								cwd: s.cwd,
								chat: project?.chats,
								engine: s.engine && s.engine !== 'jucode' ? s.engine : undefined,
								title: s.title || t('shell.remote.untitled')
							})}
						onNewSession={(project) => (creating = { project, replace: true })}
						onAddProject={() => open({ kind: 'add' })}
						onHistory={(project) => open({ kind: 'project', project })}
						onFiles={(project) => open({ kind: 'files', root: project.path, title: project.name })}
						onChanges={(project) => open({ kind: 'changes', root: project.path, title: project.name })}
						onOpenAgent={openAgent}
					/>
				</div>
				<div class="tabbody" hidden={tab !== 'dispatch'}>
					<DispatchList
						current={currentDispatch}
						composing={wide ? stacks.dispatch.length === 0 : false}
						onNew={() => (wide ? (stacks.dispatch = []) : push({ kind: 'compose' }))}
						onOpen={(d) => open({ kind: 'dispatch', id: d.id })}
					/>
				</div>
				<div class="tabbody" hidden={tab !== 'desk'}>
					<DeskList
						current={currentDeskItem}
						status={!wide}
						onOpen={(item) => open({ kind: 'desk', item })}
						onOpenAgent={(id) => open(agentScreen(id))}
					/>
				</div>
			</main>
			{#if wide}{@render resizer()}{/if}
		</aside>
		<section class="pane">
			<!-- With nothing opened from the list, a wide pane shows the tab's
			     own page: the composer, the desk's queue. -->
			{#if wide && stack.length === 0}
				{#if tab === 'dispatch'}
					<DispatchComposer onSent={(d) => open({ kind: 'dispatch', id: d.id })} />
				{:else if tab === 'desk'}
					<DeskHome onOpenSession={(s) => push(sessionScreen(s))} onOpenAgent={(id) => push(agentScreen(id))} />
				{:else}
					<div class="pane-empty">
						<ChatsCircleIcon size={32} />
						<p>{t('shell.remote.pickSomething')}</p>
					</div>
				{/if}
			{/if}
			{#each TABS as name (name)}
			{#each stacks[name] as screen, i (screen.key)}
				<div class="layer" hidden={name !== tab} style:z-index={20 + i} out:layerOut>
					{#if screen.kind === 'session'}
						{@const root = screen.cwd && !screen.chat && !screen.agent ? screen.cwd : null}
						{#if screens.RemoteSession}
							<screens.RemoteSession
								session={screen.session}
								agent={screen.agent}
								cwd={screen.cwd}
								chat={screen.chat}
								engine={screen.engine}
								title={screen.title}
								{hostName}
								register={conn.register}
								onBack={pop}
								onFiles={root ? () => push({ kind: 'files', root, title: baseName(root) }) : undefined}
								onChanges={root ? () => push({ kind: 'changes', root, title: baseName(root) }) : undefined}
							/>
						{:else}
							{@render loadingPage(screen.title)}
						{/if}
					{:else if screen.kind === 'project'}
						{@const project = screen.project}
						<ProjectScreen
							{project}
							onBack={pop}
							onOpenSession={(session, cwd, title, engine) =>
								push({ kind: 'session', session, cwd, chat: project.chats, engine, title })}
							onNewSession={() => (creating = { project, replace: false })}
							onFiles={() => push({ kind: 'files', root: project.path, title: project.name })}
							onChanges={() => push({ kind: 'changes', root: project.path, title: project.name })}
						/>
					{:else if screen.kind === 'add'}
						<AddProjectScreen onBack={pop} onAdded={pop} />
					{:else if screen.kind === 'dispatch'}
						{@const id = screen.id}
						<DispatchScreen
							{id}
							onBack={pop}
							onOpenSession={(session, title) => push(sessionScreen(session, title))}
							onOpenProcess={() => push({ kind: 'session', session: id, title: t('shell.dispatch.title') })}
						/>
					{:else if screen.kind === 'compose'}
						<DispatchComposer
							onBack={pop}
							onSent={(d) => {
								pop();
								push({ kind: 'dispatch', id: d.id });
							}}
						/>
					{:else if screen.kind === 'desk'}
						<DeskItemScreen
							key={screen.item}
							onBack={pop}
							onOpenSession={(s) => push(sessionScreen(s))}
							onOpenAgent={(id) => push(agentScreen(id))}
						/>
					{:else if screen.kind === 'files'}
						{#if screens.FilesScreen}
							<screens.FilesScreen root={screen.root} title={screen.title} onBack={pop} />
						{:else}
							{@render loadingPage(screen.title)}
						{/if}
					{:else if screens.ChangesScreen}
						<screens.ChangesScreen root={screen.root} title={screen.title} onBack={pop} />
					{:else}
						{@render loadingPage(screen.title)}
					{/if}
				</div>
			{/each}
			{/each}
		</section>
		{#if creating}
			<NewSessionDialog project={creating.project} onCreate={create} onClose={() => (creating = null)} />
		{/if}
	{/if}
</div>

{#snippet loadingPage(title: string)}
	<div class="loading-page">
		<header>
			<button class="back" onclick={pop} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={18} /></button>
			<span class="title">{title}</span>
		</header>
		<div class="loading-body"><CircleNotchIcon size={22} class="spin" /></div>
	</div>
{/snippet}

<style>
	/* The page's grid places the list and the pane; this box adds none. */
	.host {
		display: contents;
	}
	.host[hidden] {
		display: none;
	}
	.layer {
		position: fixed;
		inset: 0;
		animation: layer-in var(--t-med) var(--ease-out);
	}
	/* A page pushed on a phone slides in from the right. */
	@keyframes layer-in {
		from {
			transform: translateX(32%);
			opacity: 0;
		}
	}
	/* On a phone the pages cover the screen; the pane itself adds no box. */
	.pane {
		display: contents;
	}
	.pane-empty {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		color: var(--dim2);
		animation: fade var(--t-slow) var(--ease-out);
	}
	.pane-empty p {
		margin: 0;
		font-size: var(--fs-md);
	}
	/* Wide screens: the list in the page's resizable left column, pages in
	   the right one. The pane is the containing block of its fixed-position
	   pages (transform), so they fill it instead of the window. */
	.wide .side {
		position: relative;
		/* Above the pane: the switcher's menu opens over it. */
		z-index: 1;
		container: side / inline-size;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--hairline);
		background: var(--sidebar);
	}
	/* Wide: the tabs are one segmented control; a narrow column keeps only
	   their names. */
	.wide nav {
		position: static;
		gap: 2px;
		margin: calc(env(safe-area-inset-top) + 12px) 12px 4px;
		padding: 3px;
		border: none;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.wide nav button {
		min-width: 0;
		flex-direction: row;
		justify-content: center;
		gap: 6px;
		height: 30px;
		padding: 0 8px;
		border-radius: calc(var(--r-md) - 2px);
		font-size: var(--fs-sm);
	}
	.wide nav button:active {
		transform: none;
	}
	.wide nav button.on {
		background: var(--surface2);
		color: var(--text);
	}
	.wide nav .label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@container side (max-width: 320px) {
		.wide nav button > :global(svg) {
			display: none;
		}
	}
	.wide .badge {
		position: static;
	}
	.wide main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 12px 24px;
	}
	.wide .pane {
		display: flex;
		position: relative;
		min-width: 0;
		transform: translateZ(0);
		overflow: hidden;
	}
	/* Pages on a wide pane replace each other: a quick fade, no slide. */
	.wide .layer {
		animation-name: pane-in;
	}
	main {
		padding: 0 16px calc(env(safe-area-inset-bottom) + 76px);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: calc(env(safe-area-inset-top) + 16px) 16px 10px;
	}
	.wide .top {
		padding: 10px 12px 10px 16px;
	}
	.top h1 {
		flex: 1 0 auto;
		margin: 0;
	}
	.wide .top h1 {
		font-size: var(--fs-lg);
	}
	.tabbody:not([hidden]) {
		animation: rise var(--t-med) var(--ease-out);
	}
	h1 {
		margin: 4px 0 8px;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.refused {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		animation: rise var(--t-med) var(--ease-out);
	}
	.refused-msg {
		flex: 1;
		min-width: 0;
	}
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: flex;
		padding: 6px 0 calc(env(safe-area-inset-bottom) + 6px);
		border-top: 1px solid var(--hairline);
		background: var(--panel);
	}
	nav button {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 6px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-2xs);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	nav button:hover {
		color: var(--text);
	}
	nav button:active {
		transform: scale(0.94);
	}
	nav button.on {
		color: var(--accent-bright);
	}
	.badge {
		position: absolute;
		top: 0;
		left: calc(50% + 8px);
		min-width: 16px;
		padding: 0 4px;
		border-radius: var(--r-full);
		background: var(--warn);
		color: #000;
		font-size: var(--fs-2xs);
		line-height: 16px;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	/* Connecting and pair-again: one centered column across the page, with
	   the switcher in the corner. */
	.pair {
		position: relative;
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		max-width: 420px;
		width: 100%;
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px);
		text-align: center;
		animation: rise var(--t-slow) var(--ease-out);
	}
	.corner {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 12px);
		right: 16px;
	}
	.pair h1 {
		margin: 8px 0 4px;
	}
	.pair p {
		margin: 6px 0 0;
		font-size: var(--fs-md);
		color: var(--dim);
		line-height: 1.55;
	}
	.pair .status {
		animation: fade var(--t-med) var(--ease-out);
	}
	.hero {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		margin-bottom: 8px;
		border-radius: var(--r-lg);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		color: var(--accent-bright);
		transition: color var(--t-med) var(--ease-out);
	}
	.hero.warn {
		color: var(--warn);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 24px;
	}
	.loading-page {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	.loading-page header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: calc(env(safe-area-inset-top) + 8px) 12px 8px;
		border-bottom: 1px solid var(--hairline);
		background: var(--panel);
	}
	.loading-page .back {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
	}
	.loading-page .title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: var(--fs-lg);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.loading-body {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--dim);
	}
</style>
