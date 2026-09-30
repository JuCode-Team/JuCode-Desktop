<script lang="ts">
	// The remote control page for a phone's browser: pair once, then the desk,
	// the agents and their sessions. Two ways to reach the computer:
	// - LAN: the daemon served this page; pair with a code for a device token.
	// - Relay: the PWA at app.jucode.net; a `#pair=` link names the computer
	//   and the connection runs end-to-end encrypted through the relay.
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QrCodeIcon from 'phosphor-svelte/lib/QrCodeIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import DeskContent from '$lib/DeskContent.svelte';
	import RemoteSession from '$lib/RemoteSession.svelte';
	import Projects from '$lib/remote/Projects.svelte';
	import ProjectScreen from '$lib/remote/ProjectScreen.svelte';
	import AddProjectScreen from '$lib/remote/AddProjectScreen.svelte';
	import FilesScreen from '$lib/remote/FilesScreen.svelte';
	import ChangesScreen from '$lib/remote/ChangesScreen.svelte';
	import { remoteProjects, baseName, type ProjectView } from '$lib/remote/store.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { agentDirectory, type AgentView } from '$lib/agents.svelte';
	import { daemon, setDaemonEndpoint } from '$lib/protocol';
	import { deviceName, forgetRemoteToken, pairDevice, remoteEndpoint, remoteToken } from '$lib/remote';
	import {
		deviceKey,
		forgetHost,
		hostStaticKey,
		loadHost,
		parsePairFragment,
		saveHost,
		type RelayHost
	} from '$lib/relay/pairing';
	import { RelayError, RelaySocket } from '$lib/relay/socket';
	import { t } from '$lib/i18n';

	/** `scan`: the relay PWA with no computer paired yet. */
	let mode = $state<'lan' | 'relay' | 'scan' | 'install' | null>(null);
	// iPhone/iPad Safari: a home-screen app has its own storage, so pairing in
	// the browser would not carry over. Offer to add it first; the code is only
	// used if the user chooses to stay in the browser.
	let pendingLink = $state<ReturnType<typeof parsePairFragment>>(null);
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
	function acceptLink(text: string) {
		scanning = false;
		const hash = text.includes('#') ? text.slice(text.indexOf('#')) : text;
		const link = parsePairFragment(hash.trim());
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
	let tab = $state<'projects' | 'desk' | 'agents'>('projects');
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
		const link = parsePairFragment(location.hash);
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
	}

	const relayStatus = $derived.by(() => {
		if (agentDirectory.status === 'on') return { tone: 'ok', text: t('shell.remote.relayConnected') };
		const kind = relayError?.kind;
		if (!kind) return { tone: 'wait', text: t('shell.remote.relayConnecting') };
		if (kind === 'offline') return { tone: 'off', text: t('shell.remote.relayOffline') };
		if (kind === 'busy') return { tone: 'off', text: t('shell.remote.relayBusy') };
		return { tone: 'off', text: t('shell.remote.relayNetwork') };
	});

	function openSession(session: string) {
		const agent = agentDirectory.agentOfSession(session);
		const known = agentDirectory.sessions.find((s) => s.session === session);
		push({ kind: 'session', session, cwd: known?.cwd, title: agent?.name ?? known?.title ?? session });
	}

	function openAgent(agent: AgentView) {
		const latest = agentDirectory.latestSession(agent.id);
		push(
			latest
				? { kind: 'session', session: latest.session, title: agent.name }
				: { kind: 'session', agent: agent.id, title: agent.name }
		);
	}
	import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobileIcon';
	import QrScanner from '$lib/relay/QrScanner.svelte';
</script>

<svelte:head>
	<title>JuCode</title>
</svelte:head>

