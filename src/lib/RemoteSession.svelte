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
	import FastForwardIcon from 'phosphor-svelte/lib/FastForwardIcon';
	import HandIcon from 'phosphor-svelte/lib/HandIcon';
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import ShieldWarningIcon from 'phosphor-svelte/lib/ShieldWarningIcon';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';
	import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
	import FileIcon from 'phosphor-svelte/lib/FileIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { sendFile, type Uploaded } from '$lib/upload';
	import { loadSession, saveSession } from '$lib/remote/cache';
	import ModelMenu from '$lib/remote/ModelMenu.svelte';
	import TaskStrip from '$lib/TaskStrip.svelte';
	import AgentRunsPanel from '$lib/AgentRunsPanel.svelte';
	import TreeStructureIcon from 'phosphor-svelte/lib/TreeStructureIcon';
	import type { Msg } from '$lib/chat.svelte';
	import type { SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
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
	import { BACKEND_LABELS, caps } from '$lib/backends';
	import { buildSetApprovalModeOp, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
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
	const host = useHost();
	const { daemon, agents: agentDirectory } = host;

	const id = `remote-${Math.random().toString(36).slice(2)}`;
	const chat = new ChatState();
	// The session belongs to the computer: show its approval mode as it is.
	chat.followEngineMode = true;
	const adapter = createJucodeAdapter();
	// Unsent text is kept on this device per conversation (a new one by where
	// it would start), so leaving the page or closing the app keeps it.
	const textKey = untrack(
		() => `${host.id}:${session ?? `new:${agent ?? ''}:${isChat ? 'chat' : (cwd ?? '')}:${engine ?? ''}`}`
	);
	let text = $state(loadComposerText(textKey));
	$effect(() => saveComposerText(textKey, text));
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
		// The computer's own copy replaces the one kept on this phone.
		if ((frame as { type?: string }).type === 'transcript') fromCache = false;
		for (const event of adapter.translate(frame)) chat.handle(event);
	}

	// The conversation as last seen here shows at once, before the computer
	// (maybe over a weak network) sends it; it is kept again after each turn.
	let fromCache = $state(false);
	const cacheKey = $derived(chat.sessionId || session ? `${host.id}:${chat.sessionId || session}` : '');
	function keep() {
		if (cacheKey && !fromCache && chat.messages.length) void saveSession(cacheKey, chat.messages, title);
	}
	$effect(() => {
		// After each turn, with the conversation as it now stands.
		if (!chat.busy && connected) untrack(keep);
	});

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

	/** The connection to the computer dropped (rather than the session being
	 *  closed there): the page reopens it on its own once the computer is back,
	 *  a few times, before falling back to the reconnect button. */
	let dropped = $state(false);
	let retries = $state(0);
	const RETRY_DELAYS = [0, 2000, 5000];
	const reconnecting = $derived(exited && dropped && retries < RETRY_DELAYS.length);
	let wasOn = untrack(() => agentDirectory.status === 'on');
	$effect(() => {
		const on = agentDirectory.status === 'on';
		// The computer is back: start the attempts afresh.
		if (on && !wasOn) retries = 0;
		wasOn = on;
		if (!on || !reconnecting || draft) return;
		const timer = setTimeout(() => {
			retries += 1;
			void connect();
		}, RETRY_DELAYS[retries]);
		return () => clearTimeout(timer);
	});

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
			dropped = false;
			retries = 0;
			// An approval mode picked before the first message.
			if (draftMode) {
				applyMode(draftMode);
				draftMode = null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			exited = true;
		}
	}

	onMount(() => {
		chat.title = title;
		if (session)
			void loadSession<(typeof chat.messages)[number]>(`${host.id}:${session}`).then((kept) => {
				if (kept && !chat.messages.length) {
					chat.messages = kept.messages;
					fromCache = true;
				}
			});
		unregister = register(id, onFrame, () => {
			exited = true;
			connected = false;
			// The connection's own disconnect is handled before its sessions
			// exit, so a computer that still looks reachable closed the session.
			dropped = agentDirectory.status !== 'on';
		});
		if (!draft) void connect();
		if (text) tick().then(autosize);
	});
	onDestroy(() => {
		keep();
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

	// Images and files sent along: each goes to the computer as soon as it is
	// picked or pasted (through the relay, encrypted), and the message names
	// the paths there, as the desktop's attachments do.
	type Attachment = { key: number; name: string; url?: string; sent: number; total: number; done?: Uploaded; error?: string };
	let attachments = $state<Attachment[]>([]);
	let attachKey = 0;
	let picker = $state<HTMLInputElement | null>(null);
	const uploading = $derived(attachments.some((a) => !a.done && !a.error));
	const attached = $derived(attachments.flatMap((a) => (a.done ? [a.done] : [])));
	function attach(files: Iterable<File>) {
		for (const file of files) {
			const key = ++attachKey;
			attachments.push({
				key,
				name: file.name,
				url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
				sent: 0,
				total: file.size
			});
			const entry = () => attachments.find((a) => a.key === key);
			sendFile(daemon, file, (sent, total) => {
				const a = entry();
				if (a) Object.assign(a, { sent, total });
			})
				.then((done) => {
					const a = entry();
					if (a) a.done = done;
				})
				.catch((e) => {
					const a = entry();
					if (a) a.error = e instanceof Error ? e.message : String(e);
				});
		}
	}
	function detach(key: number) {
		const a = attachments.find((x) => x.key === key);
		if (a?.url) URL.revokeObjectURL(a.url);
		attachments = attachments.filter((x) => x.key !== key);
	}
	function onPaste(e: ClipboardEvent) {
		const files = [...(e.clipboardData?.files ?? [])];
		if (!files.length) return;
		e.preventDefault();
		attach(files);
	}

	async function submit() {
		const typed = text.trim();
		if ((!typed && !attached.length) || uploading) return;
		const images = attached.filter((a) => a.image).map((a) => a.path);
		const files = attached.filter((a) => !a.image).map((a) => a.path);
		const content = files.length ? `${typed}${typed ? '\n\n' : ''}Attached files (read these):\n${files.join('\n')}` : typed;
		if (draft) {
			draft = false;
			await connect();
		}
		if (!connected) return;
		// /btw asks beside the conversation (claude): the answer shows in the task strip.
		const btw = !attached.length && bcaps.sideQuestions ? typed.match(/^\/btw\s+([\s\S]+)/) : null;
		if (btw) {
			chat.sideAnswers.push({ question: btw[1].trim(), answer: '', error: '', pending: true });
			send({ op: 'command', input: typed });
			text = '';
			return;
		}
		// A busy session queues the message: the engine lists it (jucode) or
		// runs it as the next turn (others, listed here until that turn).
		if (chat.busy) {
			if (!bcaps.steer) queued = [...queued, content];
		} else chat.optimisticUser(content, images.length ? images : undefined);
		send({ op: 'user_message', content, images: images.length ? images : undefined });
		text = '';
		for (const a of attachments) if (a.url) URL.revokeObjectURL(a.url);
		attachments = [];
		atBottom = true;
		tick().then(autosize);
	}

	// Stop shows at once; the button leaves when the turn ends.
	let stopping = $state(false);
	$effect(() => {
		if (!chat.busy) stopping = false;
	});

	const sid = $derived(chat.sessionId || session || '');
	const view = $derived(agentDirectory.sessions.find((x) => x.session === sid));
	const bcaps = $derived(caps({ backendId: engine ?? view?.engine ?? 'jucode' }));
	/** Messages sent mid-turn to an engine that runs them as the next turn
	 *  (it does not list them): shown until that turn starts. */
	let queued = $state<string[]>([]);
	$effect(() => {
		if (!chat.busy) queued = [];
	});
	const waiting = $derived(chat.pendingMessages.length ? chat.pendingMessages : queued);

	// The approval mode, as on the desktop: claude adds plan and auto; an
	// agent's session follows the agent (changed on its page).
	const APPROVAL_MODES: Record<string, PopMenuItem> = {
		ask: { key: 'ask', label: t('chat.approvalAsk'), desc: t('chat.approvalAskDesc'), icon: HandIcon },
		plan: { key: 'plan', label: t('chat.approvalPlan'), desc: t('chat.approvalPlanDesc'), icon: ClipboardTextIcon },
		auto: { key: 'auto', label: t('chat.approvalAuto'), desc: t('chat.approvalAutoDesc'), icon: ShieldCheckIcon },
		edits: { key: 'edits', label: t('chat.approvalEdits'), desc: t('chat.approvalEditsDesc'), icon: NotePencilIcon },
		all: { key: 'all', label: t('chat.approvalAll'), desc: t('chat.approvalAllDesc'), icon: ShieldWarningIcon, tone: 'warn' }
	};
	const isAgent = $derived(!!(agent || chat.agent || view?.agent));
	/** Picked before the first message: applied once the session is open. */
	let draftMode = $state<ApprovalMode | null>(null);
	const shownMode = $derived(draftMode ?? chat.approvalMode);
	const APPROVAL = $derived(
		(isAgent ? ['ask', 'edits', 'auto', 'all'] : bcaps.extendedApprovalModes ? ['ask', 'plan', 'auto', 'edits', 'all'] : ['ask', 'edits', 'all']).map(
			(k) => ({ ...APPROVAL_MODES[k], checked: shownMode === k, disabled: isAgent })
		)
	);
	const approvalCurrent = $derived(APPROVAL.find((a) => a.checked) ?? APPROVAL_MODES.ask);
	let approvalOpen = $state(false);
	function applyMode(mode: ApprovalMode) {
		chat.approvalMode = mode;
		send(buildSetApprovalModeOp(mode));
	}
	function pickMode(key: string) {
		approvalOpen = false;
		const mode = key as ApprovalMode;
		if (draft) draftMode = mode;
		else if (connected && mode !== chat.approvalMode) applyMode(mode);
	}
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
	const toolSession = $derived((engine === 'claude' || engine === 'codex') && !!sid);
	let catalog = $state<{ models: { name: string; display_name?: string | null; context_window?: number }[]; groups: JucodeGroup[] } | null>(null);
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
	// Sent images live on the computer: read them there, once each.
	const imageData = new Map<string, Promise<string>>();
	function loadImage(path: string): Promise<string> {
		let got = imageData.get(path);
		if (!got) {
			got = daemon.request({ op: 'fs_image', path }).then((r) => {
				if (typeof r.data !== 'string') throw new Error(String(r.message ?? 'no image'));
				return r.data;
			});
			got.catch(() => imageData.delete(path));
			imageData.set(path, got);
		}
		return got;
	}
	// The agent trace sheet (AgentRunsPanel).
	let traceOpen = $state(false);
	function openTrace(agentId: string | null) {
		chat.agentFocus = agentId;
		traceOpen = true;
	}
	function traceOf(m: Msg): { label: string; run: () => void } | null {
		if (m.kind !== 'tool' || !m.callId) return null;
		const agent = chat.agentRuns.agents.find((a) => a.toolUseId === m.callId);
		if (agent) return { label: t('dock.agents.openAgent'), run: () => openTrace(agent.id) };
		if (chat.agentRuns.workflows.some((w) => w.toolUseId === m.callId)) return { label: t('dock.agents.open'), run: () => openTrace(null) };
		return null;
	}
	function setEffort(effort: string) {
		if (chat.model && !pendingModel) send({ op: 'command', input: `/model ${chat.model} ${effort}` });
	}
	// Claude Code's session switches (SessionSwitches).
	function setSwitch(name: SessionSwitch, on: boolean) {
		const command = name === 'ultracode' ? '/effort ultracode' : `/${name}`;
		send({ op: 'command', input: `${command} ${on ? 'on' : 'off'}` });
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
		{#if bcaps.agentTrace && connected}<button class="back" onclick={() => openTrace(null)} aria-label={t('dock.agents.title')}><TreeStructureIcon size={18} /></button>{/if}
		{#if onFiles}<button class="back" onclick={onFiles} aria-label={t('shell.remote.files')}><FilesIcon size={18} /></button>{/if}
		{#if onChanges}<button class="back" onclick={onChanges} aria-label={t('shell.remote.changes')}><GitDiffIcon size={18} /></button>{/if}
	</header>

	<TaskStrip
		{chat}
		onStop={(id) => send({ op: 'stop_task', task_id: id })}
		onOutput={(id) => send({ op: 'task_output', task_id: id })}
		onTrace={bcaps.agentTrace ? () => openTrace(null) : undefined}
	/>
	{#if traceOpen}
		<!-- The agent trace, full screen over the session. -->
		<div class="trace-sheet" role="dialog" aria-label={t('dock.agents.title')}>
			<header>
				<button class="back" onclick={() => (traceOpen = false)} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={18} /></button>
				<span class="heading"><span class="title">{t('dock.agents.title')}</span></span>
			</header>
			<div class="trace-body"><AgentRunsPanel {chat} onOp={send} /></div>
		</div>
	{/if}
	<main class="scroll" bind:this={scroller} onscroll={onScroll}>
		<div class="thread" bind:this={contentEl}>
			<MessageList
				messages={chat.messages}
				{streamingMsg}
				{streamingReasoning}
				phase={chat.phase}
				call={chat.call}
				compactionTokens={chat.compactionTokens}
				traceOf={bcaps.agentTrace ? traceOf : undefined}
				{loadImage}
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
					<ApprovalCard approval={chat.pendingApproval} onRespond={respond} ruleScopes={caps(chat).ruleScopes} />
				{/key}
			</div>
		{/if}

		{#if fromCache && !connected && !exited}
			<div class="exit">
				<div class="exit-msg"><Notice tone="info">{t('shell.remote.cached')}</Notice></div>
			</div>
		{/if}
		{#if reconnecting}
			<div class="exit">
				<div class="exit-msg"><Notice tone="warn">{t('shell.remote.reconnecting')}</Notice></div>
			</div>
		{:else if exited}
			<div class="exit">
				<div class="exit-msg"><Notice tone={error ? 'error' : 'warn'}>{error || t('shell.remote.disconnected')}</Notice></div>
				<Button size="sm" onclick={connect}><ArrowClockwiseIcon size={13} /> {t('shell.remote.reconnect')}</Button>
			</div>
		{/if}

		<div class="composer-wrap">
			{#if chat.approvalPending && chat.busy}
				<div class="queued">
					<span class="queued-label">{t('chat.modePending', { mode: APPROVAL_MODES[chat.approvalPending]?.label ?? chat.approvalPending })}</span>
					<button type="button" class="qsteer" onclick={stop}>{t('chat.modeApplyNow')}</button>
				</div>
			{/if}
			{#if waiting.length}
				<div class="queued">
					<span class="queued-label">{t('chat.queuedLabel', { n: waiting.length })}</span>
					{#each waiting as q, i (i)}
						<span class="qchip">{q}</span>
					{/each}
					{#if bcaps.steer && chat.pendingMessages.length}
						<button type="button" class="qsteer" onclick={() => send({ op: 'steer' })} title={t('chat.steerTitle')}
							><FastForwardIcon size={12} />{t('chat.steerAction')}</button
						>
					{/if}
				</div>
			{/if}
			<form class="composer" onsubmit={(e) => (e.preventDefault(), submit())}>
				<textarea
					rows="1"
					bind:this={input}
					bind:value={text}
					placeholder={t('shell.remote.messagePlaceholder')}
					oninput={autosize}
					onkeydown={onKey}
					onpaste={onPaste}
				></textarea>
				{#if attachments.length}
					<div class="attachments">
						{#each attachments as a (a.key)}
							<span class="att" class:failed={!!a.error} title={a.error ?? a.name}>
								{#if a.url}<img src={a.url} alt="" />{:else}<FileIcon size={16} />{/if}
								<span class="att-name">{a.name}</span>
								{#if a.error}<span class="att-state">{t('shell.upload.failed')}</span>
								{:else if !a.done}<span class="att-state">{Math.round((a.sent / Math.max(a.total, 1)) * 100)}%</span>{/if}
								<button type="button" aria-label={t('shell.upload.remove')} onclick={() => detach(a.key)}><XIcon size={11} /></button>
							</span>
						{/each}
					</div>
				{/if}
				<div class="composer-bar">
					<button type="button" class="flatbtn attach" onclick={() => picker?.click()} title={t('shell.upload.attach')} aria-label={t('shell.upload.attach')}>
						<PaperclipIcon size={17} />
					</button>
					<input
						bind:this={picker}
						type="file"
						multiple
						hidden
						onchange={(e) => {
							const input = e.currentTarget;
							attach([...(input.files ?? [])]);
							input.value = '';
						}}
					/>
					{#if bcaps.approvalModes}
						<div class="footsel">
							<button
								type="button"
								class="flatbtn mode"
								class:warn={approvalCurrent.tone === 'warn'}
								class:on={approvalOpen}
								disabled={!connected && !draft}
								onclick={() => (approvalOpen = !approvalOpen)}
								title={t('chat.approvalModeTitle')}
								aria-haspopup="menu"
								aria-expanded={approvalOpen}
							>
								{#if approvalCurrent.icon}<approvalCurrent.icon size={16} />{/if}<span>{approvalCurrent.label}</span>
							</button>
							{#if approvalOpen}
								<PopMenu
									title={isAgent ? t('chat.approvalAgent') : t('chat.approvalQuestion')}
									items={APPROVAL}
									placement="up-left"
									onSelect={pickMode}
									onClose={() => (approvalOpen = false)}
								/>
							{/if}
						</div>
					{/if}
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
					{/if}
					<!-- Mid-turn, sending queues the message (插话). -->
					{#if !chat.busy || text.trim() || attached.length}
						<button type="submit" class="cact send" disabled={(!text.trim() && !attached.length) || uploading || (!connected && !draft)} aria-label={t('chat.sendTitle')} title={t('chat.sendTitle')}>
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
			onSwitch={setSwitch}
			onClose={closeModels}
		/>
	{/if}
</div>

<style>
	.trace-sheet {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	.trace-body {
		flex: 1;
		min-height: 0;
	}
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
		gap: 4px;
		container-type: inline-size;
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
		font-size: var(--fs-xs);
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
	/* The model and its effort always show in full; the approval mode gives
	   way (its icon stays). */
	.flatbtn.model,
	.flatbtn.model span {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.flatbtn.model {
		gap: 5px;
		padding-inline: 6px;
	}
	.footsel {
		min-width: 0;
	}
	.flatbtn.mode {
		max-width: 100%;
	}
	.flatbtn.mode span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@container (max-width: 360px) {
		.flatbtn.mode span {
			display: none;
		}
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
	.footsel {
		position: relative;
		min-width: 0;
	}
	.flatbtn.attach {
		padding: 5px;
		color: var(--dim);
	}
	.attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-bottom: 8px;
	}
	.att {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 220px;
		padding: 3px 4px 3px 3px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.att.failed {
		border-color: color-mix(in oklab, var(--err) 50%, transparent);
		color: var(--err);
	}
	.att img {
		width: 28px;
		height: 28px;
		border-radius: var(--r-xs);
		object-fit: cover;
	}
	.att-name {
		min-width: 0;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.att-state {
		flex: none;
		font-family: var(--font-mono);
	}
	.att button {
		display: inline-flex;
		flex: none;
		padding: 2px;
		border: none;
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.flatbtn.mode {
		color: var(--dim);
	}
	.flatbtn.mode span {
		white-space: nowrap;
	}
	.flatbtn.mode.warn {
		color: var(--warn);
	}
	/* Messages waiting for the running turn, over the composer. */
	.queued {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 4px 8px;
		overflow-x: auto;
		font-size: var(--fs-xs);
		color: var(--dim);
		animation: rise var(--t-fast) var(--ease-out);
	}
	.queued-label {
		flex-shrink: 0;
	}
	.qchip {
		max-width: 180px;
		padding: 2px 8px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.qsteer {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		background: none;
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
</style>
