<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { X, Check, PanelRight, ChevronDown, ShieldAlert } from 'lucide-svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import {
		isPermissionGranted,
		requestPermission,
		sendNotification
	} from '@tauri-apps/plugin-notification';
	import { ChatState } from '$lib/chat.svelte';
	import {
		sendOp,
		createSession,
		closeSession,
		projectRoot,
		readAuthProviders,
		type EventPayload
	} from '$lib/protocol';
	import Settings from '$lib/Settings.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import RightDock from '$lib/RightDock.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Composer from '$lib/Composer.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import type { Project } from '$lib/types';
	import Vendor from '$lib/Vendor.svelte';


	let projects = $state<Project[]>([]);
	let activeId = $state('');
	let loaded = $state(false);
	// Read the saved layout synchronously, before any effect can overwrite it.
	const savedProjectsData: Array<{
		id: string;
		name: string;
		path: string;
		tabs?: Array<{ sid: string; title: string }>;
	}> = (() => {
		try {
			return JSON.parse(localStorage.getItem('jucode-projects') || '[]');
		} catch {
			return [];
		}
	})();
	let input = $state('');
	let attachments = $state<{ path: string; image: boolean }[]>([]);
	let scroller = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLTextAreaElement | null>(null);
	let atBottom = $state(true);
	let providers = $state<string[]>([]);

	async function notifyDone(title: string) {
		try {
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (granted) sendNotification({ title: 'JuCode', body: `对话完成：${title || '未命名'}` });
		} catch {
			/* ignore */
		}
	}
	let selIdx = $state(0);
	let showSettings = $state(false);
	let showMarket = $state(false);
	let showRight = $state(true);
	let rightWidth = $state(340);
	let sidebarWidth = $state(248);
	let resizing = $state(false);

	function startSidebarResize(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startW = sidebarWidth;
		const move = (ev: PointerEvent) => {
			sidebarWidth = Math.min(420, Math.max(190, startW + (ev.clientX - startX)));
		};
		const up = () => {
			localStorage.setItem('jucode-sidebar-width', String(sidebarWidth));
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function startResize(e: PointerEvent) {
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startW = rightWidth;
		const move = (ev: PointerEvent) => {
			rightWidth = Math.min(640, Math.max(260, startW + (startX - ev.clientX)));
		};
		const up = () => {
			resizing = false;
			localStorage.setItem('jucode-right-width', String(rightWidth));
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function chooseEffort(ef: string) {
		if (chat) sendOp(activeId, { op: 'command', input: `/model ${chat.model} ${ef}` });
	}

	const allSessions = $derived(projects.flatMap((p) => p.sessions));
	const active = $derived(allSessions.find((s) => s.id === activeId));
	const chat = $derived(active?.chat);
	// The assistant message that's still streaming: render it as plain text and
	// only run markdown/highlight once the turn finishes (avoids reparsing the
	// whole message on every token).
	// The streaming block is the LAST message (deltas append to the tail). Scanning
	// backwards would wrongly latch onto a previous turn's reply before this turn's
	// message exists, re-animating it on send.
	const streamingMsg = $derived.by(() => {
		if (!chat?.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'assistant' ? last : null;
	});
	// The reasoning block currently receiving deltas — rendered with the
	// line-by-line streaming animation (others render as static markdown).
	const streamingReasoning = $derived.by(() => {
		if (!chat?.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'reasoning' && !last.collapsed ? last : null;
	});
	const activeProject = $derived(projects.find((p) => p.sessions.some((s) => s.id === activeId)));
	const loggedIn = $derived(!!chat?.provider && providers.includes(chat.provider));

	// Persist the project layout + open tabs (engine session id + title) whenever
	// they change. Gated on `loaded` so it can't clobber the saved data before the
	// initial restore has run.
	$effect(() => {
		if (!loaded) return;
		const data = projects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			tabs: p.sessions
				.map((s) => ({ sid: s.chat.sessionId, title: s.chat.title }))
				.filter((t) => t.sid)
		}));
		localStorage.setItem('jucode-projects', JSON.stringify(data));
	});

	let counter = 0;
	const uid = () => `s${Date.now().toString(36)}-${(counter++).toString(36)}`;
	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

	const project = $derived(activeProject?.name ?? (chat?.cwd ? base(chat.cwd) : 'workspace'));

	// pickers (tree / model / resume) — active session
	const pickerTitle = $derived(
		chat?.picker?.kind === 'tree'
			? 'Conversation tree'
			: chat?.picker?.kind === 'model'
				? 'Select model'
				: chat?.picker?.kind === 'resume'
					? 'Resume session'
					: chat?.picker?.kind === 'checkpoint'
						? '回退到历史回合'
						: ''
	);
	const activeModel = $derived(
		chat?.picker?.kind === 'model' ? chat.picker.models.find((m) => m.active) : undefined
	);
	const pickerRows = $derived.by(() => {
		const p = chat?.picker;
		if (!p) return [];
		if (p.kind === 'tree')
			return p.nodes.map((n) => ({ id: n.id, label: n.label, detail: n.id, active: n.active, command: `/checkout ${n.id}` }));
		if (p.kind === 'resume')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/resume ${it.id}` }));
		if (p.kind === 'checkpoint')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/rewind ${it.id}` }));
		return p.models.map((m) => ({ id: m.model, label: m.model, detail: `${fmtTokens(m.context_window)} ctx`, active: m.active, command: `/model ${m.model}` }));
	});

	$effect(() => {
		if (chat?.picker) {
			const i = pickerRows.findIndex((r) => r.active);
			selIdx = i >= 0 ? i : 0;
		}
	});
	$effect(() => {
		activeId;
		atBottom = true;
		scrollToEnd(true);
		if (active) active.chat.unseen = false;
	});
	$effect(() => {
		if (chat?.pendingFill != null) {
			input = chat.pendingFill;
			chat.pendingFill = null;
		}
	});

	function engineFailed(chat: ChatState, e: unknown) {
		chat.engineState = 'exited';
		chat.messages.push({ kind: 'error', text: `无法启动引擎：${e}` });
	}
	function restoreSession(project: Project, sid: string, title: string) {
		const id = uid();
		const chat = new ChatState();
		if (title) chat.title = title;
		project.sessions.push({ id, chat });
		createSession(id, project.path)
			.then(() => sendOp(id, { op: 'command', input: `/resume ${sid}` }))
			.catch((e) => engineFailed(chat, e));
		return id;
	}
	function addSession(project: Project) {
		const id = uid();
		const chat = new ChatState();
		project.sessions.push({ id, chat });
		activeId = id;
		createSession(id, project.path).catch((e) => engineFailed(chat, e));
		return id;
	}
	async function addProject() {
		const path = await open({ directory: true, title: '选择项目目录' });
		if (!path || Array.isArray(path)) return;
		const p: Project = { id: uid(), name: base(path), path, sessions: [] };
		projects.push(p);
		addSession(p);
	}
	function removeSession(id: string) {
		closeSession(id).catch(() => {});
		const p = projects.find((pr) => pr.sessions.some((s) => s.id === id));
		if (p) p.sessions = p.sessions.filter((s) => s.id !== id);
		if (activeId === id) activeId = allSessions[0]?.id ?? '';
	}
	function removeProject(p: Project) {
		for (const s of p.sessions) closeSession(s.id).catch(() => {});
		projects = projects.filter((x) => x.id !== p.id);
		if (!allSessions.some((s) => s.id === activeId)) activeId = allSessions[0]?.id ?? '';
	}
	function openHistory(p: Project) {
		// /resume (no arg) lists persisted sessions for the project's cwd — same
		// store the CLI uses. It's non-destructive; selecting one resumes it in a
		// fresh session (see selectRow).
		const id = p.sessions[0]?.id ?? addSession(p);
		activeId = id;
		sendOp(id, { op: 'command', input: '/resume' });
	}
	function nav(command: string) {
		if (chat) sendOp(activeId, { op: 'command', input: command });
	}

	function addAttachment(path: string) {
		if (path && !attachments.some((a) => a.path === path)) attachments.push({ path, image: isImage(path) });
	}
	async function pickFiles() {
		const sel = await open({ multiple: true, title: 'Attach files' });
		if (!sel) return;
		for (const p of Array.isArray(sel) ? sel : [sel]) addAttachment(p);
	}

	function submit() {
		if (!chat) return;
		const text = input.trim();
		if (!text && attachments.length === 0) return;
		if (text.startsWith('/')) {
			sendOp(activeId, { op: 'command', input: text });
		} else {
			const images = attachments.filter((a) => a.image).map((a) => a.path);
			const files = attachments.filter((a) => !a.image).map((a) => a.path);
			let content = text;
			if (files.length)
				content += `${content ? '\n\n' : ''}Attached files (read these):\n${files.join('\n')}`;
			sendOp(activeId, { op: 'user_message', content, images: images.length ? images : undefined });
		}
		input = '';
		attachments = [];
	}
	function stop() {
		sendOp(activeId, { op: 'interrupt' });
	}
	function respondApproval(decision: string) {
		const a = chat?.pendingApproval;
		if (!a) return;
		sendOp(activeId, { op: 'command', input: `/approve ${a.callId} ${decision}` });
		if (chat) chat.pendingApproval = null;
	}

	function selectRow(command: string) {
		// Resuming a history item opens it in a fresh session so the current chat
		// isn't replaced; everything else acts on the active session.
		if (command.startsWith('/resume ') && activeProject) {
			chat?.closePicker();
			const id = addSession(activeProject);
			sendOp(id, { op: 'command', input: command });
			return;
		}
		sendOp(activeId, { op: 'command', input: command });
		chat?.closePicker();
	}
	function setEffort(effort: string) {
		if (activeModel) selectRow(`/model ${activeModel.model} ${effort}`);
	}
	function pickerKey(e: KeyboardEvent) {
		if (!chat?.picker) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			chat.closePicker();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selIdx = Math.min(selIdx + 1, pickerRows.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selIdx = Math.max(selIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const r = pickerRows[selIdx];
			if (r) selectRow(r.command);
		}
	}
	function respondTrust(answer: 'yes' | 'no' | 'repo') {
		if (!chat) return;
		sendOp(activeId, { op: 'command', input: `/trust ${answer}` });
		chat.trustPrompt = null;
	}
	function onWindowKey(e: KeyboardEvent) {
		pickerKey(e);
		const mod = e.metaKey || e.ctrlKey;
		if (!mod) return;
		if (e.key === 'n') {
			e.preventDefault();
			if (activeProject) addSession(activeProject);
		} else if (e.key === ',') {
			e.preventDefault();
			showSettings = true;
		} else if (e.key === 'b') {
			e.preventDefault();
			showRight = !showRight;
		}
	}

	function onScroll() {
		if (scroller) atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
	}
	// Stick to the bottom as content grows (streaming text, tool output, new cards).
	// The smoothed reveal changes height every frame, which a scroll-event listener
	// can't see, so observe the content's size directly.
	let contentEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!contentEl || !scroller) return;
		const ro = new ResizeObserver(() => {
			if (atBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
		});
		ro.observe(contentEl);
		return () => ro.disconnect();
	});
	async function scrollToEnd(force = false) {
		await tick();
		if (scroller && (atBottom || force)) {
			scroller.scrollTop = scroller.scrollHeight;
			atBottom = true;
		}
	}
	function jumpToBottom() {
		atBottom = true;
		scrollToEnd(true);
	}
	function editMessage(text: string) {
		input = text;
		composerEl?.focus();
	}

	onMount(() => {
		const savedW = Number(localStorage.getItem('jucode-right-width'));
		if (savedW >= 260 && savedW <= 640) rightWidth = savedW;
		const savedSb = Number(localStorage.getItem('jucode-sidebar-width'));
		if (savedSb >= 190 && savedSb <= 420) sidebarWidth = savedSb;
		const cleanups: Array<() => void> = [];
		let disposed = false;
		(async () => {
			const unlisten = await listen<EventPayload>('agent-event', (e) => {
				const s = allSessions.find((x) => x.id === e.payload.session);
				if (!s) return;
				const wasBusy = s.chat.busy;
				try {
					s.chat.handle(JSON.parse(e.payload.data));
				} catch {
					/* ignore */
				}
				if (wasBusy && !s.chat.busy && s.id !== activeId) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
				if (s.id === activeId) scrollToEnd();
			});
			const unexit = await listen<string>('agent-exit', (e) => {
				const s = allSessions.find((x) => x.id === e.payload);
				if (!s) return;
				s.chat.engineState = 'exited';
				s.chat.messages.push({ kind: 'error', text: 'engine process exited' });
			});
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type === 'drop') for (const p of e.payload.paths) addAttachment(p);
			});
			cleanups.push(unlisten, unexit, undrop);
			if (disposed) {
				cleanups.forEach((f) => f());
				return;
			}
			// Restore saved projects + their open conversations (resume by id), or
			// seed a default project on first run.
			let first = '';
			if (savedProjectsData.length) {
				for (const p of savedProjectsData) {
					const proj: Project = { id: p.id, name: p.name, path: p.path, sessions: [] };
					projects.push(proj);
					for (const t of p.tabs ?? []) {
						if (!t.sid) continue;
						const id = restoreSession(proj, t.sid, t.title);
						if (!first) first = id;
					}
				}
				activeId = first || (projects[0] && addSession(projects[0])) || '';
			} else {
				const root = await projectRoot();
				projects.push({ id: uid(), name: base(root), path: root, sessions: [] });
				addSession(projects[0]);
			}
			loaded = true;
			readAuthProviders()
				.then((p) => (providers = p))
				.catch(() => {});
		})();
		return () => {
			disposed = true;
			cleanups.forEach((f) => f());
		};
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="app">
	<!-- LEFT: navigation + sessions -->
	<Sidebar
		{projects}
		{activeId}
		width={sidebarWidth}
		{loggedIn}
		providerName={chat?.provider ?? ''}
		onSelect={(id) => (activeId = id)}
		onNewProject={addProject}
		onNewSession={addSession}
		onCloseSession={removeSession}
		onCloseProject={removeProject}
		onHistory={openHistory}
		onSettings={() => (showSettings = true)}
		onMarket={() => (showMarket = true)}
	/>
	<div class="resizer side" role="separator" aria-label="resize sidebar" onpointerdown={startSidebarResize}></div>

	<!-- CENTER: chat -->
	<div class="center">
		{#if chat}
			<header data-tauri-drag-region>
				<div class="htitle" data-tauri-drag-region>
					<span class="hname">{chat.title}</span>
					<span class="hcrumb">{project}</span>
				</div>
				<div class="hspace" data-tauri-drag-region></div>
				{#if chat.totalIn || chat.totalOut}<span class="usage">↑{fmtTokens(chat.totalIn)} ↓{fmtTokens(chat.totalOut)}</span>{/if}
				{#if chat.cost > 0}<span class="usage cost">${chat.cost.toFixed(3)}</span>{/if}
				<button class="hicon" class:on={showRight} onclick={() => (showRight = !showRight)} aria-label="toggle panel"><PanelRight size={16} /></button>
			</header>

			{#if Object.keys(chat.subagents).length}
				<div class="agents">
					{#each Object.entries(chat.subagents) as [path, info] (path)}
						<span class="agent"><span class="agent-dot"></span>{path} · {info.status}</span>
					{/each}
				</div>
			{/if}

			<main bind:this={scroller} onscroll={onScroll}>
				<div bind:this={contentEl}>
					<MessageList messages={chat.messages} {streamingMsg} {streamingReasoning} phase={chat.phase} compactionTokens={chat.compactionTokens} onEdit={editMessage} />
				</div>
			</main>
			{#if !atBottom}
				<button class="jump" onclick={jumpToBottom} aria-label="scroll to bottom"><ChevronDown size={18} /></button>
			{/if}

			{#if chat.pendingApproval}
				<div class="approval">
					<div class="approval-head">
						<ShieldAlert size={15} />
						<span>允许运行 <b>{chat.pendingApproval.name}</b>？</span>
					</div>
					{#if chat.pendingApproval.summary}
						<pre class="approval-sum">{chat.pendingApproval.summary}</pre>
					{/if}
					<div class="approval-actions">
						<Button variant="primary" size="sm" onclick={() => respondApproval('allow once')}>允许一次</Button>
						<Button variant="secondary" size="sm" onclick={() => respondApproval('allow always')}>本会话始终允许</Button>
						<Button variant="danger" size="sm" onclick={() => respondApproval('deny')}>拒绝</Button>
					</div>
				</div>
			{/if}

			<Composer
				{chat}
				bind:input
				bind:attachments
				bind:el={composerEl}
				onSubmit={submit}
				onStop={stop}
				onSteer={() => sendOp(activeId, { op: 'steer' })}
				onPick={pickFiles}
				onModel={() => nav('/model')}
				onEffort={chooseEffort}
			/>
		{/if}
	</div>

	<!-- RIGHT: goal progress -->
	<div class="resizer" class:hidden={!showRight} role="separator" aria-label="resize panel" onpointerdown={startResize}></div>
	<aside class="right" class:closed={!showRight} class:resizing style:width={showRight ? `${rightWidth}px` : '0px'}>
		<div class="right-inner" style:width="{rightWidth}px">
			<RightDock goal={chat?.goal ?? null} plan={chat?.plan ?? []} cwd={activeProject?.path ?? ''} />
		</div>
	</aside>

	{#if showSettings}
		<Settings sessionId={activeId} onClose={() => (showSettings = false)} />
	{/if}

	{#if showMarket}
		<Marketplace sessionId={activeId} onClose={() => (showMarket = false)} />
	{/if}

	{#if chat?.trustPrompt}
		<div class="overlay" role="presentation">
			<div class="modal trust" role="dialog" tabindex="-1" aria-label="Trust project">
				<div class="modal-head"><span>Trust this project?</span></div>
				<div class="trust-body">
					<p>This project has local skills or hooks that can run code. Trust it to let JuCode load them.</p>
					<code class="trust-path">{chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd}</code>
				</div>
				<div class="trust-actions">
					<button class="btn ghost" onclick={() => respondTrust('no')}>Don't trust</button>
					{#if chat.trustPrompt.repoRoot}<button class="btn" onclick={() => respondTrust('repo')}>Trust repo</button>{/if}
					<button class="btn primary" onclick={() => respondTrust('yes')}>Trust</button>
				</div>
			</div>
		</div>
	{/if}

	{#if chat?.picker}
		<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && chat?.closePicker()}>
			<div class="modal" role="dialog" tabindex="-1" aria-label={pickerTitle}>
				<div class="modal-head">
					<span>{pickerTitle}</span>
					<IconButton onclick={() => chat?.closePicker()} label="close"><X size={15} /></IconButton>
				</div>
				{#if chat.picker.kind === 'model' && activeModel}
					<div class="efforts">
						<span class="dim">effort</span>
						{#each activeModel.reasoning_efforts as ef (ef)}
							<button class="eff" class:on={ef === chat.picker.activeEffort} onclick={() => setEffort(ef)}>{ef}</button>
						{/each}
					</div>
				{/if}
				<div class="rows">
					{#each pickerRows as row, i (row.id)}
						<button class="prow" class:sel={i === selIdx} onclick={() => selectRow(row.command)} onmouseenter={() => (selIdx = i)}>
							{#if chat.picker.kind === 'model'}<Vendor model={row.id} size={15} />{/if}
							<span class="prow-main">{row.label || '(empty)'}</span>
							<span class="prow-detail">{row.detail}</span>
							{#if row.active}<Check size={14} class="prow-check" />{/if}
						</button>
					{/each}
					{#if pickerRows.length === 0}<div class="pempty">nothing here</div>{/if}
				</div>
				<div class="modal-foot dim">↑↓ navigate · Enter select · Esc close</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	/* ---------- center ---------- */
	.center {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg);
		position: relative;
	}
	.jump {
		position: absolute;
		left: 50%;
		bottom: 132px;
		transform: translateX(-50%);
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
		cursor: pointer;
		z-index: 10;
	}
	.jump:hover {
		background: var(--surface2);
	}
	.approval {
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
		padding: 12px 14px;
		background: color-mix(in oklab, var(--warn) 9%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--warn) 38%, transparent);
		border-radius: var(--r-md);
	}
	.approval-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--warn);
	}
	.approval-head b {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.approval-sum {
		margin: 8px 0 0;
		padding: 8px 10px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
	}
	.approval-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid var(--hairline);
	}
	.htitle {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.hname {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 240px;
	}
	.hcrumb {
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.hspace {
		flex: 1;
	}
	.usage {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
	}
	.usage.cost {
		color: var(--accent-bright);
	}
	.hicon {
		display: inline-flex;
		padding: 7px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.hicon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.hicon.on {
		color: var(--accent-bright);
	}

	.agents {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 18px;
		border-bottom: 1px solid var(--hairline);
	}
	.agent {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
	}
	.agent-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}

	main {
		flex: 1;
		overflow-y: auto;
		padding: 22px 18px 26px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
	}
	/* ---------- right ---------- */
	.resizer {
		width: 5px;
		flex-shrink: 0;
		cursor: col-resize;
		background: transparent;
		margin-left: -3px;
		z-index: 5;
	}
	.resizer:hover {
		background: var(--accent-soft);
	}
	.resizer.side {
		margin-left: -3px;
		margin-right: -2px;
	}
	.resizer.hidden {
		display: none;
	}
	.right {
		flex-shrink: 0;
		min-width: 0;
		border-left: 1px solid var(--hairline);
		overflow: hidden;
		transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.right.resizing {
		transition: none;
	}
	.right.closed {
		border-left: none;
	}
	.right-inner {
		height: 100%;
	}

	/* ---------- modals (picker / trust) ---------- */
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.modal {
		width: min(560px, 92vw);
		max-height: 76vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 16px;
		font-weight: 600;
		font-size: 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.efforts {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--hairline);
		font-size: 12px;
	}
	.dim {
		color: var(--dim);
	}
	.eff {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--dim);
		cursor: pointer;
	}
	.eff.on {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}
	.rows {
		overflow-y: auto;
		padding: 6px;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		text-align: left;
		padding: 9px 11px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.prow.sel {
		background: var(--surface2);
	}
	.prow-main {
		flex: 1;
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prow-detail {
		color: var(--dim);
		font-size: 12px;
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	:global(.prow-check) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.pempty {
		padding: 18px;
		text-align: center;
		color: var(--dim);
		font-size: 13px;
	}
	.modal-foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		font-family: var(--font-mono);
		text-align: center;
	}
	.modal.trust {
		width: min(460px, 92vw);
	}
	.trust-body {
		padding: 16px;
		font-size: 14px;
		line-height: 1.55;
	}
	.trust-body p {
		margin: 0 0 12px;
	}
	.trust-path {
		display: block;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 8px 10px;
		word-break: break-all;
	}
	.trust-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 16px 16px;
	}
	.btn {
		font-size: 13px;
		padding: 8px 14px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
	}
	.btn:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn.ghost {
		color: var(--dim);
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
</style>
