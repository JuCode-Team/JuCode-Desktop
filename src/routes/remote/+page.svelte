<script lang="ts">
	// The remote control page for a phone's browser: pair once, then the desk,
	// the agents and their sessions. Two ways to reach the computer:
	// - LAN: the daemon served this page; pair with a code for a device token.
	// - Relay: the PWA at app.jucode.net; a `#pair=` link names the computer
	//   and the connection runs end-to-end encrypted through the relay.
	import { onMount, type Component } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { dev } from '$app/environment';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QrCodeIcon from 'phosphor-svelte/lib/QrCodeIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import ListIcon from 'phosphor-svelte/lib/ListIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import ScrollIcon from 'phosphor-svelte/lib/ScrollIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ChatsCircleIcon from 'phosphor-svelte/lib/ChatsCircleIcon';
	import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobileIcon';
	import DeskContent from '$lib/DeskContent.svelte';
	import Projects from '$lib/remote/Projects.svelte';
	import NewSessionDialog from '$lib/remote/NewSessionDialog.svelte';
	import ProjectScreen from '$lib/remote/ProjectScreen.svelte';
	import AddProjectScreen from '$lib/remote/AddProjectScreen.svelte';
	import { remoteProjects, baseName, type ProjectView } from '$lib/remote/store.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import Toaster from '$lib/ui/Toaster.svelte';
	import ConfirmHost from '$lib/ui/ConfirmHost.svelte';
	import { agentDirectory, type AgentView } from '$lib/agents.svelte';
	import { daemon, setDaemonEndpoint } from '$lib/protocol';
	import { deviceName, forgetRemoteToken, pairDevice, remoteEndpoint, remoteToken } from '$lib/remote';
	import {
		deviceKey,
		forgetHost,
		hostStaticKey,
		loadHost,
		parsePairLink,
		saveHost,
		type RelayHost
	} from '$lib/relay/pairing';
	import { RelayError, RelaySocket } from '$lib/relay/socket';
	import { t } from '$lib/i18n';

	// The heavy pages (a conversation with markdown and highlighting, the file
	// viewer, the QR scanner) load after the list is up, so the first screen
	// only waits for what it shows.
	/* eslint-disable @typescript-eslint/no-explicit-any -- lazily loaded components */
	let RemoteSession = $state<Component<any> | null>(null);
	let FilesScreen = $state<Component<any> | null>(null);
	let ChangesScreen = $state<Component<any> | null>(null);
	let QrScanner = $state<Component<any> | null>(null);
	/* eslint-enable @typescript-eslint/no-explicit-any */
	function loadScreens() {
		import('$lib/RemoteSession.svelte').then((m) => (RemoteSession = m.default));
		import('$lib/remote/FilesScreen.svelte').then((m) => (FilesScreen = m.default));
		import('$lib/remote/ChangesScreen.svelte').then((m) => (ChangesScreen = m.default));
	}
	function loadScanner() {
		import('$lib/relay/QrScanner.svelte').then((m) => (QrScanner = m.default));
	}

	/** `scan`: the relay PWA with no computer paired yet. */
	let mode = $state<'lan' | 'relay' | 'scan' | 'install' | null>(null);
	// iPhone/iPad Safari: a home-screen app has its own storage, so pairing in
	// the browser would not carry over. Offer to add it first; the code is only
	// used if the user chooses to stay in the browser.
	let pendingLink = $state<ReturnType<typeof parsePairLink>>(null);
	const isIos = () =>
		/iPhone|iPad|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const isStandalone = () =>
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	// Pairing from inside the app: the in-app scanner or a pasted link.
	let scanning = $state(false);
	let pasted = $state('');
	let linkError = $state('');
	function openScanner() {
		scanning = true;
		loadScanner();
	}
	function acceptLink(text: string) {
		scanning = false;
		const link = parsePairLink(text.trim());
		if (!link) {
			linkError = t('shell.remote.badLink');
			return;
		}
		linkError = '';
		pasted = '';
		relayError = null;
		saveHost(link.host);
		startRelay(link.host, link.code);
	}
	function continueInBrowser() {
		const link = pendingLink;
		pendingLink = null;
		if (!link) return;
		saveHost(link.host);
		startRelay(link.host, link.code);
	}
	let token = $state<string | null>(null);
	let code = $state('');
	let pairing = $state(false);
	let pairError = $state('');
	let tab = $state<'projects' | 'desk'>('projects');
	/** Pages opened over the tabs, last on top. */
	type Screen = { key: number } & (
		| { kind: 'session'; session?: string; agent?: string; cwd?: string; chat?: boolean; engine?: string; title: string }
		| { kind: 'project'; project: ProjectView }
		| { kind: 'add' }
		| { kind: 'files' | 'changes'; root: string; title: string }
	);
	let stack = $state<Screen[]>([]);
	let nextKey = 0;
	type NewScreen = Screen extends infer S ? (S extends Screen ? Omit<S, 'key'> : never) : never;
	function push(screen: NewScreen) {
		stack = [...stack, { ...screen, key: nextKey++ } as Screen];
	}
	function pop() {
		stack = stack.slice(0, -1);
	}
	/** Wide screens: the list on the left, the open page on the right. */
	let wide = $state(false);
	$effect(() => {
		const query = matchMedia('(min-width: 960px)');
		wide = query.matches;
		const change = () => (wide = query.matches);
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	});
	/** Opens a page from the list: on a wide screen it replaces the right
	 *  pane's pages; on a phone it goes on top. */
	function open(screen: NewScreen) {
		if (wide) stack = [];
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

	// Wide screens: the list column is resizable, like the desktop sidebar.
	const SIDE_MIN = 260;
	const SIDE_MAX = 560;
	const SIDE_DEFAULT = 340;
	const SIDE_KEY = 'jucode-remote-sidebar-width';
	let sideWidth = $state(SIDE_DEFAULT);
	let resizing = $state(false);
	function startResize(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		const startX = e.clientX;
		const startW = sideWidth;
		resizing = true;
		const move = (ev: PointerEvent) => {
			sideWidth = Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + ev.clientX - startX));
		};
		const up = () => {
			resizing = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
			try {
				localStorage.setItem(SIDE_KEY, String(Math.round(sideWidth)));
			} catch {
				/* private mode: the width lasts for this visit */
			}
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
	}
	function resizeByKey(e: KeyboardEvent) {
		const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
		if (!step) return;
		e.preventDefault();
		sideWidth = Math.min(SIDE_MAX, Math.max(SIDE_MIN, sideWidth + step));
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
	/** Relay mode: why the last connection failed, and whether it ever worked. */
	let relayError = $state<RelayError | null>(null);
	let everConnected = $state(false);

	// Frames and exits of the sessions shown on this page, by client id.
	const routes = new Map<string, { onFrame: (raw: string) => void; onExit: () => void }>();
	function register(id: string, onFrame: (raw: string) => void, onExit: () => void) {
		routes.set(id, { onFrame, onExit });
		return () => routes.delete(id);
	}

	function run() {
		daemon.onEvent = (frame) => {
			agentDirectory.handle(frame);
			remoteProjects.handle(frame);
		};
		daemon.onDisconnect = () => {
			agentDirectory.disconnected();
			remoteProjects.reset();
		};
		daemon.onFrame = (id, raw) => routes.get(id)?.onFrame(raw);
		daemon.onExit = (id) => routes.get(id)?.onExit();
		agentDirectory.start();
	}

	function start(saved: string) {
		mode = 'lan';
		token = saved;
		setDaemonEndpoint(async () => remoteEndpoint(saved));
		run();
	}

	/** Connects through the relay; `pair` goes along until the daemon accepts
	 *  this device once. */
	function startRelay(host: RelayHost, pair?: string) {
		mode = 'relay';
		relayError = null;
		const device = deviceKey();
		const name = deviceName();
		setDaemonEndpoint(
			async () => ({ url: host.relay, token: '' }),
			() =>
				new RelaySocket({
					relay: host.relay,
					hostId: host.host_id,
					hostStatic: hostStaticKey(host),
					device,
					name,
					pair,
					onAccepted: () => {
						pair = undefined;
						relayError = null;
						everConnected = true;
					},
					onRelayError: (error) => {
						relayError = error;
						if (error.fatal) agentDirectory.stop();
					}
				})
		);
		run();
	}

	onMount(() => {
		const link = parsePairLink(location.href);
		const fromQr = new URLSearchParams(location.search).get('pair');
		if (link || fromQr || location.hash) {
			// Keep the one-time code out of history and bookmarks.
			history.replaceState(null, '', location.pathname);
		}
		const host = loadHost();
		const saved = remoteToken();
		if (link && isIos() && !isStandalone()) {
			pendingLink = link;
			mode = 'install';
		} else if (link) {
			saveHost(link.host);
			startRelay(link.host, link.code);
		} else if (fromQr) {
			mode = 'lan';
			code = fromQr;
			void pair();
		} else if (host) startRelay(host);
		else if (saved) start(saved);
		else mode = location.hostname === 'app.jucode.net' ? 'scan' : 'lan';

		try {
			const w = Number(localStorage.getItem(SIDE_KEY));
			if (w >= SIDE_MIN && w <= SIDE_MAX) sideWidth = w;
		} catch {
			/* storage blocked: the default width */
		}
		// While the connection comes up, fetch the pages it will open.
		if (mode === 'scan') loadScanner();
		else loadScreens();

		// The PWA's offline shell; never inside the desktop app.
		if ('serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
			navigator.serviceWorker
				.register('/service-worker.js', { type: dev ? 'module' : 'classic' })
				.catch(() => {});
		}
		return () => agentDirectory.stop();
	});

	async function pair() {
		if (!code.trim()) return;
		pairing = true;
		pairError = '';
		try {
			await pairDevice(code, deviceName());
			start(remoteToken()!);
		} catch (e) {
			pairError = e instanceof Error ? e.message : String(e);
		} finally {
			pairing = false;
		}
	}

	function repair() {
		agentDirectory.stop();
		forgetRemoteToken();
		token = null;
	}

	function forget(ask = true) {
		if (ask && !confirm(t('shell.remote.forgetConfirm'))) return;
		agentDirectory.stop();
		forgetHost();
		relayError = null;
		everConnected = false;
		stack = [];
		mode = 'scan';
		loadScanner();
	}

	/** Past pairing and connected once: the lists and pages are showing. */
	const inApp = $derived(
		!!mode &&
			mode !== 'scan' &&
			mode !== 'install' &&
			!(mode === 'lan' && !token) &&
			!(mode === 'relay' && (!everConnected || relayError?.fatal))
	);
	const relayStatus = $derived.by(() => {
		if (agentDirectory.status === 'on') return { tone: 'ok', text: t('shell.remote.relayConnected') };
		if (mode === 'lan')
			return agentDirectory.status === 'unreachable'
				? { tone: 'off', text: t('shell.remote.disconnected') }
				: { tone: 'wait', text: t('shell.remote.connecting') };
		const kind = relayError?.kind;
		if (!kind) return { tone: 'wait', text: t('shell.remote.relayConnecting') };
		if (kind === 'offline') return { tone: 'off', text: t('shell.remote.relayOffline') };
		if (kind === 'busy') return { tone: 'off', text: t('shell.remote.relayBusy') };
		return { tone: 'off', text: t('shell.remote.relayNetwork') };
	});
	/** The connection chip's short label; the menu shows the full status. */
	const connLabel = $derived(
		relayStatus.tone === 'ok'
			? t('shell.remote.relayConnected')
			: relayStatus.tone === 'wait'
				? t('shell.remote.connecting')
				: t('shell.remote.disconnected')
	);
	let connMenu = $state(false);
	// The licenses of the code this page ships (written at build time by
	// scripts/third-party-notices.mjs).
	const LICENSES_URL = '/third-party-notices.txt';
	function connAction(key: string) {
		connMenu = false;
		if (key === 'forget') forget();
		else if (key === 'repair') repair();
		else if (key === 'licenses') window.open(LICENSES_URL, '_blank', 'noopener');
	}

	/** The session on top of the pages, highlighted in the list. */
	const currentSession = $derived.by(() => {
		const top = stack.at(-1);
		return top?.kind === 'session' ? top.session : undefined;
	});

	function openSession(session: string) {
		const agent = agentDirectory.agentOfSession(session);
		const known = agentDirectory.sessions.find((s) => s.session === session);
		open({ kind: 'session', session, cwd: known?.cwd, title: agent?.name ?? known?.title ?? session });
	}

	function openAgent(agent: AgentView) {
		const latest = agentDirectory.latestSession(agent.id);
		open(
			latest
				? { kind: 'session', session: latest.session, title: agent.name }
				: { kind: 'session', agent: agent.id, title: agent.name }
		);
	}
</script>

<svelte:head>
	<title>JuCode</title>
</svelte:head>

{#snippet connection()}
	<div class="conn-wrap">
		<button
			class="conn {relayStatus.tone}"
			class:on={connMenu}
			onclick={() => (connMenu = !connMenu)}
			aria-haspopup="menu"
			aria-expanded={connMenu}
			title={relayStatus.text}
		>
			<span class="dot" class:pulse={relayStatus.tone === 'wait'}></span>
			<span class="conn-text">{connLabel}</span>
			<CaretDownIcon size={12} />
		</button>
		{#if connMenu}
			<PopMenu
				title={relayStatus.text}
				placement="down-right"
				items={[
					mode === 'relay'
						? { key: 'forget', label: t('shell.remote.forget'), icon: SignOutIcon, tone: 'warn' }
						: { key: 'repair', label: t('shell.remote.repair'), icon: ArrowClockwiseIcon, tone: 'warn' },
					{ key: 'licenses', label: t('shell.remote.licenses'), icon: ScrollIcon }
				]}
				onSelect={connAction}
				onClose={() => (connMenu = false)}
			/>
		{/if}
	</div>
{/snippet}

{#snippet linkEntry()}
	<div class="entry">
		<Button variant="primary" disabled={scanning} onclick={openScanner}>
			{#if scanning}<CircleNotchIcon size={16} class="spin" />{:else}<QrCodeIcon size={16} />{/if}
			{t('shell.remote.scanQr')}
		</Button>
		<form class="paste" onsubmit={(e) => (e.preventDefault(), acceptLink(pasted))}>
			<input bind:value={pasted} placeholder={t('shell.remote.pastePlaceholder')} autocomplete="off" autocapitalize="off" spellcheck="false" />
			<Button type="submit" disabled={!pasted.trim()}>{t('shell.remote.connect')}</Button>
		</form>
		{#if linkError}<Notice>{linkError}</Notice>{/if}
	</div>
{/snippet}

{#if scanning && QrScanner}<QrScanner onResult={acceptLink} onClose={() => (scanning = false)} />{/if}

<div class="remote" class:wide class:resizing style:--side-w="{sideWidth}px">
	{#if mode === 'install'}
		<div class="pair">
			<span class="hero"><DeviceMobileIcon size={28} /></span>
			<h1>{t('shell.remote.installTitle')}</h1>
			<ol class="steps">
				<li>{t('shell.remote.installStep1')}</li>
				<li>{t('shell.remote.installStep2')}</li>
				<li>{t('shell.remote.installStep3')}</li>
			</ol>
			<div class="actions"><Button variant="ghost" onclick={continueInBrowser}>{t('shell.remote.installSkip')}</Button></div>
		</div>
	{:else if mode === 'scan'}
		<div class="pair">
			<span class="hero"><QrCodeIcon size={28} /></span>
			<h1>{t('shell.remote.scanTitle')}</h1>
			<p>{t('shell.remote.scanHint')}</p>
			{@render linkEntry()}
			<a class="licenses" href={LICENSES_URL} target="_blank" rel="noopener">{t('shell.remote.licenses')}</a>
		</div>
	{:else if mode === 'relay' && relayError?.fatal}
		<div class="pair">
			<span class="hero warn"><QrCodeIcon size={28} /></span>
			<h1>{t('shell.remote.relayFatalTitle')}</h1>
			<p>
				{relayError.kind === 'pair-invalid' ? t('shell.remote.relayPairInvalid') : t('shell.remote.relayRevoked')}
			</p>
			<div class="actions"><Button variant="primary" onclick={() => forget(false)}>{t('shell.remote.forget')}</Button></div>
		</div>
	{:else if mode === 'relay' && !everConnected}
		<div class="pair">
			<span class="hero" class:warn={relayStatus.tone === 'off'}>
				{#if relayStatus.tone === 'wait'}<CircleNotchIcon size={28} class="spin" />{:else}<DesktopIcon size={28} />{/if}
			</span>
			<h1>JuCode</h1>
			{#key relayStatus.text}<p class="status">{relayStatus.text}</p>{/key}
			<div class="actions"><Button variant="ghost" size="sm" onclick={() => forget()}>{t('shell.remote.forget')}</Button></div>
		</div>
	{:else if mode === 'lan' && !token}
		<div class="pair">
			<span class="hero"><DesktopIcon size={28} /></span>
			<h1>{t('shell.remote.pairTitle')}</h1>
			<p>{t('shell.remote.pairHint')}</p>
			<form onsubmit={(e) => (e.preventDefault(), pair())}>
				<label>
					<span>{t('shell.remote.codeLabel')}</span>
					<input class="code" bind:value={code} autocapitalize="characters" autocomplete="one-time-code" />
				</label>
				<Button variant="primary" disabled={!code.trim() || pairing}>
					{#if pairing}<CircleNotchIcon size={14} class="spin" /> {t('shell.remote.pairing')}{:else}{t('shell.remote.pair')}{/if}
				</Button>
			</form>
			{#if pairError}<div class="err"><Notice>{pairError}</Notice></div>{/if}
		</div>
	{:else if mode}
		<aside class="side">
			<nav>
				<button class:on={tab === 'projects'} onclick={() => (tab = 'projects')}>
					<ListIcon size={18} weight={tab === 'projects' ? 'fill' : 'regular'} />
					<span>{t('shell.remote.sessions')}</span>
				</button>
				<button class:on={tab === 'desk'} onclick={() => (tab = 'desk')}>
					<TrayIcon size={18} weight={tab === 'desk' ? 'fill' : 'regular'} />
					<span>{t('shell.desk.title')}</span>
					{#if agentDirectory.pending > 0}<span class="badge">{agentDirectory.pending}</span>{/if}
				</button>
			</nav>
			<main>
				<div class="top">
					<h1>{tab === 'projects' ? t('shell.remote.sessions') : t('shell.desk.title')}</h1>
					{@render connection()}
				</div>
				{#if mode === 'lan' && agentDirectory.status === 'unreachable'}
					<!-- The daemon served this page, so a failing connection most likely
					     means this device's token was revoked; offer to pair again. -->
					<div class="refused">
						<div class="refused-msg"><Notice tone="warn">{t('shell.remote.refused')}</Notice></div>
						<Button size="sm" onclick={repair}>{t('shell.remote.repair')}</Button>
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
				<div class="tabbody" hidden={tab !== 'desk'}>
					<DeskContent onOpenSession={openSession} />
				</div>
			</main>
			{#if wide}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<div
					class="resizer"
					role="separator"
					aria-orientation="vertical"
					aria-label={t('shell.remote.resizeSidebar')}
					aria-valuemin={SIDE_MIN}
					aria-valuemax={SIDE_MAX}
					aria-valuenow={Math.round(sideWidth)}
					tabindex="0"
					onpointerdown={startResize}
					onkeydown={resizeByKey}
					ondblclick={() => (sideWidth = SIDE_DEFAULT)}
				></div>
			{/if}
		</aside>
	{/if}
	{#if inApp}
		<section class="pane">
			{#if wide && stack.length === 0}
				<div class="pane-empty">
					<ChatsCircleIcon size={32} />
					<p>{t('shell.remote.pickSomething')}</p>
				</div>
			{/if}
			{#each stack as screen, i (screen.key)}
				<div class="layer" style:z-index={20 + i} out:layerOut>
					{#if screen.kind === 'session'}
						{@const root = screen.cwd && !screen.chat && !screen.agent ? screen.cwd : null}
						{#if RemoteSession}
							<RemoteSession
								session={screen.session}
								agent={screen.agent}
								cwd={screen.cwd}
								chat={screen.chat}
								engine={screen.engine}
								title={screen.title}
								{register}
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
					{:else if screen.kind === 'files'}
						{#if FilesScreen}
							<FilesScreen root={screen.root} title={screen.title} onBack={pop} />
						{:else}
							{@render loadingPage(screen.title)}
						{/if}
					{:else if ChangesScreen}
						<ChangesScreen root={screen.root} title={screen.title} onBack={pop} />
					{:else}
						{@render loadingPage(screen.title)}
					{/if}
				</div>
			{/each}
		</section>
	{/if}
	{#if creating}
		<NewSessionDialog project={creating.project} onCreate={create} onClose={() => (creating = null)} />
	{/if}
</div>
<Toaster />
<ConfirmHost />

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
	.remote {
		min-height: 100dvh;
		padding-left: env(safe-area-inset-left);
		padding-right: env(safe-area-inset-right);
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-sans);
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
	/* Wide screens: the list in a resizable left column, pages in the right
	   one. The pane is the containing block of its fixed-position pages
	   (transform), so they fill it instead of the window. */
	.remote.wide {
		display: grid;
		grid-template-columns: var(--side-w) 1fr;
		height: 100dvh;
		overflow: hidden;
	}
	.remote.resizing {
		cursor: col-resize;
		user-select: none;
	}
	.wide .side {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--hairline);
		background: var(--sidebar);
	}
	.wide nav {
		position: static;
		gap: 4px;
		padding: calc(env(safe-area-inset-top) + 10px) 12px 6px;
		border-top: none;
		background: none;
	}
	.wide nav button {
		flex-direction: row;
		justify-content: center;
		gap: 6px;
		height: 34px;
		padding: 0;
		border-radius: var(--r-md);
		font-size: var(--fs-sm);
	}
	.wide nav button.on {
		background: var(--surface2);
	}
	.wide .badge {
		position: static;
	}
	.wide main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 8px 12px 24px;
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
	.resizer {
		position: absolute;
		top: 0;
		right: -3px;
		bottom: 0;
		z-index: 5;
		width: 6px;
		cursor: col-resize;
		touch-action: none;
		transition: background var(--t-med) var(--ease-out);
	}
	.resizer:hover,
	.resizer:focus-visible,
	.resizing .resizer {
		background: var(--accent-soft);
		outline: none;
	}
	main {
		padding: calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 76px);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 4px 0 10px;
	}
	.top h1 {
		flex: 1;
		min-width: 0;
		margin: 0;
	}
	.wide .top h1 {
		padding-left: 4px;
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
	/* Pairing, connecting and error screens: one centered column. */
	.licenses {
		margin-top: 24px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.pair {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		max-width: 420px;
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px);
		text-align: center;
		animation: rise var(--t-slow) var(--ease-out);
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
	.pair form,
	.entry {
		align-self: stretch;
		text-align: left;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 20px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	input.code {
		padding: 11px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xl);
		letter-spacing: 0.12em;
		text-align: center;
		text-transform: uppercase;
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	input:focus {
		border-color: var(--border-strong);
	}
	.err {
		align-self: stretch;
		margin-top: 12px;
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
		margin-top: 24px;
	}
	.conn-wrap {
		position: relative;
		flex-shrink: 0;
	}
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-full);
		background: var(--surface);
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.conn:hover,
	.conn.on {
		background: var(--surface2);
		color: var(--text);
	}
	.conn:active {
		transform: scale(0.96);
	}
	.conn :global(svg) {
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.conn.on :global(svg) {
		transform: rotate(180deg);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--dim2);
		transition: background var(--t-med) var(--ease-out);
	}
	.conn.ok .dot {
		background: var(--ok);
	}
	.conn.wait .dot {
		background: var(--accent-bright);
	}
	.conn.off .dot {
		background: var(--warn);
	}
	.conn.off .conn-text {
		color: var(--warn);
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
	.entry {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		margin-top: 20px;
	}
	.paste {
		flex-direction: row;
		gap: 8px;
		margin-top: 0;
	}
	.paste input {
		flex: 1;
		min-width: 0;
		height: 40px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.steps {
		margin: 8px 0 0;
		padding-left: 20px;
		color: var(--dim);
		font-size: var(--fs-md);
		line-height: 1.7;
		text-align: left;
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