{#snippet connection()}
	<div class="conn {relayStatus.tone}">
		<span class="dot" class:pulse={relayStatus.tone === 'wait'}></span>
		<span class="conn-text">{relayStatus.text}</span>
		<button class="link" onclick={() => forget()}>{t('shell.remote.forget')}</button>
	</div>
{/snippet}

{#snippet linkEntry()}
	<div class="entry">
		<Button variant="primary" onclick={() => (scanning = true)}><QrCodeIcon size={16} /> {t('shell.remote.scanQr')}</Button>
		<form class="paste" onsubmit={(e) => (e.preventDefault(), acceptLink(pasted))}>
			<input bind:value={pasted} placeholder={t('shell.remote.pastePlaceholder')} autocomplete="off" autocapitalize="off" spellcheck="false" />
			<Button type="submit" disabled={!pasted.trim()}>{t('shell.remote.connect')}</Button>
		</form>
		{#if linkError}<Notice>{linkError}</Notice>{/if}
	</div>
{/snippet}

{#if scanning}<QrScanner onResult={acceptLink} onClose={() => (scanning = false)} />{/if}

<div class="remote">
	{#if mode === 'install'}
		<div class="pair">
			<span class="hero"><DeviceMobileIcon size={28} /></span>
			<h1>{t('shell.remote.installTitle')}</h1>
			<ol class="steps">
				<li>{t('shell.remote.installStep1')}</li>
				<li>{t('shell.remote.installStep2')}</li>
				<li>{t('shell.remote.installStep3')}</li>
			</ol>
			<Button variant="ghost" onclick={continueInBrowser}>{t('shell.remote.installSkip')}</Button>
		</div>
	{:else if mode === 'scan'}
		<div class="pair">
			<span class="hero"><QrCodeIcon size={28} /></span>
			<h1>{t('shell.remote.scanTitle')}</h1>
			<p>{t('shell.remote.scanHint')}</p>
			{@render linkEntry()}
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
			<p>{relayStatus.text}</p>
			<div class="actions"><button class="link" onclick={() => forget()}>{t('shell.remote.forget')}</button></div>
		</div>
	{:else if mode === 'lan' && !token}
		<div class="pair">
			<h1>{t('shell.remote.pairTitle')}</h1>
			<p>{t('shell.remote.pairHint')}</p>
			<form onsubmit={(e) => (e.preventDefault(), pair())}>
				<label>
					<span>{t('shell.remote.codeLabel')}</span>
					<input bind:value={code} autocapitalize="characters" autocomplete="one-time-code" />
				</label>
				<Button variant="primary" disabled={!code.trim() || pairing}>
					{#if pairing}<CircleNotchIcon size={14} class="spin" /> {t('shell.remote.pairing')}{:else}{t('shell.remote.pair')}{/if}
				</Button>
			</form>
			{#if pairError}<div class="err"><Notice>{pairError}</Notice></div>{/if}
		</div>
	{:else if mode}
		<main>
			{#if mode === 'relay'}
				{@render connection()}
			{:else if agentDirectory.status === 'unreachable'}
				<!-- The daemon served this page, so a failing connection most likely
				     means this device's token was revoked; offer to pair again. -->
				<div class="refused">
					<div class="refused-msg"><Notice tone="warn">{t('shell.remote.refused')}</Notice></div>
					<Button size="sm" onclick={repair}>{t('shell.remote.repair')}</Button>
				</div>
			{/if}
			{#if tab === 'projects'}
				<h1>{t('shell.remote.projects')}</h1>
				<Projects
					onOpenProject={(project) => push({ kind: 'project', project })}
					onAddProject={() => push({ kind: 'add' })}
					onOpenSession={(session, cwd, title) => push({ kind: 'session', session, cwd, title })}
				/>
			{:else if tab === 'desk'}
				<h1>{t('shell.desk.title')}</h1>
				<DeskContent onOpenSession={openSession} />
			{:else}
				<h1>{t('shell.remote.agents')}</h1>
				{#if agentDirectory.agents.length === 0}
					<p class="empty">{t('shell.agents.empty')}</p>
				{/if}
				{#each agentDirectory.agents as agent (agent.id)}
					<button class="agent" onclick={() => openAgent(agent)}>
						{#if agent.busy}<CircleNotchIcon size={14} class="spin" />{:else}<RobotIcon size={14} />{/if}
						<span class="text">
							<span class="name">{agent.name}</span>
							{#if agent.summary}<span class="summary">{agent.summary}</span>{/if}
						</span>
					</button>
				{/each}
			{/if}
		</main>
		<nav>
			<button class:on={tab === 'projects'} onclick={() => (tab = 'projects')}>
				<FolderIcon size={18} />
				<span>{t('shell.remote.projects')}</span>
			</button>
			<button class:on={tab === 'desk'} onclick={() => (tab = 'desk')}>
				<TrayIcon size={18} />
				<span>{t('shell.desk.title')}</span>
				{#if agentDirectory.pending > 0}<span class="badge">{agentDirectory.pending}</span>{/if}
			</button>
			<button class:on={tab === 'agents'} onclick={() => (tab = 'agents')}>
				<RobotIcon size={18} />
				<span>{t('shell.remote.agents')}</span>
			</button>
		</nav>
	{/if}
	{#if mode && !relayError?.fatal}
		{#each stack as screen, i (screen.key)}
			<div class="layer" style:z-index={20 + i}>
				{#if screen.kind === 'session'}
					{@const root = screen.cwd && !screen.chat && !screen.agent ? screen.cwd : null}
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
				{:else if screen.kind === 'project'}
					{@const project = screen.project}
					<ProjectScreen
						{project}
						onBack={pop}
						onOpenSession={(session, cwd, title, engine) =>
							push({ kind: 'session', session, cwd, chat: project.chats, engine, title })}
						onNewSession={(engine) =>
							push({
								kind: 'session',
								cwd: project.path,
								chat: project.chats,
								engine,
								title: engine === 'claude' ? 'Claude Code' : t('shell.remote.newSession')
							})}
						onFiles={() => push({ kind: 'files', root: project.path, title: project.name })}
						onChanges={() => push({ kind: 'changes', root: project.path, title: project.name })}
					/>
				{:else if screen.kind === 'add'}
					<AddProjectScreen onBack={pop} onAdded={pop} />
				{:else if screen.kind === 'files'}
					<FilesScreen root={screen.root} title={screen.title} onBack={pop} />
				{:else}
					<ChangesScreen root={screen.root} title={screen.title} onBack={pop} />
				{/if}
			</div>
		{/each}
	{/if}
</div>

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
	}
	main {
		padding: calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 76px);
	}
	h1 {
		margin: 4px 0 8px;
		font-family: var(--font-serif);
		font-size: var(--fs-xl);
		font-weight: 500;
	}
	.pair {
		max-width: 420px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 48px) 20px 24px;
	}
	.pair p {
		font-size: var(--fs-md);
		color: var(--dim);
		line-height: 1.55;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 16px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	input {
		padding: 11px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xl);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		outline: none;
	}
	.err {
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
	}
	.hero.warn {
		color: var(--warn);
	}
	.actions {
		margin-top: 20px;
	}
	.link {
		padding: 4px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		text-decoration: underline;
		text-underline-offset: 3px;
		white-space: nowrap;
	}
	.conn {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.conn-text {
		flex: 1;
		min-width: 0;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--dim2);
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
	}
	.refused-msg {
		flex: 1;
		min-width: 0;
	}
	.empty {
		color: var(--dim2);
		font-size: var(--fs-md);
	}
	.agent {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		width: 100%;
		padding: 14px 4px;
		border: none;
		border-bottom: 1px solid var(--hairline);
		background: none;
		color: var(--text);
		text-align: left;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.summary {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
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
	}
	.entry {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		margin-top: 8px;
	}
	.paste {
		display: flex;
		gap: 8px;
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
	}
	.steps {
		margin: 0;
		padding-left: 20px;
		color: var(--dim);
		font-size: var(--fs-md);
		line-height: 1.7;
	}
</style>
