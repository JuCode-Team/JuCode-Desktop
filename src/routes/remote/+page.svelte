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
	import DeskContent from '$lib/DeskContent.svelte';
	import RemoteSession from '$lib/RemoteSession.svelte';
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
	let mode = $state<'lan' | 'relay' | 'scan' | null>(null);
	let token = $state<string | null>(null);
	let code = $state('');
	let pairing = $state(false);
	let pairError = $state('');
	let tab = $state<'desk' | 'agents'>('desk');
	let open = $state<{ session?: string; agent?: string; title: string } | null>(null);
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
		daemon.onEvent = (frame) => agentDirectory.handle(frame);
		daemon.onDisconnect = () => agentDirectory.disconnected();
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
		if (link) {
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
		open = null;
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
		open = { session, title: agent?.name ?? session };
	}

	function openAgent(agent: AgentView) {
		const latest = agentDirectory.latestSession(agent.id);
		open = latest
			? { session: latest.session, title: agent.name }
			: { agent: agent.id, title: agent.name };
	}
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

<div class="remote">
	{#if mode === 'scan'}
		<div class="pair">
			<span class="hero"><QrCodeIcon size={28} /></span>
			<h1>{t('shell.remote.scanTitle')}</h1>
			<p>{t('shell.remote.scanHint')}</p>
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
			{#if tab === 'desk'}
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
	{#if open && mode && !relayError?.fatal}
		{#key open}
			<RemoteSession
				session={open.session}
				agent={open.agent}
				title={open.title}
				{register}
				onBack={() => (open = null)}
			/>
		{/key}
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
</style>
