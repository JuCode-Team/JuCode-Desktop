<script lang="ts">
	import ActiveIcon from '$lib/icons/ActiveIcon.svelte';
	// One paired computer on the remote page: its lists (sessions, what
	// waits for the user) and the pages opened over it, or, until its daemon has accepted this device,
	// a connecting / pair-again screen. The page keeps one mounted per
	// computer and hides all but the shown one, so each keeps its open pages
	// and their sessions keep streaming while another computer is shown.
	import { cubicOut } from 'svelte/easing';
	import { untrack, type Component, type Snippet } from 'svelte';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import DeskList from './DeskList.svelte';
	import DeskItemScreen from './DeskItemScreen.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import Projects from './Projects.svelte';
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
		chatHref,
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
		/** The computer switcher: in the list header, or (`true`) the wide
		 *  sidebar's foot. */
		switcher: Snippet<[boolean?]>;
		/** The web app's chat (app.jucode.net): a way back to it in the sidebar. */
		chatHref?: string;
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

	type Tab = 'projects' | 'desk';
	const TABS: Tab[] = ['projects', 'desk'];
	let tab = $state<Tab>('projects');
	const TAB_TITLES = {
		projects: 'shell.remote.sessions',
		desk: 'shell.desk.pending'
	} as const;
	/** Pages opened over the tabs, last on top. */
	type Screen = { key: number } & (
		| { kind: 'session'; session?: string; cwd?: string; chat?: boolean; engine?: string; agent?: string; title: string }
		| { kind: 'project'; project: ProjectView }
		| { kind: 'add' }
		| { kind: 'files' | 'changes'; root: string; title: string; file?: string; line?: number }
		| { kind: 'desk'; action: string }
	);
	/** Each tab keeps its own pages: switching tabs on a wide page shows that
	 *  tab's pane as it was left (and keeps its sessions streaming). */
	let stacks = $state<Record<Tab, Screen[]>>({ projects: [], desk: [] });
	const stack = $derived(stacks[tab]);
	let nextKey = 0;
	type NewScreen = Screen extends infer S ? (S extends Screen ? Omit<S, 'key'> : never) : never;
	// Each page opened over a tab is a browser history entry, so the system
	// back (Android's button, a swipe) goes back a page rather than leaving
	// the app; the page's own back button goes through history too.
	function push(screen: NewScreen) {
		stacks[tab] = [...stacks[tab], { ...screen, key: nextKey++ } as Screen];
		history.pushState({ jucodePage: true }, '');
	}
	function pop() {
		if (history.state?.jucodePage) history.back();
		else drop();
	}
	function drop() {
		stacks[tab] = stacks[tab].slice(0, -1);
	}
	function onPopState() {
		if (!hidden && stacks[tab].length) drop();
	}
	/** Opens a page from the list: on a wide screen it replaces the right
	 *  pane's pages; on a phone it goes on top. */
	function open(screen: NewScreen) {
		if (wide && stacks[tab].length) {
			stacks[tab] = [{ ...screen, key: nextKey++ } as Screen];
			return;
		}
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

	/** A new session: its empty page, where the project and the engine are
	 *  picked and the first message creates it (as on the desktop). It starts
	 *  in `project`, else where the last one did, else the first project. */
	function newSession(project?: ProjectView, replace = true) {
		const projects = conn.projects.active?.projects ?? [];
		const last = localStorage.getItem(`jucode-remote-last-project:${conn.id}`);
		const start = project ?? projects.find((p) => p.path === last && !p.chats) ?? projects.find((p) => !p.chats) ?? projects[0];
		if (!start) {
			push({ kind: 'add' });
			return;
		}
		const screen: NewScreen = { kind: 'session', cwd: start.path, chat: start.chats, title: t('shell.remote.newSession') };
		if (replace) open(screen);
		else push(screen);
	}
	// Another workspace: a new session waiting on the wide pane starts over
	// in that workspace's projects.
	let shownWorkspace = '';
	$effect(() => {
		const ws = conn.projects.active?.id ?? '';
		if (ws === shownWorkspace) return;
		const was = shownWorkspace;
		shownWorkspace = ws;
		untrack(() => {
			const draft = stacks.projects.at(-1);
			if (was && wide && draft?.kind === 'session' && !draft.session) newSession();
		});
	});
	/** The new session's page moved to another project or engine. */
	function picked(screen: Screen, where: { cwd: string; chat: boolean; engine?: string; agent?: string }) {
		if (screen.kind !== 'session') return;
		Object.assign(screen, where);
		if (!where.chat) localStorage.setItem(`jucode-remote-last-project:${conn.id}`, where.cwd);
	}

	/** Past pairing and connected once: the lists and pages are showing. */
	const ready = $derived(conn.everConnected && !conn.relayError?.fatal);
	// A wide pane with nothing open on the sessions tab shows a new session,
	// ready to type in, as the desktop does.
	$effect(() => {
		if (!wide || hidden || !ready || tab !== 'projects' || stacks.projects.length) return;
		if (!(conn.projects.active?.projects ?? []).length) return;
		untrack(() => newSession());
	});

	/** What the page on top shows, highlighted in its tab's list. */
	const top = $derived(stack.at(-1));
	const currentSession = $derived(top?.kind === 'session' ? top.session : undefined);
	const currentAction = $derived(top?.kind === 'desk' ? top.action : undefined);

	/** A daemon session's page, from what the daemon's list knows of it. */
	function sessionScreen(session: string, title?: string): NewScreen {
		const known = conn.daemonState.sessions.find((s) => s.session === session);
		return {
			kind: 'session',
			session,
			cwd: known?.cwd,
			engine: known?.engine && known.engine !== 'jucode' ? known.engine : undefined,
			agent: known?.agent ?? undefined,
			title: title ?? known?.title ?? session
		};
	}
</script>

<svelte:window onpopstate={onPopState} />

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
				{#if conn.state.tone === 'wait'}<LoaderCircleIcon size={28} class="spin" />{:else}<MonitorIcon size={28} />{/if}
			</span>
			<h1>{name}</h1>
			{#key conn.state.text}<p class="status">{t(conn.state.text)}</p>{/key}
			<div class="actions"><Button variant="ghost" size="sm" onclick={() => onForget()}>{t('shell.remote.forget')}</Button></div>
		</div>
	{:else}
		<aside class="side">
			<!-- Wide: the computer first (everything below is on it), then its
			     sections in one row; the sessions section starts with the
			     workspace and a new session (Projects). -->
			{#if wide}<div class="head">{@render switcher(true)}</div>{/if}
			<nav>
				<button class:on={tab === 'projects'} onclick={() => (tab = 'projects')} title={t('shell.remote.sessions')}>
					<ActiveIcon icon={MenuIcon} size={16} active={tab === 'projects'} />
					<span class="label">{t('shell.remote.sessions')}</span>
				</button>
				<button class:on={tab === 'desk'} onclick={() => (tab = 'desk')} title={t('shell.desk.pending')}>
					<ActiveIcon icon={InboxIcon} size={16} active={tab === 'desk'} />
					<span class="label">{t('shell.desk.pending')}</span>
					{#if conn.daemonState.actions.length > 0}<span class="badge">{conn.daemonState.actions.length}</span>{/if}
				</button>
			</nav>
			<!-- Outside the scrolling list, so the switcher's menu is not cut off. -->
			{#if !wide}
				<div class="top">
					<h1>{t(TAB_TITLES[tab])}</h1>
					{@render switcher()}
				</div>
			{/if}
			<main>
				{#if conn.kind === 'lan' && conn.daemonState.status === 'unreachable'}
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
								agent: s.agent ?? undefined,
								title: s.title || t('shell.remote.untitled')
							})}
						onNewSession={(project) => newSession(project)}
						onAddProject={() => open({ kind: 'add' })}
						onHistory={(project) => open({ kind: 'project', project })}
						onFiles={(project) => open({ kind: 'files', root: project.path, title: project.name })}
						onChanges={(project) => open({ kind: 'changes', root: project.path, title: project.name })}
					/>
				</div>
				<div class="tabbody" hidden={tab !== 'desk'}>
					<DeskList current={currentAction} onOpen={(action) => open({ kind: 'desk', action })} />
				</div>
			</main>
			{#if wide}
				{#if chatHref}
					<div class="foot">
						<!-- Another app: a full page load, not a route change. -->
						<a class="chat" href={chatHref} data-sveltekit-reload>
							<ArrowLeftIcon size={16} />
							<span>{t('shell.remote.backToChat')}</span>
						</a>
					</div>
				{/if}
				{@render resizer()}
			{/if}
		</aside>
		<section class="pane">
			<!-- With nothing opened from the list, a wide pane offers a new
			     session. -->
			{#if wide && stack.length === 0}
				<div class="pane-empty">
					<h1>{t('shell.remote.pickSomething')}</h1>
					<button class="start" onclick={() => newSession()}><PlusIcon size={16} />{t('shell.remote.newSession')}</button>
				</div>
			{/if}
			{#each TABS as name (name)}
			{#each stacks[name] as screen, i (screen.key)}
				<div class="layer" hidden={name !== tab} style:z-index={20 + i} out:layerOut>
					{#if screen.kind === 'session'}
						{@const root = screen.cwd && !screen.chat ? screen.cwd : null}
						{#if screens.RemoteSession}
							<screens.RemoteSession
								session={screen.session}
								cwd={screen.cwd}
								chat={screen.chat}
								engine={screen.engine}
								agent={screen.agent}
								title={screen.title}
								{hostName}
								register={conn.register}
								onBack={wide && i === 0 ? undefined : pop}
								onFiles={root ? () => push({ kind: 'files', root, title: baseName(root) }) : undefined}
								onFile={root ? (file: string, line?: number) => push({ kind: 'files', root, title: baseName(root), file, line }) : undefined}
								onChanges={root ? () => push({ kind: 'changes', root, title: baseName(root) }) : undefined}
								onPick={(where: { cwd: string; chat: boolean; engine?: string; agent?: string }) => picked(screen, where)}
								active={!hidden && name === tab && i === stacks[name].length - 1}
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
							onNewSession={() => newSession(project, false)}
							onFiles={() => push({ kind: 'files', root: project.path, title: project.name })}
							onChanges={() => push({ kind: 'changes', root: project.path, title: project.name })}
						/>
					{:else if screen.kind === 'add'}
						<AddProjectScreen onBack={pop} onAdded={pop} />
					{:else if screen.kind === 'desk'}
						<DeskItemScreen id={screen.action} onBack={pop} onOpenSession={(s) => push(sessionScreen(s))} />
					{:else if screen.kind === 'files'}
						{#if screens.FilesScreen}
							<screens.FilesScreen root={screen.root} title={screen.title} file={screen.file} line={screen.line} onBack={pop} />
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
	{/if}
</div>

{#snippet loadingPage(title: string)}
	<div class="loading-page">
		<header>
			<button class="back" onclick={pop} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={16} /></button>
			<span class="title">{title}</span>
		</header>
		<div class="loading-body"><LoaderCircleIcon size={20} class="spin" /></div>
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
		gap: 22px;
		padding-bottom: 12vh;
		animation: fade var(--t-slow) var(--ease-out);
	}
	.pane-empty h1 {
		margin: 0;
		font-size: var(--fs-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		text-align: center;
	}
	.start {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 16px;
		border: none;
		border-radius: var(--r);
		background: var(--text);
		color: var(--bg);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 500;
		cursor: pointer;
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
	/* Wide: the computer, then its sections as one row of tabs. */
	.head {
		padding: calc(env(safe-area-inset-top) + 10px) 8px 4px;
	}
	.wide nav {
		position: static;
		flex-direction: row;
		gap: 2px;
		padding: 4px 8px 8px;
		border: none;
		background: none;
	}
	.wide nav button {
		flex: 1 1 auto;
		min-width: 0;
		flex-direction: row;
		justify-content: center;
		gap: 4px;
		height: 32px;
		padding: 0 6px;
		border-radius: var(--r);
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.wide nav :global(svg) {
		display: none;
	}
	.wide nav button:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.wide nav button:active {
		transform: none;
	}
	.wide nav button.on {
		background: var(--surface2);
		color: var(--text);
		font-weight: 500;
	}
	.wide nav .label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wide .badge {
		position: static;
		flex-shrink: 0;
		animation: none;
	}
	/* A narrow sidebar: the tabs as icons (their names in the title). */
	@container side (width < 330px) {
		.wide nav .label {
			display: none;
		}
		.wide nav :global(svg) {
			display: block;
		}
	}
	.foot {
		padding: 8px;
		border-top: 1px solid var(--hairline);
	}
	.chat {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 36px;
		padding: 0 10px;
		border-radius: var(--r);
		color: var(--dim);
		font-size: var(--fs-sm);
		text-decoration: none;
	}
	.chat:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.wide main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 12px 24px;
		border-top: 1px solid var(--hairline);
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
		border-radius: var(--r);
		background: var(--warn);
		color: #000;
		font-size: var(--fs-2xs);
		line-height: 16px;
		animation: pop-in var(--t-med) var(--ease-out);
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
		border-radius: var(--r);
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
		border-radius: var(--r);
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
