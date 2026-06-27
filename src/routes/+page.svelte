<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { X, Check, PanelRight, ChevronDown, ChevronUp, ShieldAlert, Search } from 'lucide-svelte';
	import { open, ask } from '@tauri-apps/plugin-dialog';
	import { cycleTheme } from '$lib/theme.svelte';
	import {
		isPermissionGranted,
		requestPermission,
		sendNotification
	} from '@tauri-apps/plugin-notification';
	import { ChatState } from '$lib/chat.svelte';
	import { treeRows } from '$lib/tree';
	import { shouldAutoApprove } from '$lib/approval';
	import { focusTrap } from '$lib/focusTrap';
	import { sendOp, readAuthProviders, listProviders, type EventPayload } from '$lib/protocol';
	import { SessionStore } from '$lib/session.svelte';
	import Settings from '$lib/Settings.svelte';
	import Setup from '$lib/Setup.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import RightDock from '$lib/RightDock.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Composer from '$lib/Composer.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import type { Project } from '$lib/types';
	import Vendor from '$lib/Vendor.svelte';


	// Project/session tree + lifecycle lives in the store; the page keeps thin
	// reactive aliases so templates and handlers read it naturally.
	const store = new SessionStore();
	const projects = $derived(store.projects);
	const allSessions = $derived(store.allSessions);
	const active = $derived(store.active);
	const chat = $derived(store.chat);
	const activeProject = $derived(store.activeProject);
	const activeId = $derived(store.activeId);
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
	let bottomH = $state(120);
	let atBottom = $state(true);
	let providers = $state<string[]>([]);

	// In-conversation find (⌘F)
	let showFind = $state(false);
	let findQuery = $state('');
	let findIdx = $state(0);
	let findInputEl = $state<HTMLInputElement | null>(null);
	// Picker filter (history / long lists)
	let pickerQuery = $state('');

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
	let settingsInitial = $state<'model' | 'account' | 'behavior'>('model');
	let showMarket = $state(false);
	let showSetup = $state(false);
	let showPalette = $state(false);

	function refreshAuth() {
		readAuthProviders()
			.then((p) => (providers = p))
			.catch(() => {});
	}

	// All configured providers (builtin + custom) with their models, so the in-chat
	// model picker can list every provider's models — not just the active one's.
	let providersList = $state<
		{ id: string; base_url: string; format: string; models: { name: string; context_window?: number; reasoning_efforts?: string[] }[] }[]
	>([]);
	function loadProviders() {
		listProviders()
			.then((bs) => {
				let custom: typeof providersList = [];
				try {
					custom = JSON.parse(localStorage.getItem('jucode-custom-providers') || '[]');
				} catch {
					custom = [];
				}
				providersList = [
					...bs.map((b) => ({ id: b.id, base_url: b.base_url, format: b.protocol, models: b.models })),
					...custom
				];
			})
			.catch(() => {});
	}
	let showRight = $state(true);
	let rightWidth = $state(340);
	let sidebarWidth = $state(248);
	let resizing = $state(false);
	let winW = $state(1200);

	// Auto-collapse the right dock when the window gets too narrow for a comfortable
	// chat column, and restore it when there's room again. Keyed only on width
	// (via untrack) so it never fights a manual toggle.
	const NARROW = 960;
	let autoCollapsedRight = false;
	$effect(() => {
		const narrow = winW < NARROW;
		untrack(() => {
			if (narrow && showRight) {
				showRight = false;
				autoCollapsedRight = true;
			} else if (!narrow && autoCollapsedRight && !showRight) {
				showRight = true;
				autoCollapsedRight = false;
			}
		});
	});
	// A manual toggle is authoritative — clear the auto-collapse intent so the
	// responsive effect won't later override the user's choice.
	function toggleRight() {
		showRight = !showRight;
		autoCollapsedRight = false;
	}

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
	const loggedIn = $derived(!!chat?.provider && providers.includes(chat.provider));

	// Message indices in the active chat matching the find query, and the current one.
	const findHits = $derived.by(() => {
		if (!showFind || !chat) return [];
		const q = findQuery.trim().toLowerCase();
		if (!q) return [];
		const hits: number[] = [];
		chat.messages.forEach((m, i) => {
			const text = m.kind === 'tool' ? `${m.name} ${m.output}` : 'text' in m ? m.text : '';
			if (text.toLowerCase().includes(q)) hits.push(i);
		});
		return hits;
	});
	const findActive = $derived(findHits.length ? findHits[Math.min(findIdx, findHits.length - 1)] : null);
	$effect(() => {
		findQuery;
		findIdx = 0;
	});

	// Persist the project layout + open tabs (engine session id + title) whenever
	// they change. Gated on `loaded` so it can't clobber the saved data before the
	// initial restore has run.
	$effect(() => {
		if (!store.loaded) return;
		localStorage.setItem('jucode-projects', JSON.stringify(store.serialize()));
	});

	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	// Engine subagent lifecycle status → Chinese (falls back to the raw value).
	const AGENT_STATUS: Record<string, string> = {
		started: '已启动',
		running: '运行中',
		completed: '已完成',
		done: '已完成',
		interrupted: '已中断',
		closed: '已关闭'
	};
	const agentStatus = (s: string) => AGENT_STATUS[s] ?? s;

	const project = $derived(activeProject?.name ?? (chat?.cwd ? base(chat.cwd) : 'workspace'));

	// pickers (tree / model / resume) — active session
	const pickerTitle = $derived(
		chat?.picker?.kind === 'tree'
			? '对话分支树'
			: chat?.picker?.kind === 'model'
				? '选择模型'
				: chat?.picker?.kind === 'resume'
					? '恢复历史会话'
					: chat?.picker?.kind === 'checkpoint'
						? '回退到历史回合'
						: ''
	);
	const activeModel = $derived(
		chat?.picker?.kind === 'model' ? chat.picker.models.find((m) => m.active) : undefined
	);
	const pickerRows = $derived.by(() => {
		const p = chat?.picker;
		const nil = undefined as number | undefined;
		if (!p) return [];
		if (p.kind === 'tree')
			return treeRows(p.nodes).map((r) => ({ id: r.node.id, label: r.node.label, detail: r.node.id.slice(0, 8), active: r.node.active, command: `/checkout ${r.node.id}`, depth: r.depth as number | undefined }));
		if (p.kind === 'resume')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/resume ${it.id}`, depth: nil }));
		if (p.kind === 'checkpoint')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/rewind ${it.id}`, depth: nil }));
		// Model picker. The active provider's rows come from the engine's model_view
		// (already filtered — e.g. jucode hides unsupported models — and flagged with
		// the active one); other providers come from the client-side config list so
		// you can switch to any of them. Same-provider picks use /model (instant);
		// cross-provider picks switch via @switch (config rewrite + engine restart).
		const cur = chat?.provider ?? '';
		// Mirror the engine's jucode allow-list so we don't offer a model it rejects.
		const jucodeOk = (n: string) =>
			['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'].includes(n) || n.startsWith('claude-');
		const activeRows = p.models.map((m) => ({
			id: `${cur}::${m.model}`,
			label: m.model,
			detail: `${cur} · ${fmtTokens(m.context_window)}`,
			active: m.active,
			command: `/model ${m.model}`,
			depth: nil
		}));
		const otherRows = providersList
			.filter((pv) => pv.id !== cur)
			.flatMap((pv) =>
				pv.models
					.filter((m) => pv.id !== 'jucode' || jucodeOk(m.name))
					.map((m) => ({
						id: `${pv.id}::${m.name}`,
						label: m.name,
						detail: `${pv.id}${providers.includes(pv.id) ? '' : ' · 未配置'} · ${fmtTokens(m.context_window ?? 0)}`,
						active: false,
						command: `@switch ${pv.id} ${m.name}`,
						depth: nil
					}))
			);
		return [...activeRows, ...otherRows];
	});

	// Whether to offer a filter box (history and other long lists).
	const showPickerSearch = $derived(
		pickerRows.length > 8 || chat?.picker?.kind === 'resume' || chat?.picker?.kind === 'checkpoint'
	);
	const filteredRows = $derived.by(() => {
		const q = pickerQuery.trim().toLowerCase();
		if (!q) return pickerRows;
		return pickerRows.filter((r) => `${r.label} ${r.detail}`.toLowerCase().includes(q));
	});
	$effect(() => {
		chat?.picker;
		pickerQuery = '';
	});
	$effect(() => {
		if (chat?.picker) {
			const i = filteredRows.findIndex((r) => r.active);
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

	async function addProject() {
		const path = await open({ directory: true, title: '选择项目目录' });
		if (!path || Array.isArray(path)) return;
		store.createProject(path);
	}
	async function removeProject(p: Project) {
		if (p.sessions.length) {
			const ok = await ask(`关闭「${p.name}」会结束其下 ${p.sessions.length} 个对话，确定吗？`, {
				title: '关闭项目',
				kind: 'warning'
			});
			if (!ok) return;
		}
		store.removeProject(p);
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
			// Echo the message instantly when it starts a turn now (a busy session
			// queues it instead, shown in the composer's queue strip).
			if (chat && !chat.busy) chat.optimisticUser(content);
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
	function autoApprove(c: ChatState, sid: string) {
		const a = c.pendingApproval;
		if (!a || !shouldAutoApprove(c.approvalMode, a.name)) return;
		sendOp(sid, { op: 'command', input: `/approve ${a.callId} allow` });
		c.pendingApproval = null;
	}

	function selectRow(command: string) {
		// Cross-provider model pick: rewrite config + restart this session (resumes
		// the conversation) since the engine can't change provider at runtime.
		if (command.startsWith('@switch ')) {
			const rest = command.slice('@switch '.length);
			const sp = rest.indexOf(' ');
			const pid = rest.slice(0, sp);
			const name = rest.slice(sp + 1);
			const pv = providersList.find((x) => x.id === pid);
			chat?.closePicker();
			if (pv) store.switchProvider(activeId, pv, name);
			return;
		}
		// Resuming a history item opens it in a fresh session so the current chat
		// isn't replaced; everything else acts on the active session.
		if (command.startsWith('/resume ') && activeProject) {
			chat?.closePicker();
			const id = store.addSession(activeProject);
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
			selIdx = Math.min(selIdx + 1, filteredRows.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selIdx = Math.max(selIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const r = filteredRows[selIdx];
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
		// The setup wizard is a blocking first-run modal — don't fire app shortcuts
		// under it (e.g. Cmd+K opening the palette behind it).
		if (showSetup) return;
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key === 'k') {
			e.preventDefault();
			showPalette = !showPalette;
			return;
		}
		if (mod && e.key === 'f' && chat) {
			e.preventDefault();
			showFind ? closeFind() : openFind();
			return;
		}
		if (!mod) return;
		if (e.key === 'n') {
			e.preventDefault();
			if (activeProject) store.addSession(activeProject);
		} else if (e.key === ',') {
			e.preventDefault();
			showSettings = true;
		} else if (e.key === 'b') {
			e.preventDefault();
			toggleRight();
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
	function openFind() {
		showFind = true;
		tick().then(() => findInputEl?.focus());
	}
	function closeFind() {
		showFind = false;
		findQuery = '';
	}
	const findNext = () => findHits.length && (findIdx = (findIdx + 1) % findHits.length);
	const findPrev = () => findHits.length && (findIdx = (findIdx - 1 + findHits.length) % findHits.length);
	function findKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFind();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.shiftKey ? findPrev() : findNext();
		}
	}
	// Real edit-and-resend: rewind the conversation (and files) to the turn that
	// produced this user message, then drop its text back into the composer. The
	// engine lists user turns in order, so the i-th turn matches the i-th message.
	function rewindToMessage(text: string, userIndex: number) {
		if (!chat) return;
		chat.rewindIntent = { userIndex, text };
		sendOp(activeId, { op: 'command', input: '/rewind' });
	}
	function confirmRewind() {
		const pr = chat?.pendingRewind;
		if (!pr || !chat) return;
		sendOp(activeId, { op: 'command', input: `/rewind ${pr.id}` });
		input = pr.text;
		chat.pendingRewind = null;
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
				autoApprove(s.chat, s.id);
				if (wasBusy && !s.chat.busy && s.id !== activeId) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
				if (s.id === activeId) scrollToEnd();
			});
			const unexit = await listen<string>('agent-exit', (e) => store.handleExit(e.payload));
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
			await store.restore(savedProjectsData);
			loadProviders();
			readAuthProviders()
				.then((p) => {
					providers = p;
					// First run: show the setup wizard only when nothing is configured yet
					// (a genuinely fresh machine). Pre-configured users skip it silently.
					if (!localStorage.getItem('jucode-setup-done')) {
						if (p.length > 0) localStorage.setItem('jucode-setup-done', '1');
						else showSetup = true;
					}
				})
				.catch(() => {});
		})();
		return () => {
			disposed = true;
			cleanups.forEach((f) => f());
		};
	});
</script>

<svelte:window onkeydown={onWindowKey} bind:innerWidth={winW} />

<div class="app">
	<!-- LEFT: navigation + sessions -->
	<Sidebar
		{projects}
		{activeId}
		width={sidebarWidth}
		{loggedIn}
		providerName={chat?.provider ?? ''}
		onSelect={(id) => (store.activeId = id)}
		onNewProject={addProject}
		onNewSession={(p) => store.addSession(p)}
		onCloseSession={(id) => store.removeSession(id)}
		onCloseProject={removeProject}
		onHistory={(p) => store.openHistory(p)}
		onSettings={() => (showSettings = true)}
		onMarket={() => (showMarket = true)}
		onCommandPalette={() => (showPalette = true)}
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
				<button class="hicon" class:on={showRight} onclick={toggleRight} aria-label="toggle panel" title="侧边面板 · ⌘B"><PanelRight size={16} /></button>
			</header>

			{#if Object.keys(chat.subagents).length}
				<div class="agents">
					{#each Object.entries(chat.subagents) as [path, info] (path)}
						<span class="agent"><span class="agent-dot"></span>{path} · {agentStatus(info.status)}</span>
					{/each}
				</div>
			{/if}

			{#if showFind}
				<div class="findbar">
					<Search size={14} />
					<input bind:this={findInputEl} bind:value={findQuery} onkeydown={findKey} placeholder="在对话中查找…" />
					<span class="findcount">{findQuery.trim() ? (findHits.length ? `${Math.min(findIdx + 1, findHits.length)}/${findHits.length}` : '无结果') : ''}</span>
					<IconButton size="sm" onclick={findPrev} label="上一个" disabled={!findHits.length}><ChevronUp size={15} /></IconButton>
					<IconButton size="sm" onclick={findNext} label="下一个" disabled={!findHits.length}><ChevronDown size={15} /></IconButton>
					<IconButton size="sm" onclick={closeFind} label="关闭"><X size={15} /></IconButton>
				</div>
			{/if}

			<main bind:this={scroller} onscroll={onScroll}>
				<div bind:this={contentEl}>
					<MessageList messages={chat.messages} {streamingMsg} {streamingReasoning} phase={chat.phase} compactionTokens={chat.compactionTokens} {findActive} onEdit={editMessage} onRewind={rewindToMessage} />
				</div>
				{#if chat.messages.length === 0 && !chat.busy}
					<div class="welcome">
						<span class="welcome-mark">JuCode</span>
						<p class="welcome-tip">给 JuCode 指派一个任务，开始新对话</p>
						<div class="welcome-hints">
							<span><kbd>/</kbd> 命令</span>
							<span><kbd>@</kbd> 引用文件</span>
							<span><kbd>⌘K</kbd> 命令面板</span>
							<span>拖入 / 粘贴图片</span>
						</div>
					</div>
				{/if}
			</main>
			{#if !atBottom}
				<button class="jump" style:bottom="{bottomH + 14}px" onclick={jumpToBottom} aria-label="scroll to bottom"><ChevronDown size={18} /></button>
			{/if}

			<div class="bottom" bind:clientHeight={bottomH}>
			{#if chat.engineState === 'exited'}
				<div class="approval-wrap">
					<div class="enginedown">
						<span class="ed-text">引擎已停止运行</span>
						<Button variant="primary" size="sm" onclick={() => store.restartSession(activeId, true)}>重启引擎</Button>
					</div>
				</div>
			{/if}
			{#if chat.pendingApproval}
				{@const isShell = ['bash', 'execute', 'exec_command', 'shell_command'].includes(chat.pendingApproval.name)}
				<div class="approval-wrap">
					<div class="approval">
						<div class="approval-head">
							<ShieldAlert size={15} />
							<span>{isShell ? '允许执行命令' : '允许修改文件'} · <b>{chat.pendingApproval.name}</b></span>
						</div>
						{#if chat.pendingApproval.summary}
							<pre class="approval-sum" class:cmd={isShell}>{isShell ? `$ ${chat.pendingApproval.summary}` : chat.pendingApproval.summary}</pre>
						{/if}
						<div class="approval-actions">
							<Button variant="primary" size="sm" onclick={() => respondApproval('allow once')}>允许一次</Button>
							<Button variant="secondary" size="sm" onclick={() => respondApproval('allow always')}>本会话始终允许</Button>
							<Button variant="danger" size="sm" onclick={() => respondApproval('deny')}>拒绝</Button>
						</div>
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
			</div>
		{:else}
			<div class="nochat" data-tauri-drag-region>
				<span class="welcome-mark">JuCode</span>
				<p class="welcome-tip">没有打开的对话</p>
				<Button variant="primary" size="sm" onclick={addProject}>选择项目，开始对话</Button>
			</div>
		{/if}
	</div>

	<!-- RIGHT: goal progress -->
	<div class="resizer" class:hidden={!showRight} role="separator" aria-label="resize panel" onpointerdown={startResize}></div>
	<aside class="right" class:closed={!showRight} class:resizing style:width={showRight ? `${rightWidth}px` : '0px'}>
		<div class="right-inner" style:width="{rightWidth}px">
			<RightDock
				goal={chat?.goal ?? null}
				plan={chat?.plan ?? []}
				cwd={activeProject?.path ?? ''}
				changed={chat?.changedFiles ?? []}
				onRevertFile={(p) => chat && (chat.changedFiles = chat.changedFiles.filter((x) => x !== p))}
			/>
		</div>
	</aside>

	{#if showSettings}
		<Settings sessionId={activeId} initialSection={settingsInitial} onAuthChange={refreshAuth} onClose={() => { showSettings = false; settingsInitial = 'model'; loadProviders(); }} />
	{/if}

	{#if showMarket}
		<Marketplace sessionId={activeId} onClose={() => (showMarket = false)} />
	{/if}

	{#if showSetup && activeId}
		<Setup
			sessionId={activeId}
			{loggedIn}
			onRefreshAuth={refreshAuth}
			onOpenSettings={() => {
				localStorage.setItem('jucode-setup-done', '1');
				showSetup = false;
				settingsInitial = 'account';
				showSettings = true;
			}}
			onClose={() => (showSetup = false)}
		/>
	{/if}

	{#if chat?.trustPrompt}
		<div class="overlay" role="presentation">
			<div class="modal trust" role="dialog" aria-modal="true" tabindex="-1" aria-label="信任项目" use:focusTrap>
				<div class="modal-head"><span>信任此项目？</span></div>
				<div class="trust-body">
					<p>该项目包含可执行代码的本地技能或 hooks。信任后 JuCode 才会加载它们。</p>
					<code class="trust-path">{chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd}</code>
				</div>
				<div class="trust-actions">
					<button class="btn ghost" onclick={() => respondTrust('no')}>不信任</button>
					{#if chat.trustPrompt.repoRoot}<button class="btn" onclick={() => respondTrust('repo')}>信任整个仓库</button>{/if}
					<button class="btn primary" onclick={() => respondTrust('yes')}>信任</button>
				</div>
			</div>
		</div>
	{/if}

	{#if chat?.picker}
		<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && chat?.closePicker()}>
			<div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label={pickerTitle} use:focusTrap>
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
				{#if showPickerSearch}
					<div class="psearch">
						<Search size={14} />
						<!-- svelte-ignore a11y_autofocus -->
						<input bind:value={pickerQuery} placeholder="筛选…" autofocus />
					</div>
				{/if}
				<div class="rows">
					{#each filteredRows as row, i (row.id)}
						<button class="prow" class:sel={i === selIdx} onclick={() => selectRow(row.command)} onmouseenter={() => (selIdx = i)} style:padding-left={row.depth != null ? `${11 + row.depth * 16}px` : null}>
							{#if chat.picker.kind === 'model'}<Vendor model={row.label} size={15} />{/if}
							{#if row.depth != null && row.depth > 0}<span class="twig">↳</span>{/if}
							<span class="prow-main">{row.label || '(empty)'}</span>
							<span class="prow-detail">{row.detail}</span>
							{#if row.active}<Check size={14} class="prow-check" />{/if}
						</button>
					{/each}
					{#if filteredRows.length === 0}<div class="pempty">{pickerQuery.trim() ? '无匹配' : '暂无可选项'}</div>{/if}
				</div>
				<div class="modal-foot dim">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
			</div>
		</div>
	{/if}

	{#if chat?.pendingRewind}
		<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && chat && (chat.pendingRewind = null)}>
			<div class="modal trust" role="dialog" aria-modal="true" tabindex="-1" aria-label="回退确认" use:focusTrap>
				<div class="modal-head"><span>回退到这一轮并重写？</span></div>
				<div class="trust-body">
					<p>对话会回退到这条消息发出前，<b>此后的文件改动也会一并还原</b>。原消息已填入输入框，可修改后重新发送。此操作不可撤销。</p>
					<code class="trust-path">{chat.pendingRewind.text.slice(0, 120)}</code>
				</div>
				<div class="trust-actions">
					<button class="btn ghost" onclick={() => chat && (chat.pendingRewind = null)}>取消</button>
					<button class="btn primary" onclick={confirmRewind}>回退并重写</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showPalette}
		<CommandPalette
			{chat}
			hasProject={!!activeProject}
			onClose={() => (showPalette = false)}
			onRun={(cmd) => nav(cmd)}
			onNewSession={() => activeProject && store.addSession(activeProject)}
			onNewProject={addProject}
			onSettings={() => (showSettings = true)}
			onMarket={() => (showMarket = true)}
			onTogglePanel={toggleRight}
			onToggleTheme={cycleTheme}
			onSetup={() => (showSetup = true)}
		/>
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
		bottom: 132px; /* overridden inline to sit just above the composer */
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
	/* Match the composer's outer frame (max-width 880, 18px side padding) so the
	   approval box lines up flush with the input box. */
	.approval-wrap {
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
		padding: 0 18px 10px;
	}
	.approval {
		padding: 12px 14px;
		background: color-mix(in oklab, var(--warn) 9%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--warn) 38%, transparent);
		border-radius: var(--r-md);
	}
	.enginedown {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		background: color-mix(in oklab, var(--err) 10%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--err) 38%, transparent);
		border-radius: var(--r-md);
	}
	.ed-text {
		font-size: 13px;
		color: var(--err);
		font-weight: 500;
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
	.approval-sum.cmd {
		color: var(--text);
		border-left: 2px solid var(--warn);
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
	.findbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
		background: var(--panel);
	}
	.findbar input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13.5px;
	}
	.findbar input::placeholder {
		color: var(--dim2);
	}
	.findcount {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--dim2);
		flex-shrink: 0;
		min-width: 36px;
		text-align: right;
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
	.welcome {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		animation: rise 0.3s ease both;
	}
	.welcome-mark {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		letter-spacing: -0.02em;
		color: var(--text);
		opacity: 0.16;
	}
	.welcome-tip {
		margin: 0;
		font-size: 14px;
		color: var(--dim);
	}
	.welcome-hints {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px 16px;
		margin-top: 6px;
		font-size: 12px;
		color: var(--dim2);
	}
	.welcome-hints span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.welcome-hints kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.nochat {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
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
		box-shadow: var(--shadow-modal);
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
	.psearch {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
	}
	.psearch input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13.5px;
	}
	.psearch input::placeholder {
		color: var(--dim2);
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
	.twig {
		color: var(--dim2);
		font-family: var(--font-mono);
		margin-right: -4px;
		flex-shrink: 0;
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
