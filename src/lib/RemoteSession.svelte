<script lang="ts">
	// One daemon session on the remote page: the conversation, a pending
	// approval and a composer laid out like the desktop's (ChatPane /
	// Composer). Watching it makes the session attended, so approvals prompt
	// here; leaving only unwatches it.
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import FilesIcon from 'phosphor-svelte/lib/FilesIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import ModelMenu from '$lib/remote/ModelMenu.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { ChatState } from '$lib/chat.svelte';
	import { createJucodeAdapter } from '$lib/backends/jucode';
	import { effortLabel } from '$lib/composer/effort';
	import { modelColor, isTopEffort } from '$lib/modelColor';
	import type { JucodeGroup, Op } from '$lib/protocol';
	import { useHost } from '$lib/remote/connection.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { BACKEND_LABELS } from '$lib/backends';
	import type { ApproveOp } from '$lib/approval';
	import { t } from '$lib/i18n';

	let {
		session,
		agent,
		cwd,
		chat: isChat = false,
		engine,
		title,
		hostName,
		register,
		onBack,
		onFiles,
		onChanges
	}: {
		/** An existing session; omit to start a new one as `agent`, in `cwd`,
		 *  or as a chat. */
		session?: string;
		agent?: string;
		/** The session's directory; also lets the daemon reopen a session
		 *  saved there that it never hosted. */
		cwd?: string;
		chat?: boolean;
		/** Another engine the daemon runs the session on (`claude`). */
		engine?: string;
		title: string;
		/** The computer the session runs on, when several are paired. */
		hostName?: string;
		/** Shows the project's files / changes. */
		onFiles?: () => void;
		onChanges?: () => void;
		/** Routes daemon frames and exits for `id` here; returns an unregister. */
		register: (id: string, onFrame: (raw: string) => void, onExit: () => void) => () => void;
		onBack: () => void;
	} = $props();
	const { daemon, agents: agentDirectory } = useHost();

	const id = `remote-${Math.random().toString(36).slice(2)}`;
	const chat = new ChatState();
	const adapter = createJucodeAdapter();
	let text = $state('');
	let error = $state('');
	let exited = $state(false);
	/** Set once the session is open here; sending earlier would fail and the
	 *  arriving snapshot would wipe the optimistic message. */
	let connected = $state(false);
	/** A new session is a draft: the daemon creates it with the first
	 *  message, so opening the page and leaving creates nothing. */
	let draft = $state(untrack(() => !session));
	let scroller = $state<HTMLElement | null>(null);
	let contentEl = $state<HTMLElement | null>(null);
	let input = $state<HTMLTextAreaElement | null>(null);
	let unregister = () => {};

	const streamingMsg = $derived.by(() => {
		if (!chat.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'assistant' ? last : null;
	});
	const streamingReasoning = $derived.by(() => {
		if (!chat.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'reasoning' && !last.collapsed ? last : null;
	});

	function onFrame(raw: string) {
		let frame: unknown;
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}
		for (const event of adapter.translate(frame)) chat.handle(event);
	}

	// Stick to the bottom while the content grows (the snapshot, streaming
	// text, new cards) unless the reader scrolled up, as the desktop does.
	let atBottom = $state(true);
	function onScroll() {
		if (scroller) atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
	}
	$effect(() => {
		if (!contentEl || !scroller) return;
		const ro = new ResizeObserver(() => {
			if (atBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
		});
		ro.observe(contentEl);
		return () => ro.disconnect();
	});
	function jumpToBottom() {
		atBottom = true;
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	}

	async function connect() {
		error = '';
		exited = false;
		connected = false;
		try {
			// A new session gets its id from the snapshot; later reconnects
			// reopen that same session.
			const resume = session ?? (chat.sessionId || undefined);
			await daemon.open(
				id,
				cwd ?? '',
				resume,
				resume ? undefined : agent,
				!resume && !agent && isChat,
				engine && engine !== 'jucode' ? { engine, options: {} } : undefined
			);
			connected = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			exited = true;
		}
	}

	onMount(() => {
		chat.title = title;
		unregister = register(id, onFrame, () => {
			exited = true;
			connected = false;
		});
		if (!draft) void connect();
	});
	onDestroy(() => {
		unregister();
		daemon.detach(id);
	});

	function send(op: Op) {
		for (const line of adapter.encodeOp(op) ?? []) {
			daemon.send(id, line).catch((e) => (error = String(e)));
		}
	}

	/** Phones send with the button (Enter is a new line); keyboards with Enter. */
	const enterSends = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.isComposing) return;
		if (e.metaKey || e.ctrlKey || (!e.shiftKey && enterSends())) {
			e.preventDefault();
			submit();
		}
	}
	/** The field grows with its text up to a cap (no field-sizing on iOS). */
	function autosize() {
		if (!input) return;
		input.style.height = 'auto';
		input.style.height = `${input.scrollHeight}px`;
	}

	async function submit() {
		const content = text.trim();
		if (!content) return;
		if (draft) {
			draft = false;
			await connect();
		}
		if (!connected) return;
		chat.optimisticUser(content);
		send({ op: 'user_message', content });
		text = '';
		atBottom = true;
		tick().then(autosize);
	}

	// Stop shows at once; the button leaves when the turn ends.
	let stopping = $state(false);
	$effect(() => {
		if (!chat.busy) stopping = false;
	});
	function stop() {
		stopping = true;
		send({ op: 'interrupt' });
	}

	// The model menu opens from the last catalog while `/model` fetches a
	// fresh one. A pick shows on the button right away, dimmed until the
	// engine's model_status confirms it.
	let modelButton = $state<HTMLButtonElement>();
	let modelOpen = $state(false);
	let pendingModel = $state('');
	let pendingTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void chat.model;
		pendingModel = '';
		clearTimeout(pendingTimer);
	});
	function openModels() {
		if (modelOpen) return closeModels();
		chat.closePicker();
		modelOpen = true;
		send({ op: 'command', input: '/model' });
		if (toolSession) loadCatalog();
	}

	// Claude Code / Codex run on this machine's own login or on the JuCode
	// gateway; the daemon knows which, and what the gateway offers.
	const sid = $derived(chat.sessionId || session || '');
	const view = $derived(agentDirectory.sessions.find((x) => x.session === sid));
	const toolSession = $derived((engine === 'claude' || engine === 'codex') && !!sid);
	let catalog = $state<{ models: { name: string; context_window?: number }[]; groups: JucodeGroup[] } | null>(null);
	function loadCatalog() {
		daemon
			.request({ op: 'gateway_catalog' })
			.then((r) => {
				catalog = {
					models: Array.isArray(r.models) ? (r.models as { name: string }[]) : [],
					groups: Array.isArray(r.groups) ? (r.groups as JucodeGroup[]) : []
				};
			})
			.catch(() => (catalog = { models: [], groups: [] }));
	}
	function setGroup(group: string) {
		daemon.request({ op: 'session_meta', session: sid, group }).catch((e) => (error = String(e)));
	}
	/** Moves the session between this machine and the gateway; the daemon
	 *  restarts its engine once the running turn ends and it resumes. */
	async function switchSide(gateway: boolean, model: string, group?: string) {
		closeModels();
		if (chat.messages.some((m) => m.kind === 'user')) {
			const ok = await confirm({
				title: t(gateway ? 'shell.toolSwitch.confirmJucode' : 'shell.toolSwitch.confirmSystem'),
				message: t('shell.toolSwitch.confirmBody'),
				confirmLabel: t('shell.toolSwitch.confirm')
			});
			if (!ok) return;
		}
		if (group !== undefined) setGroup(group);
		pendingModel = model;
		clearTimeout(pendingTimer);
		pendingTimer = setTimeout(() => (pendingModel = ''), 30_000);
		daemon.send(id, JSON.stringify({ op: 'set_gateway', gateway, model })).catch((e) => (error = String(e)));
	}
	function closeModels() {
		modelOpen = false;
		chat.closePicker();
	}
	function pickModel(model: string) {
		closeModels();
		if (model === chat.model) return;
		pendingModel = model;
		// No confirmation (an engine that ignored the switch): show the model
		// that is actually running again.
		clearTimeout(pendingTimer);
		pendingTimer = setTimeout(() => (pendingModel = ''), 15_000);
		send({ op: 'command', input: `/model ${model}` });
	}
	function setEffort(effort: string) {
		if (chat.model && !pendingModel) send({ op: 'command', input: `/model ${chat.model} ${effort}` });
	}
	const shownModel = $derived.by(() => {
		if (!pendingModel) return { id: chat.model, label: chat.modelLabel || chat.model };
		const row = chat.modelCatalog.find((m) => m.model === pendingModel);
		return { id: row?.vendor ?? pendingModel, label: row?.label || pendingModel };
	});

	function respond(op: ApproveOp) {
		send(op);
		chat.pendingApproval = null;
	}

	const opening = $derived(!draft && !connected && !exited);
