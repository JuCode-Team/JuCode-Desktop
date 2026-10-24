<script lang="ts">
	// The remote control page of the web app (app.jucode.net/remote, signed
	// in with the JuCode account): the account's computers, then the desk,
	// the agents and their sessions on each. A computer is reached through
	// the relay, end-to-end encrypted; this browser gets in once by asking
	// the computer (its user allows it there) or with a `#pair=` link from
	// its QR code, and connects directly from then on. Each connected
	// computer keeps its own live connection and view (HostView), and the
	// switcher in the list header picks the one shown.
	import { onMount, untrack, type Component } from 'svelte';
	import { dev } from '$app/environment';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { reregister } from '$lib/remote/push';
	import { forgetLists } from '$lib/remote/cache';
	import { toast } from '$lib/ui/toast.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import HostView from '$lib/remote/HostView.svelte';
	import { HostConnection, type ConnectionTone } from '$lib/remote/connection.svelte';
	import { Computers, platformName, type Computer } from '$lib/remote/computers.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import { auth, deviceName } from '$lib/web/auth.svelte';
	import { loadActive, loadPaired, pairLinkProblem, parsePairLink, saveActive, unmarkPaired, type PairLink } from '$lib/relay/pairing';
	import { when } from '$lib/time';
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

	/** The account's computers, the ones this browser is paired with, and a
	 *  live connection to each computer opened here. */
	const computers = new Computers();
	let paired = $state<string[]>([]);
	let conns = $state<HostConnection[]>([]);
	/** The computer shown. */
	let activeId = $state<string | null>(null);
	const active = $derived(conns.find((c) => c.id === activeId) ?? conns[0] ?? null);

	let mounted = $state(false);
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

	/** The computer list, shown over the connected computers. */
	let listing = $state(false);
	/** What fills the page. */
	const view = $derived(
		!mounted
			? null
			: pendingLink || installGuide
				? 'install'
				: listing || active
					? listing || !active ? 'list' : 'app'
					: // The paired computers connect once the list is in.
						!computers.loaded && !computers.error && paired.length
						? 'loading'
						: 'list'
	);
	$effect(() => {
		if (view === 'list') loadScanner();
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
		pasted = '';
		pairWith(link);
	}
	function continueInBrowser() {
		installGuide = false;
		const link = pendingLink;
		pendingLink = null;
		if (link) pairWith(link);
	}
	function showList() {
		switchMenu = false;
		linkError = '';
		pasted = '';
		listing = true;
	}

	/** Connects to a computer; `admit` goes along until its daemon accepts
	 *  this device once. A computer already connected is replaced. */
	function connect(computer: Computer, admit: { pair?: string; request?: boolean } = {}) {
		const old = conns.find((c) => c.id === computer.host_id);
		old?.stop();
		const conn = HostConnection.relay(computer, (refresh) => auth.token(refresh), deviceName(), admit);
		conns = old ? conns.map((c) => (c === old ? conn : c)) : [...conns, conn];
		conn.start();
	}

	/** A computer's row was picked: shown when connected, else connected to,
	 *  asking the computer first when this browser is not paired with it. */
	function openComputer(computer: Computer) {
		paired = loadPaired();
		if (!conns.some((c) => c.id === computer.host_id)) connect(computer, isPaired(computer.host_id) ? {} : { request: true });
		select(computer.host_id);
	}

	/** Pairs with a scanned or pasted link: the computer must be the
	 *  account's, with the key the account knows for it. */
	function pairWith(link: PairLink) {
		const problem = pairLinkProblem(link, computers.list);
		const computer = computers.get(link.hostId);
		if (problem || !computer) {
			linkError = t(problem ?? 'shell.remote.notInAccount');
			listing = true;
			return;
		}
		linkError = '';
		connect(computer, { pair: link.code });
		select(computer.host_id);
	}

	/** Closes a connection (a waiting request is cancelled) and shows the list. */
	function close(conn: HostConnection) {
		conn.stop();
		conns = conns.filter((c) => c !== conn);
		showList();
	}

	function select(id: string) {
		switchMenu = false;
		listing = false;
		activeId = id;
		saveActive(id);
	}

	/** This browser connected to the computer before (as of the last list
	 *  refresh, which reads the marks again). */
	const isPaired = (hostId: string) => paired.includes(hostId);

	function nameOf(hostId: string): string {
		return computers.get(hostId)?.name || t('shell.remote.computer');
	}

	/** A row's dot and state: its connection's, else whether it is online. */
	function rowState(computer: Computer): { tone: ConnectionTone; text: string } {
		const conn = conns.find((c) => c.id === computer.host_id);
		if (conn) return { tone: conn.state.tone, text: t(conn.state.short) };
		if (computer.online) return { tone: 'ok', text: t('shell.remote.online') };
		const seen = Date.parse(computer.last_seen_at);
		return { tone: 'off', text: Number.isFinite(seen) ? t('shell.remote.offlineSince', { time: when(seen) }) : t('shell.remote.hostOffline') };
	}

	/** The link this page was opened with, used once the list is in. */
	let openedLink: PairLink | null = null;
	let firstLoad = true;
	async function refreshList() {
		try {
			await computers.refresh();
		} catch {
			return;
		}
		const ids = new Set(computers.list.map((c) => c.host_id));
		// Computers removed from the account: their marks and connections go.
		for (const id of loadPaired()) if (!ids.has(id)) unmarkPaired(id);
		paired = loadPaired();
		for (const conn of conns.filter((c) => !ids.has(c.id))) conn.stop();
		conns = conns.filter((c) => ids.has(c.id));
		if (!firstLoad) return;
		firstLoad = false;
		// The paired computers connect at once; the linked one with its code.
		for (const computer of computers.list)
			if (paired.includes(computer.host_id) && computer.host_id !== openedLink?.hostId) connect(computer);
		activeId = loadActive();
		const link = openedLink;
		openedLink = null;
		if (link && isIos() && !isStandalone()) pendingLink = link;
		else if (link) pairWith(link);
	}
	// The list is fresh when shown (the list page or the switcher's menu),
	// and every 30 s while it stays shown.
	$effect(() => {
		if (view !== 'list' && view !== 'loading' && !switchMenu) return;
		untrack(() => void refreshList());
		const timer = setInterval(() => document.visibilityState === 'visible' && void refreshList(), 30_000);
		return () => clearInterval(timer);
	});

	async function rename(computer: Computer) {
		switchMenu = false;
		menuFor = null;
		const next = prompt(t('shell.remote.renameComputerPrompt'), computer.name);
		if (next === null) return;
		try {
			await computers.rename(computer.host_id, next);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	async function remove(computer: Computer) {
		switchMenu = false;
		menuFor = null;
		const ok = await confirm({
			title: t('shell.remote.removeComputer'),
			message: t('shell.remote.removeComputerConfirm', { name: computer.name || t('shell.remote.computer') }),
			confirmLabel: t('shell.remote.removeComputer'),
			danger: true
		});
		if (!ok) return;
		try {
			await computers.remove(computer.host_id);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
			return;
		}
		const conn = conns.find((c) => c.id === computer.host_id);
		conn?.stop();
		conns = conns.filter((c) => c !== conn);
		unmarkPaired(computer.host_id);
		paired = loadPaired();
		forgetLists(computer.host_id);
	}
	/** The computer whose row menu is open. */
	let menuFor = $state<string | null>(null);

	onMount(() => {
		embedded = inAppBrowser();
		const onInstallPrompt = (e: Event) => {
			e.preventDefault();
			installPrompt = e as InstallPrompt;
		};
		window.addEventListener('beforeinstallprompt', onInstallPrompt);
		openedLink = parsePairLink(location.href);
		// Keep the one-time code out of history and bookmarks.
		if (location.hash) history.replaceState(null, '', location.pathname);
		paired = loadPaired();
		mounted = true;
		reregister().catch(() => {});

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
			window.removeEventListener('beforeinstallprompt', onInstallPrompt);
			for (const conn of conns) conn.stop();
		};
	});

	/** Back in the foreground or online again: check every computer's
	 *  connection now (see HostConnection.wake). */
	function wakeAll() {
		for (const conn of conns) void conn.wake();
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

<svelte:window onkeydown={(e) => switchMenu && e.key === 'Escape' && (switchMenu = false)} ononline={wakeAll} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'visible' && wakeAll()} />

<!-- The computer switcher: the shown computer and how its connection is
     doing; the menu switches between the account's computers, renames and
     removes them, and opens the full list (with QR pairing). -->
{#snippet switcher(foot = false)}
	{#if active}
		<div class="conn-wrap">
			<button
				class="conn {active.state.tone}"
				class:foot
				class:on={switchMenu}
				onclick={() => (switchMenu = !switchMenu)}
				aria-haspopup="menu"
				aria-expanded={switchMenu}
				title={t(active.state.text)}
			>
				<span class="dot" class:pulse={active.state.tone === 'wait'}></span>
				{#if foot}
					<span class="conn-two">
						<span class="conn-text">{nameOf(active.id)}</span>
						<span class="conn-state">{t(active.state.short)}</span>
					</span>
					<ChevronsUpDownIcon size={14} />
				{:else}
					<span class="conn-text">{nameOf(active.id)}</span>
					<ChevronDownIcon size={12} />
				{/if}
			</button>
			{#if switchMenu}
				{@const shown = computers.get(active.id)}
				<button class="backdrop" aria-label="close menu" tabindex="-1" onclick={() => (switchMenu = false)}></button>
				<div class="pop switch-menu" class:left={wide} role="menu">
					{#if !foot}
						<!-- The remote computers are one part of the web app. -->
						<a class="pop-row" role="menuitem" href="/chat" data-sveltekit-reload>
							<span class="pop-ico"><MessageSquareTextIcon size={16} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.backToChat')}</span></span>
						</a>
						<div class="sep"></div>
					{/if}
					<div class="pop-head">{t('shell.remote.computers')}</div>
					{#each computers.list as computer (computer.host_id)}
						{@const state = rowState(computer)}
						{@const conn = conns.find((c) => c.id === computer.host_id)}
						<button
							class="pop-row two"
							role="menuitemradio"
							aria-checked={conn === active}
							onclick={() => openComputer(computer)}
						>
							<span class="pop-ico"><span class="dot {state.tone}" class:pulse={state.tone === 'wait'}></span></span>
							<span class="pop-txt">
								<span class="pop-label">{computer.name || t('shell.remote.computer')}</span>
								<span class="pop-desc">{conn === active ? t(active.state.text) : state.text}</span>
							</span>
							{#if conn && conn !== active && conn.daemonState.actions.length > 0}<span class="count">{conn.daemonState.actions.length}</span>{/if}
							{#if conn === active}<span class="pop-check"><CheckIcon size={16} /></span>{/if}
						</button>
					{/each}
					<div class="sep"></div>
					<button class="pop-row" role="menuitem" onclick={showList}>
						<span class="pop-ico"><MonitorIcon size={16} /></span>
						<span class="pop-txt"><span class="pop-label">{t('shell.remote.allComputers')}</span></span>
					</button>
					{#if shown}
						<button class="pop-row" role="menuitem" onclick={() => rename(shown)}>
							<span class="pop-ico"><PencilIcon size={16} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.renameComputer', { name: nameOf(shown.host_id) })}</span></span>
						</button>
					{/if}
					{#if canInstall}
						<button class="pop-row" role="menuitem" onclick={install}>
							<span class="pop-ico"><DownloadIcon size={16} /></span>
							<span class="pop-txt"><span class="pop-label">{t('shell.remote.install')}</span></span>
						</button>
					{/if}
					<button class="pop-row" role="menuitem" onclick={openLicenses}>
						<span class="pop-ico"><ScrollTextIcon size={16} /></span>
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
		<Button disabled={scanning} onclick={openScanner}>
			{#if scanning}<LoaderCircleIcon size={16} class="spin" />{:else}<QrCodeIcon size={16} />{/if}
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
	{#if view === 'install'}
		<div class="pair">
			<span class="hero"><SmartphoneIcon size={28} /></span>
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
	{:else if view === 'loading'}
		<div class="pair"><LoaderCircleIcon size={20} class="spin" /></div>
	{:else if view === 'list'}
		<div class="pair">
			{#if conns.length}
				<button class="cancel" onclick={() => ((listing = false), (scanning = false))} aria-label={t('shell.remote.back')}>
					<ArrowLeftIcon size={16} />
				</button>
			{/if}
			<span class="hero"><MonitorIcon size={28} /></span>
			<h1>{t('shell.remote.computersTitle')}</h1>
			<p>{t('shell.remote.computersHint')}</p>
			<div class="computers">
				{#each computers.list as computer (computer.host_id)}
					{@const state = rowState(computer)}
					<div class="computer" class:menu={menuFor === computer.host_id}>
						<button class="computer-main" onclick={() => openComputer(computer)}>
							<span class="dot {state.tone}" class:pulse={state.tone === 'wait'}></span>
							<span class="computer-txt">
								<span class="computer-name">{computer.name || t('shell.remote.computer')}</span>
								<span class="computer-desc">
									{[platformName(computer.platform), state.text, isPaired(computer.host_id) ? t('shell.remote.paired') : ''].filter(Boolean).join(' · ')}
								</span>
							</span>
							<span class="computer-act">{isPaired(computer.host_id) ? t('shell.remote.open') : t('shell.remote.connect')}</span>
						</button>
						<span class="more-anchor">
							<button class="more" onclick={() => (menuFor = menuFor === computer.host_id ? null : computer.host_id)} aria-label={t('shell.remote.more')}>
								<EllipsisIcon size={16} />
							</button>
							{#if menuFor === computer.host_id}
								<PopMenu
									placement="down-left"
									items={[
										{ key: 'rename', label: t('shell.remote.rename'), icon: PencilIcon },
										// Only an offline one: a computer still signed in comes back on its own.
										...(computer.online ? [] : [{ key: 'remove', label: t('shell.remote.removeComputer'), icon: TrashIcon, tone: 'warn' as const }])
									]}
									onSelect={(k) => (k === 'rename' ? rename(computer) : remove(computer))}
									onClose={() => (menuFor = null)}
								/>
							{/if}
						</span>
					</div>
				{:else}
					{#if computers.loaded}
						<p class="none">{t('shell.remote.noComputers')}</p>
					{:else if !computers.error}
						<p class="none"><LoaderCircleIcon size={16} class="spin" /></p>
					{/if}
				{/each}
				{#if computers.error}<Notice>{t('shell.remote.listFailed', { msg: computers.error })}</Notice>{/if}
				<button class="refresh" onclick={() => void refreshList()}><RotateCwIcon size={14} /> {t('shell.remote.refresh')}</button>
			</div>
			<p class="or">{t('shell.remote.scanHint')}</p>
			{@render linkEntry()}
			<a class="licenses" href="/chat">{t('shell.remote.backToChat')}</a>
			<a class="licenses" href={LICENSES_URL} target="_blank" rel="noopener">{t('shell.remote.licenses')}</a>
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
			name={nameOf(conn.id)}
			hostName={conns.length > 1 ? nameOf(conn.id) : undefined}
			hidden={view !== 'app' || conn !== active}
			{wide}
			{screens}
			{switcher}
			{resizer}
			chatHref="/chat"
			onAdd={showList}
			onRequest={() => {
				const computer = computers.get(conn.id);
				if (computer) connect(computer, { request: true });
			}}
			onCancel={() => close(conn)}
		/>
	{/each}
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
	/* Wide screens: the list in a resizable left column, pages in the right
	   one (HostView fills both). */
	.remote.wide {
		display: grid;
		grid-template-columns: var(--side-w) 1fr;
		/* One row the window's height: the list scrolls inside its column and
		   the pane's pages fill the window, instead of the row growing with
		   the list (which pushed the pane's middle off screen). */
		grid-template-rows: minmax(0, 1fr);
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
	/* The account's computers: one row each, the menu at its end. */
	.computers {
		align-self: stretch;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 20px;
		text-align: left;
	}
	.computer {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: var(--r);
		transition: background var(--t-fast) var(--ease-out);
	}
	.computer:hover,
	.computer.menu {
		background: var(--surface);
	}
	.computer-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.computer-txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.computer-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-md);
		font-weight: 500;
	}
	.computer-desc {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.computer-act {
		flex-shrink: 0;
		font-size: var(--fs-sm);
		color: var(--accent-bright);
	}
	.more-anchor {
		position: relative;
		display: inline-flex;
	}
	.more {
		display: inline-flex;
		padding: 6px;
		margin-right: 4px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.more:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.none {
		margin: 8px 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		text-align: center;
	}
	.refresh {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
		padding: 6px 8px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.refresh:hover {
		background: var(--surface);
		color: var(--text);
	}
	.pair p.or {
		margin-top: 28px;
		font-size: var(--fs-sm);
	}
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
		border-radius: var(--r);
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
	input:focus {
		border-color: var(--border-strong);
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
		border-radius: var(--r);
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
		animation: drop-in var(--t-med) var(--ease-out);
	}
	.switch-menu.left {
		right: auto;
		left: 0;
		transform-origin: top left;
	}
	/* The wide sidebar's head: a full row naming the computer and its state. */
	.conn.foot {
		display: flex;
		width: 100%;
		height: auto;
		gap: 10px;
		padding: 8px 10px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		text-align: left;
	}
	.conn.foot:hover,
	.conn.foot.on {
		background: var(--surface2);
	}
	.conn.foot:active {
		transform: none;
	}
	.conn.foot.on :global(svg) {
		transform: none;
	}
	.conn-two {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.conn.foot .conn-text {
		max-width: none;
		font-weight: 500;
	}
	.conn-state {
		font-size: var(--fs-2xs);
		color: var(--dim2);
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
		border-radius: var(--r);
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
		border-radius: var(--r);
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
