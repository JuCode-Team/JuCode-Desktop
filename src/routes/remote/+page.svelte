<script lang="ts">
	// The remote control page for a phone's browser: pair once, then the desk,
	// the agents and their sessions. Two ways to reach a computer:
	// - LAN: the daemon served this page; pair with a code for a device token.
	// - Relay: the PWA at app.jucode.net; a `#pair=` link names the computer
	//   and the connection runs end-to-end encrypted through the relay.
	// Several computers can be paired; each keeps its own live connection and
	// view (HostView), and the switcher in the list header picks the one shown.
	import { onMount, type Component } from 'svelte';
	import { dev } from '$app/environment';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QrCodeIcon from 'phosphor-svelte/lib/QrCodeIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import ScrollIcon from 'phosphor-svelte/lib/ScrollIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobileIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import BellIcon from 'phosphor-svelte/lib/BellIcon';
	import { enablePush, pushOn, pushSupported } from '$lib/remote/push';
	import { forgetLists } from '$lib/remote/cache';
	import { toast } from '$lib/ui/toast.svelte';
	import HostView from '$lib/remote/HostView.svelte';
	import { HostConnection, LAN_ID } from '$lib/remote/connection.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Toaster from '$lib/ui/Toaster.svelte';
	import ConfirmHost from '$lib/ui/ConfirmHost.svelte';
	import { deviceName, forgetRemoteToken, pairDevice, remoteToken } from '$lib/remote';
	import {
		addHost,
		forgetHost,
		loadActive,
		loadHosts,
		parsePairLink,
		renameHost,
		saveActive,
		type PairLink,
		type RelayHost,
		type SavedHost
	} from '$lib/relay/pairing';
	import { t } from '$lib/i18n';

	// The heavy pages (a conversation with markdown and highlighting, the file
	// viewer, the QR scanner) load after the list is up, so the first screen
	// only waits for what it shows.
	/* eslint-disable @typescript-eslint/no-explicit-any -- lazily loaded components */
	let screens = $state<{
		RemoteSession: Component<any> | null;
		FilesScreen: Component<any> | null;
		ChangesScreen: Component<any> | null;
	}>({ RemoteSession: null, FilesScreen: null, ChangesScreen: null });
	let QrScanner = $state<Component<any> | null>(null);
	/* eslint-enable @typescript-eslint/no-explicit-any */
	let screensLoading = false;
	function loadScreens() {
		if (screensLoading) return;
		screensLoading = true;
		import('$lib/RemoteSession.svelte').then((m) => (screens.RemoteSession = m.default));
		import('$lib/remote/FilesScreen.svelte').then((m) => (screens.FilesScreen = m.default));
		import('$lib/remote/ChangesScreen.svelte').then((m) => (screens.ChangesScreen = m.default));
	}
	function loadScanner() {
		import('$lib/relay/QrScanner.svelte').then((m) => (QrScanner = m.default));
	}

	/** The paired computers (relay) as stored, and a live connection to each
	 *  of them and to the LAN daemon, when this device has its token. */
	let hosts = $state<SavedHost[]>([]);
	let conns = $state<HostConnection[]>([]);
	/** The computer shown. */
	let activeId = $state<string | null>(null);
	const active = $derived(conns.find((c) => c.id === activeId) ?? conns[0] ?? null);

	// A requirement a notification is about (`?requirement=`): shown on the
	// computer that has it (the shown one first) once its list has arrived.
	let wanted = $state<string | null>(null);
	let showing = $state<{ conn: string; requirement: string; n: number } | null>(null);
	function want(url: string) {
		const id = new URL(url, location.origin).searchParams.get('requirement');
		if (id) wanted = id;
	}
	$effect(() => {
		const id = wanted;
		if (!id) return;
		const conn = [active, ...conns].find((c) => c?.requirements.get(id));
		if (!conn) return;
		wanted = null;
		select(conn.id);
		showing = { conn: conn.id, requirement: id, n: (showing?.n ?? 0) + 1 };
	});

	let mounted = $state(false);
	/** The relay PWA, as opposed to a page served by a daemon on the LAN. */
	let relayOrigin = $state(false);
	// iPhone/iPad Safari: a home-screen app has its own storage, so pairing in
	// the browser would not carry over. Offer to add it first; the code is only
	// used if the user chooses to stay in the browser.
	let pendingLink = $state<PairLink | null>(null);
	const isIos = () =>
		/iPhone|iPad|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const isStandalone = () =>
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	// Installing: Android and desktop Chrome offer a prompt the page can show
	// from its menu; an iPhone adds the app from Safari's share sheet (the
	// guide below); an app's built-in browser (WeChat, QQ…) can do neither.
	type InstallPrompt = Event & { prompt: () => Promise<void> };
	let installPrompt = $state<InstallPrompt | null>(null);
	let installGuide = $state(false);
	const inAppBrowser = () => /MicroMessenger|QQ\/|Weibo|DingTalk|AlipayClient|Lark|Feishu/i.test(navigator.userAgent);
	let embedded = $state(false);
	const canInstall = $derived(!!installPrompt || (mounted && isIos() && !isStandalone()));
	function install() {
		switchMenu = false;
		if (installPrompt) {
			const prompt = installPrompt;
			installPrompt = null;
			void prompt.prompt();
		} else installGuide = true;
	}

	/** Sends a test notification to this phone through the shown computer,
	 *  turning notifications on first, and says which push service took it. */
	const SERVICES: Record<string, string> = {
		'fcm.googleapis.com': 'Google FCM',
		'web.push.apple.com': 'Apple',
		'updates.push.services.mozilla.com': 'Mozilla'
	};
	async function testPush() {
		switchMenu = false;
		const conn = active;
		if (!conn) return;
		try {
			if (!pushSupported()) throw new Error(t(isIos() ? 'shell.remote.pushIosHint' : 'shell.dispatch.notifyUnsupported'));
			if (!pushOn()) await enablePush([conn.daemon]);
			const reply = await conn.daemon.request({ op: 'push_test' });
			const results = (reply.results as { service: string; status?: number; error?: string }[]) ?? [];
			if (!results.length) throw new Error(t('shell.remote.pushNone'));
			for (const r of results) {
				const service = SERVICES[r.service] ?? r.service;
				if (r.status && r.status < 300)
					toast.success(t(r.service === 'fcm.googleapis.com' ? 'shell.remote.pushSentFcm' : 'shell.remote.pushSent', { service }), { duration: 10000 });
				else toast.error(t('shell.remote.pushFailed', { service, reason: r.error ?? String(r.status) }));
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			toast.error(/requires session/.test(message) ? t('shell.remote.pushOld') : message);
		}
	}
	/** Pairing another computer, opened from the switcher. */
	let adding = $state(false);
	/** LAN pairing with a code, asked for while other computers are paired. */
	let lanPairing = $state(false);
	/** What fills the page. */
	const view = $derived(
		!mounted
			? null
			: pendingLink || installGuide
				? 'install'
				: adding
					? 'scan'
					: lanPairing
						? 'lan'
						: conns.length
							? 'app'
							: relayOrigin
								? 'scan'
								: 'lan'
	);
	$effect(() => {
		if (view === 'scan') loadScanner();
		else if (view === 'app') loadScreens();
	});

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
		addPaired(link);
	}
	function continueInBrowser() {
		installGuide = false;
		const link = pendingLink;
		pendingLink = null;
		if (link) addPaired(link);
	}
	function startAdding() {
		switchMenu = false;
		linkError = '';
		pasted = '';
		adding = true;
	}

	/** Connects to a paired computer; `pair` goes along until its daemon
	 *  accepts this device once. A computer already connected is replaced. */
	function connect(host: RelayHost, pair?: string) {
		const old = conns.find((c) => c.id === host.host_id);
		old?.stop();
		const conn = HostConnection.relay(host, pair);
		conns = old ? conns.map((c) => (c === old ? conn : c)) : [...conns, conn];
		conn.start();
	}

	/** Adds (or, paired again, updates) a computer and shows it. */
	function addPaired(link: PairLink) {
		addHost(link.host);
		hosts = loadHosts();
		connect(link.host, link.code);
		select(link.host.host_id);
	}

	function startLan(saved: string) {
		conns.find((c) => c.id === LAN_ID)?.stop();
		const conn = HostConnection.lan(saved);
		conns = [...conns.filter((c) => c.id !== LAN_ID), conn];
		conn.start();
	}

	function select(id: string) {
		switchMenu = false;
		adding = false;
		lanPairing = false;
		activeId = id;
		saveActive(id);
	}

	/** A computer's name: the one given here, else 「电脑 N」; the LAN daemon
	 *  goes by its address. */
	function nameOf(conn: HostConnection): string {
		if (conn.kind === 'lan') return t('shell.remote.lanComputer', { host: location.host });
		const host = hosts.find((h) => h.host_id === conn.id);
		return host?.name || t('shell.remote.computerN', { n: host?.seq ?? 1 });
	}

	onMount(() => {
		want(location.href);
		if (wanted) history.replaceState(null, '', location.pathname);
		const fromWorker = (e: MessageEvent) => {
			if (e.data?.type === 'jucode-open' && typeof e.data.url === 'string') want(e.data.url);
		};
		navigator.serviceWorker?.addEventListener('message', fromWorker);
		embedded = inAppBrowser();
		const onInstallPrompt = (e: Event) => {
			e.preventDefault();
			installPrompt = e as InstallPrompt;
		};
		window.addEventListener('beforeinstallprompt', onInstallPrompt);
		const link = parsePairLink(location.href);
		const fromQr = new URLSearchParams(location.search).get('pair');
		if (link || fromQr || location.hash) {
			// Keep the one-time code out of history and bookmarks.
			history.replaceState(null, '', location.pathname);
		}
		relayOrigin = location.hostname === 'app.jucode.net';
		const install = !!link && isIos() && !isStandalone();
		hosts = loadHosts();
		// The linked computer connects with its code below.
		for (const host of hosts) if (install || host.host_id !== link?.host.host_id) connect(host);
		const saved = remoteToken();
		if (saved) startLan(saved);
		activeId = loadActive();
		if (install) pendingLink = link;
		else if (link) addPaired(link);
		else if (fromQr) {
			lanPairing = true;
			code = fromQr;
			void pair();
		}
		mounted = true;

		try {
			const w = Number(localStorage.getItem(SIDE_KEY));
			if (w >= SIDE_MIN && w <= SIDE_MAX) sideWidth = w;
		} catch {
			/* storage blocked: the default width */
		}

		// The PWA's offline shell; never inside the desktop app.
		if ('serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
			navigator.serviceWorker
				.register('/service-worker.js', { type: dev ? 'module' : 'classic' })
				.catch(() => {});
		}
		return () => {
			navigator.serviceWorker?.removeEventListener('message', fromWorker);
			window.removeEventListener('beforeinstallprompt', onInstallPrompt);
			for (const conn of conns) conn.stop();
		};
	});

	/** Back in the foreground or online again: check every computer's
	 *  connection now (see HostConnection.wake). */
	function wakeAll() {
		for (const conn of conns) void conn.wake();
	}

	// LAN pairing with a code shown on the desktop.
	let code = $state('');
	let pairing = $state(false);
	let pairError = $state('');
	async function pair() {
		if (!code.trim()) return;
		pairing = true;
		pairError = '';
		try {
			await pairDevice(code, deviceName());
			startLan(remoteToken()!);
			select(LAN_ID);
		} catch (e) {
			pairError = e instanceof Error ? e.message : String(e);
		} finally {
			pairing = false;
		}
	}

	/** LAN: drop this device's token and pair again with a new code. */
	function repair() {
		const lan = conns.find((c) => c.id === LAN_ID);
		lan?.stop();
		conns = conns.filter((c) => c !== lan);
		forgetRemoteToken();
		code = '';
		pairError = '';
		lanPairing = true;
	}

	function forget(conn: HostConnection, ask = true) {
		switchMenu = false;
		if (ask && !confirm(t('shell.remote.forgetHostConfirm', { name: nameOf(conn) }))) return;
		conn.stop();
		forgetHost(conn.id);
		forgetLists(conn.id);
		hosts = loadHosts();
		conns = conns.filter((c) => c !== conn);
		if (activeId === conn.id && conns.length) select(conns[0].id);
	}

	function rename(conn: HostConnection) {
		switchMenu = false;
		const host = hosts.find((h) => h.host_id === conn.id);
		const next = prompt(t('shell.remote.renameComputerPrompt'), host?.name || nameOf(conn));
		if (next === null) return;
		renameHost(conn.id, next);
		hosts = loadHosts();
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

	let switchMenu = $state(false);
	// The licenses of the code this page ships (written at build time by
	// scripts/third-party-notices.mjs).
	const LICENSES_URL = '/third-party-notices.txt';
	function openLicenses() {
		switchMenu = false;
		window.open(LICENSES_URL, '_blank', 'noopener');
	}
</script>

<svelte:head>
	<title>JuCode</title>
</svelte:head>

<svelte:window onkeydown={(e) => switchMenu && e.key === 'Escape' && (switchMenu = false)} ononline={wakeAll} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'visible' && wakeAll()} />