</script>

<div class="session">
	<header>
		<button class="back" onclick={onBack} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={18} /></button>
		<span class="heading">
			<span class="title">{title}</span>
			{#if hostName}<span class="host"><DesktopIcon size={11} /><span>{hostName}</span></span>{/if}
		</span>
		{#if chat.busy}<span class="busy pulse"></span>{/if}
		{#if onFiles}<button class="back" onclick={onFiles} aria-label={t('shell.remote.files')}><FilesIcon size={18} /></button>{/if}
		{#if onChanges}<button class="back" onclick={onChanges} aria-label={t('shell.remote.changes')}><GitDiffIcon size={18} /></button>{/if}
	</header>

	<main class="scroll" bind:this={scroller} onscroll={onScroll}>
		<div class="thread" bind:this={contentEl}>
			<MessageList
				messages={chat.messages}
				{streamingMsg}
				{streamingReasoning}
				phase={chat.phase}
				compactionTokens={chat.compactionTokens}
				{scroller}
				onEdit={(value) => {
					text = value;
					tick().then(() => (autosize(), input?.focus()));
				}}
				onRewind={() => {}}
			/>
		</div>
		{#if opening && chat.messages.length === 0}
			<div class="welcome">
				<span class="spawn-spin"><CircleNotchIcon size={26} class="spin" /></span>
				<p class="welcome-tip">{t('shell.remote.openingSession')}</p>
			</div>
		{:else if (draft || connected) && chat.messages.length === 0 && !chat.busy}
			<div class="welcome"><p class="welcome-tip">{t('shell.welcomeTip')}</p></div>
		{/if}
	</main>

	<div class="bottom">
		{#if !atBottom}
			<button class="jump" onclick={jumpToBottom} aria-label={t('shell.remote.back')}><CaretDownIcon size={18} /></button>
		{/if}
		{#if chat.pendingApproval}
			<div class="approval">
				{#key chat.pendingApproval.callId}
					<ApprovalCard approval={chat.pendingApproval} onRespond={respond} />
				{/key}
			</div>
		{/if}

		{#if exited}
			<div class="exit">
				<div class="exit-msg"><Notice tone={error ? 'error' : 'warn'}>{error || t('shell.remote.disconnected')}</Notice></div>
				<Button size="sm" onclick={connect}><ArrowClockwiseIcon size={13} /> {t('shell.remote.reconnect')}</Button>
			</div>
		{/if}

		<div class="composer-wrap">
			<form class="composer" onsubmit={(e) => (e.preventDefault(), submit())}>
				<textarea
					rows="1"
					bind:this={input}
					bind:value={text}
					placeholder={t('shell.remote.messagePlaceholder')}
					oninput={autosize}
					onkeydown={onKey}
				></textarea>
				<div class="composer-bar">
					<div class="cspace"></div>
					{#if chat.model}
						<button
							type="button"
							class="flatbtn model"
							class:pending={!!pendingModel}
							class:on={modelOpen}
							bind:this={modelButton}
							disabled={!connected}
							onclick={openModels}
							title={t('chat.switchModel')}
							aria-haspopup="dialog"
							aria-expanded={modelOpen}
						>
							{#key shownModel.id}
								<span class="mswap">
									{#if !engine || engine === 'jucode'}<Vendor model={shownModel.id} size={15} />{:else}<BackendIcon backend={engine as 'claude'} size={15} />{/if}
									<span class="m">{shownModel.label}</span>
								</span>
							{/key}
							{#if chat.efforts.length && chat.effort}{#key chat.effort}<span
										class="e"
										class:effort-max={isTopEffort(chat.effort, chat.efforts)}
										style:--effort-accent={modelColor(chat.model) || 'var(--text)'}>{effortLabel(chat.effort)}</span
									>{/key}{/if}
						</button>
					{/if}
					{#if chat.busy}
						<button type="button" class="cact stop" disabled={stopping} onclick={stop} aria-label={t('chat.stopTitle')} title={t('chat.stopTitle')}>
							{#if stopping}<CircleNotchIcon size={15} class="spin" />{:else}<SquareIcon size={15} weight="fill" />{/if}
						</button>
					{:else}
						<button type="submit" class="cact send" disabled={!text.trim() || (!connected && !draft)} aria-label={t('chat.sendTitle')} title={t('chat.sendTitle')}>
							{#if opening && text.trim()}<CircleNotchIcon size={15} class="spin" />{:else}<ArrowUpIcon size={17} />{/if}
						</button>
					{/if}
				</div>
			</form>
		</div>
	</div>

	{#if modelOpen}
		<ModelMenu
			{chat}
			anchor={modelButton}
			{pendingModel}
			tool={toolSession
				? {
						name: BACKEND_LABELS[engine as 'claude' | 'codex'],
						onJucode: !!view?.gateway,
						group: view?.group ?? '',
						catalog,
						onSwitch: switchSide,
						onGroup: setGroup
					}
				: undefined}
			onPick={pickModel}
			onEffort={setEffort}
			onClose={closeModels}
		/>
	{/if}
</div>

<style>
	.session {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		z-index: 10;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: calc(env(safe-area-inset-top) + 8px) 12px 8px;
		border-bottom: 1px solid var(--hairline);
		background: var(--panel);
	}
	.back {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.back:hover {
		background: var(--surface2);
	}
	.back:active {
		transform: scale(0.92);
	}
	.heading {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		font-weight: 600;
		font-size: var(--fs-lg);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.host {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.host span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.host :global(svg) {
		flex-shrink: 0;
	}
	.busy {
		width: 8px;
		height: 8px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--accent-bright);
	}
	/* The conversation column, as on the desktop: centered, 880px at most. */
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		padding: 18px max(14px, calc((100% - 880px) / 2)) 16px;
	}
	.welcome {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		animation: rise var(--t-slow) var(--ease-out) both;
	}
	.spawn-spin {
		display: inline-flex;
		color: var(--accent);
	}
	.welcome-tip {
		margin: 0;
		font-size: var(--fs-md);
		color: var(--dim);
	}
	.bottom {
		position: relative;
		flex-shrink: 0;
	}
	.jump {
		position: absolute;
		left: 50%;
		bottom: calc(100% + 10px);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
		transform: translateX(-50%);
		cursor: pointer;
		animation: jump-in var(--t-med) var(--ease-spring);
		transition: transform var(--t-fast) var(--ease-spring);
	}
	@keyframes jump-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(6px) scale(0.9);
		}
	}
	.jump:active {
		transform: translateX(-50%) scale(0.92);
	}
	.approval,
	.exit {
		max-width: 880px;
		margin: 0 auto;
		padding: 0 14px 10px;
		animation: rise var(--t-med) var(--ease-out);
	}
	.approval {
		max-height: 50vh;
		overflow-y: auto;
	}
	.exit {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.exit-msg {
		flex: 1;
		min-width: 0;
	}
	/* The desktop composer: a floating card, the text on top, the model and
	   send / stop in a row under it. */
	.composer-wrap {
		max-width: 920px;
		margin: 0 auto;
		padding: 0 12px calc(env(safe-area-inset-bottom) + 12px);
	}
	.composer {
		padding: 12px 12px 10px 16px;
		border-radius: var(--r-2xl);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		transition: box-shadow var(--t-med) var(--ease-out);
	}
	.composer:focus-within {
		box-shadow: var(--shadow-float-strong);
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 26px;
		max-height: 40vh;
		padding: 2px 0 8px;
		border: none;
		background: transparent;
		color: var(--text);
		/* 16px keeps iOS from zooming into the field. */
		font-family: var(--font-sans);
		font-size: var(--fs-md);
		line-height: 1.55;
		resize: none;
		outline: none;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	.composer-bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cspace {
		flex: 1;
	}
	.flatbtn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 5px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			opacity var(--t-med) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.flatbtn:hover:not(:disabled),
	.flatbtn.on {
		background: var(--surface2);
	}
	.flatbtn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.flatbtn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.flatbtn.model span {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.flatbtn.model .m {
		max-width: min(220px, 42vw);
	}
	.flatbtn.model.pending {
		opacity: 0.6;
	}
	.mswap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		animation: model-in var(--t-med) var(--ease-spring);
	}
	@keyframes model-in {
		from {
			opacity: 0;
			transform: translateY(8px);
			filter: blur(3px);
		}
	}
	.flatbtn.model .e {
		flex-shrink: 0;
		color: var(--dim);
		animation: rise var(--t-fast) var(--ease-out);
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r-full);
		cursor: pointer;
		transition:
			transform var(--t-fast) var(--ease-spring),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			opacity var(--t-med) var(--ease-out);
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.cact:active:not(:disabled) {
		transform: scale(0.9);
	}
	.cact.send {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cact.send:hover:not(:disabled) {
		opacity: 0.85;
	}
	.cact.send:disabled {
		background: color-mix(in oklab, var(--text) 32%, var(--panel));
		cursor: default;
	}
	.cact.stop {
		background: color-mix(in oklab, var(--err) 14%, transparent);
		color: var(--err);
	}
	.cact.stop:hover:not(:disabled) {
		background: color-mix(in oklab, var(--err) 22%, transparent);
	}
	.cact.stop:disabled {
		cursor: default;
	}
</style>
