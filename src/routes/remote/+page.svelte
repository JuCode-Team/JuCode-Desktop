<script lang="ts">
	// The remote control page, served by jucode daemon for a phone's browser:
	// pair once, then the desk, the agents and their sessions.
	import { onMount } from 'svelte';
	import { Inbox, Bot, LoaderCircle } from 'lucide-svelte';
	import DeskContent from '$lib/DeskContent.svelte';
	import RemoteSession from '$lib/RemoteSession.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { agentDirectory, type AgentView } from '$lib/agents.svelte';
	import { daemon, setDaemonEndpoint } from '$lib/protocol';
	import { deviceName, forgetRemoteToken, pairDevice, remoteEndpoint, remoteToken } from '$lib/remote';
	import { t } from '$lib/i18n';

	let token = $state<string | null>(null);
	let code = $state('');
	let pairing = $state(false);
	let pairError = $state('');
	let tab = $state<'desk' | 'agents'>('desk');
	let open = $state<{ session?: string; agent?: string; title: string } | null>(null);

	// Frames and exits of the sessions shown on this page, by client id.
	const routes = new Map<string, { onFrame: (raw: string) => void; onExit: () => void }>();
	function register(id: string, onFrame: (raw: string) => void, onExit: () => void) {
		routes.set(id, { onFrame, onExit });
		return () => routes.delete(id);
	}

	function start(saved: string) {
		token = saved;
		setDaemonEndpoint(async () => remoteEndpoint(saved));
		daemon.onEvent = (frame) => agentDirectory.handle(frame);
		daemon.onDisconnect = () => agentDirectory.disconnected();
		daemon.onFrame = (id, raw) => routes.get(id)?.onFrame(raw);
		daemon.onExit = (id) => routes.get(id)?.onExit();
		agentDirectory.start();
	}

	onMount(() => {
		const params = new URLSearchParams(location.search);
		const fromQr = params.get('pair');
		if (fromQr) {
			code = fromQr;
			// Keep the one-time code out of history and bookmarks.
			history.replaceState(null, '', location.pathname);
		}
		const saved = remoteToken();
		if (saved && !fromQr) start(saved);
		else if (fromQr) void pair();
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
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<title>JuCode</title>
</svelte:head>

<div class="remote">
	{#if !token}
		<div class="pair">
			<h1>{t('shell.remote.pairTitle')}</h1>
			<p>{t('shell.remote.pairHint')}</p>
			<form onsubmit={(e) => (e.preventDefault(), pair())}>
				<label>
					<span>{t('shell.remote.codeLabel')}</span>
					<input bind:value={code} autocapitalize="characters" autocomplete="one-time-code" />
				</label>
				<Button variant="primary" disabled={!code.trim() || pairing}>
					{#if pairing}<LoaderCircle size={14} class="spin" /> {t('shell.remote.pairing')}{:else}{t('shell.remote.pair')}{/if}
				</Button>
			</form>
			{#if pairError}<div class="err">{pairError}</div>{/if}
		</div>
	{:else}
		<main>
			<!-- The daemon served this page, so a failing connection most likely
			     means this device's token was revoked; offer to pair again. -->
			{#if agentDirectory.status === 'unreachable'}
				<div class="notice">
					<span>{t('shell.remote.refused')}</span>
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
						<span class="dot" class:busy={agent.busy}></span>
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
				<Inbox size={18} />
				<span>{t('shell.desk.title')}</span>
				{#if agentDirectory.pending > 0}<span class="badge">{agentDirectory.pending}</span>{/if}
			</button>
			<button class:on={tab === 'agents'} onclick={() => (tab = 'agents')}>
				<Bot size={18} />
				<span>{t('shell.remote.agents')}</span>
			</button>
		</nav>
		{#if open}
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
	{/if}
</div>

<style>
	.remote {
		min-height: 100dvh;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-sans);
	}
	main {
		padding: calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 76px);
	}
	h1 {
		margin: 4px 0 8px;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 800;
	}
	.pair {
		max-width: 420px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 48px) 20px 24px;
	}
	.pair p {
		font-size: 14px;
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
		font-size: 13px;
		color: var(--dim);
	}
	input {
		padding: 11px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 18px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		outline: none;
	}
	.err {
		margin-top: 12px;
		font-size: 13px;
		color: var(--err);
	}
	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
		padding: 10px 12px;
		border-radius: var(--r-md);
		font-size: 13px;
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
	}
	.empty {
		color: var(--dim2);
		font-size: 14px;
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
	.dot {
		width: 9px;
		height: 9px;
		margin-top: 6px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.dot.busy {
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	.summary {
		font-size: 13px;
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
		font-size: 11px;
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
		border-radius: 999px;
		background: var(--warn);
		color: #000;
		font-size: 10px;
		line-height: 16px;
	}
</style>