<!-- The computer switcher: the shown computer and how its connection is
     doing; the menu switches, adds, renames and forgets computers. -->
{#snippet switcher()}
	{#if active}
		<div class="conn-wrap">
			<button
				class="conn {active.state.tone}"
				class:on={switchMenu}
				onclick={() => (switchMenu = !switchMenu)}
				aria-haspopup="menu"
				aria-expanded={switchMenu}
				title={t(active.state.text)}
			>
				<span class="dot" class:pulse={active.state.tone === 'wait'}></span>
				<span class="conn-text">{nameOf(active)}</span>
				<CaretDownIcon size={12} />
			</button>
			{#if switchMenu}
				<button class="backdrop" aria-label="close menu" tabindex="-1" onclick={() => (switchMenu = false)}></button>
				<div class="pop switch-menu" class:left={wide} role="menu">
					<div class="pop-head">{t('shell.remote.computers')}</div>
					{#each conns as conn (conn)}
						<button
							class="pop-row two"
							role="menuitemradio"
							aria-checked={conn === active}
							onclick={() => select(conn.id)}
						>
							<span class="pop-ico"><span class="dot {conn.state.tone}" class:pulse={conn.state.tone === 'wait'}></span></span>
							<span class="pop-txt">
								<span class="pop-label">{nameOf(conn)}</span>
								<span class="pop-desc">{t(conn === active ? conn.state.text : conn.state.short)}</span>
							</span>
							{#if conn !== active && conn.agents.pending > 0}<span class="count">{conn.agents.pending}</span>{/if}
							{#if conn === active}<span class="pop-check"><CheckIcon size={16} /></span>{/if}
						</button>
					{/each}
					<div class="sep"></div>
					<button class="pop-row" role="menuitem" onclick={startAdding}>
						<span class="pop-ico"><PlusIcon size={18} /></span>
						<span class="pop-txt"><span class="pop-label">{t('shell.remote.addComputer')}</span></span>
					</button>
					{#if active.kind === 'relay'}
						<button class="pop-row" role="menuitem" onclick={() => rename(active)}>
							<span class="pop-ico"><PencilSimpleIcon size={18} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.renameComputer', { name: nameOf(active) })}</span></span>
						</button>
						<button class="pop-row warn" role="menuitem" onclick={() => forget(active)}>
							<span class="pop-ico"><SignOutIcon size={18} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.forget')}</span></span>
						</button>
					{:else}
						<button class="pop-row warn" role="menuitem" onclick={() => ((switchMenu = false), repair())}>
							<span class="pop-ico"><ArrowClockwiseIcon size={18} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.repair')}</span></span>
						</button>
					{/if}
					{#if canInstall}
						<button class="pop-row" role="menuitem" onclick={install}>
							<span class="pop-ico"><DownloadSimpleIcon size={18} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.install')}</span></span>
						</button>
					{/if}
					<button class="pop-row" role="menuitem" onclick={testPush}>
						<span class="pop-ico"><BellIcon size={18} /></span>
						<span class="pop-txt"><span class="pop-label">{t('shell.remote.pushTest')}</span></span>
					</button>
					<button class="pop-row" role="menuitem" onclick={openLicenses}>
						<span class="pop-ico"><ScrollIcon size={18} /></span>
						<span class="pop-txt"><span class="pop-label">{t('shell.remote.licenses')}</span></span>
					</button>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet resizer()}
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

{#snippet backToApp()}
	{#if conns.length}
		<button class="cancel" onclick={() => ((adding = false), (lanPairing = false), (scanning = false))} aria-label={t('shell.remote.back')}>
			<ArrowLeftIcon size={18} />
		</button>
	{/if}
{/snippet}

{#if scanning && QrScanner}<QrScanner onResult={acceptLink} onClose={() => (scanning = false)} />{/if}

<div class="remote" class:wide class:resizing style:--side-w="{sideWidth}px">
	{#if view === 'install'}
		<div class="pair">
			<span class="hero"><DeviceMobileIcon size={28} /></span>
			<h1>{t('shell.remote.installTitle')}</h1>
			<ol class="steps">
				<li>{t('shell.remote.installStep1')}</li>
				<li>{t('shell.remote.installStep2')}</li>
				<li>{t('shell.remote.installStep3')}</li>
			</ol>
			<div class="actions">
				<Button variant="ghost" onclick={continueInBrowser}>{installGuide && !pendingLink ? t('shell.remote.installClose') : t('shell.remote.installSkip')}</Button>
			</div>
		</div>
	{:else if view === 'scan'}
		<div class="pair">
			{@render backToApp()}
			<span class="hero"><QrCodeIcon size={28} /></span>
			<h1>{conns.length ? t('shell.remote.addComputer') : t('shell.remote.scanTitle')}</h1>
			<p>{t('shell.remote.scanHint')}</p>
			{@render linkEntry()}
			<a class="licenses" href={LICENSES_URL} target="_blank" rel="noopener">{t('shell.remote.licenses')}</a>
		</div>
	{:else if view === 'lan'}
		<div class="pair">
			{@render backToApp()}
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
	{/if}
	{#if embedded && view === 'app'}
		<div class="embedded"><Notice tone="info">{t('shell.remote.inAppBrowser')}</Notice></div>
	{/if}
	<!-- Every computer's view stays mounted (its pages and sessions live on);
	     the shown one is visible. -->
	{#each conns as conn (conn)}
		<HostView
			{conn}
			name={nameOf(conn)}
			hostName={conns.length > 1 ? nameOf(conn) : undefined}
			hidden={view !== 'app' || conn !== active}
			{wide}
			{screens}
			{switcher}
			{resizer}
			onAdd={startAdding}
			onForget={(ask) => forget(conn, ask)}
			onRepair={repair}
			show={showing?.conn === conn.id ? showing : null}
		/>
	{/each}
</div>
<Toaster />
<ConfirmHost />

<style>
	.remote {
		min-height: 100dvh;
		padding-left: env(safe-area-inset-left);
		padding-right: env(safe-area-inset-right);
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-sans);
	}
	/* Wide screens: the list in a resizable left column, pages in the right
	   one (HostView fills both). */
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
	h1 {
		margin: 4px 0 8px;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	/* Pairing screens: one centered column across the page. */
	.licenses {
		margin-top: 24px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
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
	.pair h1 {
		margin: 8px 0 4px;
	}
	.pair p {
		margin: 6px 0 0;
		font-size: var(--fs-md);
		color: var(--dim);
		line-height: 1.55;
	}
	.pair form,
	.entry {
		align-self: stretch;
		text-align: left;
	}
	.cancel {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 12px);
		left: 12px;
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.cancel:hover {
		background: var(--surface2);
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
	.actions {
		margin-top: 24px;
	}
	/* Gives way to the heading beside it: the name is cut, not the title. */
	.conn-wrap {
		position: relative;
		min-width: 0;
	}
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
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
		flex-shrink: 0;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.conn.on :global(svg) {
		transform: rotate(180deg);
	}
	.conn-text {
		min-width: 0;
		max-width: 40vw;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--dim2);
		transition: background var(--t-med) var(--ease-out);
	}
	.conn.ok .dot,
	.dot.ok {
		background: var(--ok);
	}
	.conn.wait .dot,
	.dot.wait {
		background: var(--accent-bright);
	}
	.conn.off .dot,
	.dot.off {
		background: var(--warn);
	}
	.conn.off .conn-text {
		color: var(--warn);
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	/* Opens toward the room it has: leftward under a phone's header chip,
	   rightward over the pane from the wide sidebar's. */
	.switch-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 81;
		width: max-content;
		min-width: 240px;
		max-width: min(340px, calc(100vw - 32px));
		text-align: left;
		transform-origin: top right;
		animation: drop-in var(--t-med) var(--ease-spring);
	}
	.switch-menu.left {
		right: auto;
		left: 0;
		transform-origin: top left;
	}
	.switch-menu .pop-ico {
		justify-content: center;
		align-items: center;
	}
	.sep {
		height: 1px;
		margin: 4px 8px;
		background: var(--hairline);
	}
	.count {
		flex-shrink: 0;
		min-width: 16px;
		padding: 0 4px;
		border-radius: var(--r-full);
		background: var(--warn);
		color: #000;
		font-size: var(--fs-2xs);
		line-height: 16px;
		text-align: center;
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
	.embedded {
		position: relative;
		z-index: 30;
		padding: calc(env(safe-area-inset-top) + 8px) 12px 0;
	}
</style>
