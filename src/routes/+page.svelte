<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import {
		Send,
		Square,
		LoaderCircle,
		Paperclip,
		X,
		Check,
		Plus,
		Settings as SettingsIcon,
		Store,
		Sparkles,
		PanelRight,
		Sun,
		Moon,
		ChevronRight,
		History,
		Image as ImageIcon,
		FileText
	} from 'lucide-svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import { ChatState } from '$lib/chat.svelte';
	import { sendOp, createSession, closeSession, projectRoot, type EventPayload } from '$lib/protocol';
	import { themeState, toggleTheme } from '$lib/theme.svelte';
	import ToolCard from '$lib/ToolCard.svelte';
	import Settings from '$lib/Settings.svelte';
	import Marketplace from '$lib/Marketplace.svelte';
	import RightDock from '$lib/RightDock.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import ContextRing from '$lib/ContextRing.svelte';
	import EffortSlider from '$lib/EffortSlider.svelte';

	interface Session {
		id: string;
		chat: ChatState;
	}
	interface Project {
		id: string;
		name: string;
		path: string;
		sessions: Session[];
	}

	let projects = $state<Project[]>([]);
	let activeId = $state('');
	let input = $state('');
	let attachments = $state<{ path: string; image: boolean }[]>([]);
	let scroller = $state<HTMLElement | null>(null);
	let selIdx = $state(0);
	let slashIdx = $state(0);
	let showSettings = $state(false);
	let showMarket = $state(false);
	let showRight = $state(true);
	let rightWidth = $state(340);
	let resizing = $state(false);
	let showEffort = $state(false);

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
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

	const allSessions = $derived(projects.flatMap((p) => p.sessions));
	const active = $derived(allSessions.find((s) => s.id === activeId));
	const chat = $derived(active?.chat);
	const thinking = $derived.by(() => {
		if (!chat?.busy) return false;
		const last = chat.messages[chat.messages.length - 1];
		if (!last) return true;
		if (last.kind === 'user') return true;
		if ((last.kind === 'assistant' || last.kind === 'reasoning') && last.text.length === 0) return true;
		return false;
	});
	const activeProject = $derived(projects.find((p) => p.sessions.some((s) => s.id === activeId)));

	const slashMatches = $derived.by(() => {
		if (!chat) return [];
		const t = input.trim();
		if (!t.startsWith('/') || t.includes(' ')) return [];
		return chat.commands.filter((c) => c.command.startsWith(t) && c.command !== t).slice(0, 8);
	});
	$effect(() => {
		slashMatches;
		slashIdx = 0;
	});

	let counter = 0;
	const uid = () => `s${Date.now().toString(36)}-${(counter++).toString(36)}`;
	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

	const project = $derived(activeProject?.name ?? (chat?.cwd ? base(chat.cwd) : 'workspace'));
	const ctxPct = $derived(
		chat && chat.contextWindow > 0
			? Math.min(100, Math.round((chat.contextTokens / chat.contextWindow) * 100))
			: 0
	);

	// pickers (tree / model / resume) — active session
	const pickerTitle = $derived(
		chat?.picker?.kind === 'tree'
			? 'Conversation tree'
			: chat?.picker?.kind === 'model'
				? 'Select model'
				: chat?.picker?.kind === 'resume'
					? 'Resume session'
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
		scrollToEnd();
	});
	$effect(() => {
		if (chat?.pendingFill != null) {
			input = chat.pendingFill;
			chat.pendingFill = null;
		}
	});

	function saveProjects() {
		localStorage.setItem(
			'jucode-projects',
			JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name, path: p.path })))
		);
	}
	function addSession(project: Project) {
		const id = uid();
		project.sessions.push({ id, chat: new ChatState() });
		activeId = id;
		createSession(id, project.path).catch(() => {});
		return id;
	}
	async function addProject() {
		const path = await open({ directory: true, title: '选择项目目录' });
		if (!path || Array.isArray(path)) return;
		const p: Project = { id: uid(), name: base(path), path, sessions: [] };
		projects.push(p);
		saveProjects();
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
		saveProjects();
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
	function onKey(e: KeyboardEvent) {
		if (slashMatches.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				slashIdx = (slashIdx + 1) % slashMatches.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				slashIdx = (slashIdx - 1 + slashMatches.length) % slashMatches.length;
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				input = slashMatches[slashIdx].command + ' ';
				return;
			}
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
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

	async function scrollToEnd() {
		await tick();
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	onMount(() => {
		const savedW = Number(localStorage.getItem('jucode-right-width'));
		if (savedW >= 260 && savedW <= 640) rightWidth = savedW;
		const cleanups: Array<() => void> = [];
		let disposed = false;
		(async () => {
			const unlisten = await listen<EventPayload>('agent-event', (e) => {
				const s = allSessions.find((x) => x.id === e.payload.session);
				if (!s) return;
				try {
					s.chat.handle(JSON.parse(e.payload.data));
				} catch {
					/* ignore */
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
			// Load saved projects (metadata only); seed a default one on first run.
			let saved: Array<{ id: string; name: string; path: string }> = [];
			try {
				saved = JSON.parse(localStorage.getItem('jucode-projects') || '[]');
			} catch {
				saved = [];
			}
			if (Array.isArray(saved) && saved.length) {
				for (const p of saved) projects.push({ id: p.id, name: p.name, path: p.path, sessions: [] });
			} else {
				const root = await projectRoot();
				projects.push({ id: uid(), name: base(root), path: root, sessions: [] });
			}
			addSession(projects[0]);
		})();
		return () => {
			disposed = true;
			cleanups.forEach((f) => f());
		};
	});
</script>

<svelte:window onkeydown={pickerKey} />

<div class="app">
	<!-- LEFT: navigation + sessions -->
	<aside class="sidebar">
		<div class="brand" data-tauri-drag-region>
			<span class="word">JuCode</span>
		</div>

		<div class="nav">
			<button class="navcard" onclick={() => (showMarket = true)}><Store size={14} /><span>市场</span></button>
			<button class="navcard" onclick={() => nav('/skills')}><Sparkles size={14} /><span>技能</span></button>
		</div>

		<div class="sess-head">
			<span>对话 · 按项目</span>
			<div class="sess-actions">
				<button onclick={addProject} aria-label="new project" title="新建项目（选择目录）"><Plus size={15} /></button>
			</div>
		</div>

		<div class="sess-list">
			{#each projects as p (p.id)}
				<div class="group">
					<span class="group-name" title={p.path}>{p.name}</span>
					<span class="group-count">{p.sessions.length}</span>
					<button class="group-add" onclick={() => openHistory(p)} aria-label="history" title="历史对话"><History size={13} /></button>
					<button class="group-add no-auto" onclick={() => addSession(p)} aria-label="new session" title="在此项目下新建对话"><Plus size={13} /></button>
					{#if projects.length > 1}
						<button class="group-x" onclick={() => removeProject(p)} aria-label="close project" title="关闭项目"><X size={12} /></button>
					{/if}
				</div>
				{#each p.sessions as s (s.id)}
					<button class="sess" class:on={s.id === activeId} onclick={() => (activeId = s.id)}>
						<span class="sess-dot" class:busy={s.chat.busy} class:err={s.chat.engineState === 'exited'}></span>
						<span class="sess-title">{s.chat.title}</span>
						{#if s.chat.busy}<LoaderCircle size={12} class="spin" />{/if}
						<span
							class="sess-x"
							role="button"
							tabindex="0"
							onclick={(e) => {
								e.stopPropagation();
								removeSession(s.id);
							}}
							onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), removeSession(s.id))}
							aria-label="close"><X size={12} /></span
						>
					</button>
				{/each}
				{#if p.sessions.length === 0}
					<button class="sess-empty" onclick={() => addSession(p)}>+ 新建对话</button>
				{/if}
			{/each}
		</div>

		<div class="side-foot">
			<button class="foot-btn" onclick={() => (showSettings = true)}><SettingsIcon size={15} /><span>设置</span></button>
			<button class="foot-icon" onclick={toggleTheme} aria-label="toggle theme">
				{#if themeState.value === 'dark'}<Moon size={15} />{:else}<Sun size={15} />{/if}
			</button>
		</div>
	</aside>

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

			<main bind:this={scroller}>
				{#each chat.messages as m (m)}
					{#if m.kind === 'user'}
						<div class="row user">
							<div class="bubble">{m.text}</div>
						</div>
					{:else if m.kind === 'assistant'}
						<div class="text">{m.text}</div>
					{:else if m.kind === 'reasoning'}
						<div class="reason" class:open={!m.collapsed}>
							<button class="reason-head" onclick={() => (m.collapsed = !m.collapsed)}>
								<span class="rchev"><ChevronRight size={13} /></span>
								<span>推理</span>
							</button>
							{#if !m.collapsed}<div class="reason-body">{m.text}</div>{/if}
						</div>
					{:else if m.kind === 'tool'}
						<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} />
					{:else if m.kind === 'system'}
						<div class="system">{m.text}</div>
					{:else if m.kind === 'error'}
						<div class="error">{m.text}</div>
					{/if}
				{/each}
				{#if thinking}
					<div class="thinking" aria-label="thinking"><span class="td"></span><span class="td"></span><span class="td"></span></div>
				{/if}
			</main>

			<div class="composer-wrap">
				{#if slashMatches.length}
					<div class="slash">
						{#each slashMatches as c, i (c.command)}
							<button class="slash-item" class:sel={i === slashIdx} onclick={() => (input = c.command + ' ')} onmouseenter={() => (slashIdx = i)}>
								<span class="slash-cmd">{c.command}</span>
								{#if c.args}<span class="slash-args">{c.args}</span>{/if}
								{#if c.description}<span class="slash-desc">{c.description}</span>{/if}
								{#if c.marker}<span class="slash-marker">{c.marker}</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
				{#if attachments.length}
					<div class="chips">
						{#each attachments as a, i (a.path)}
							<span class="chip">
								{#if a.image}<ImageIcon size={12} />{:else}<FileText size={12} />{/if}{base(a.path)}
								<button class="chip-x" onclick={() => attachments.splice(i, 1)} aria-label="remove"><X size={12} /></button>
							</span>
						{/each}
					</div>
				{/if}
				<div class="composer">
					<textarea bind:value={input} onkeydown={onKey} rows="1" placeholder="给 JuCode 指派一个任务…  (拖入或点回形针附加文件 · / 唤起命令)"></textarea>
					<div class="composer-bar">
						<button class="cbtn" onclick={pickFiles} aria-label="attach" title="attach files"><Paperclip size={16} /></button>
						<button class="flatbtn model" onclick={() => nav('/model')} title="switch model">
							<Vendor model={chat.model} size={15} /><span>{chat.model || 'model'}</span>
						</button>
						{#if chat.efforts.length}
								<div class="effortsel">
									<button class="flatbtn" onclick={() => (showEffort = !showEffort)} title="thinking effort">
										{cap(chat.effort) || 'Effort'}
									</button>
									{#if showEffort}
										<button class="pop-backdrop" aria-label="close" onclick={() => (showEffort = false)}></button>
										<div class="effort-pop">
											<EffortSlider efforts={chat.efforts} current={chat.effort} onChange={chooseEffort} />
										</div>
									{/if}
								</div>
							{/if}
							<div class="cspace"></div>
							{#if chat.contextWindow > 0}<ContextRing pct={ctxPct} label={`context ${fmtTokens(chat.contextTokens)} / ${fmtTokens(chat.contextWindow)}`} />{/if}
						{#if chat.busy}
							<button class="cact stop" onclick={stop} aria-label="stop"><Square size={15} /></button>
						{:else}
							<button class="cact send" onclick={submit} disabled={!input.trim() && !attachments.length} aria-label="send"><Send size={16} /></button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- RIGHT: goal progress -->
	<div class="resizer" class:hidden={!showRight} role="separator" aria-label="resize panel" onpointerdown={startResize}></div>
	<aside class="right" class:closed={!showRight} class:resizing style:width={showRight ? `${rightWidth}px` : '0px'}>
		<div class="right-inner" style:width="{rightWidth}px">
			<RightDock goal={chat?.goal ?? null} cwd={activeProject?.path ?? ''} />
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
					<button class="modal-x" onclick={() => chat?.closePicker()} aria-label="close"><X size={15} /></button>
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

	/* ---------- sidebar ---------- */
	.sidebar {
		width: 248px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--sidebar);
		border-right: 1px solid var(--hairline);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 26px 18px 14px;
	}
	.word {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 17px;
		letter-spacing: -0.01em;
	}
	.nav {
		display: flex;
		gap: 6px;
		padding: 0 14px 10px;
	}
	.navcard {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 0;
		border-radius: var(--r-sm);
		border: 1px solid var(--hairline);
		background: none;
		color: var(--dim);
		font-size: 12px;
		cursor: pointer;
	}
	.navcard:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 16px 8px;
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.sess-actions {
		display: flex;
		gap: 4px;
	}
	.sess-actions button {
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: 6px;
		cursor: pointer;
	}
	.sess-actions button:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-actions button:disabled {
		opacity: 0.35;
	}
	.sess-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 8px 6px;
	}
	.group-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.group-count {
		font-size: 10px;
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 999px;
		padding: 1px 7px;
		flex-shrink: 0;
	}
	.group-add,
	.group-x {
		display: inline-flex;
		padding: 3px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: 5px;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0;
	}
	.group-add {
		margin-left: auto;
	}
	.group-add.no-auto {
		margin-left: 0;
	}
	.group:hover .group-add,
	.group:hover .group-x {
		opacity: 1;
	}
	.group-add:hover,
	.group-x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-empty {
		display: block;
		width: 100%;
		text-align: left;
		padding: 7px 12px;
		margin-left: 2px;
		border: none;
		background: none;
		color: var(--dim2);
		font-size: 12px;
		cursor: pointer;
		border-radius: var(--r-sm);
	}
	.sess-empty:hover {
		background: var(--surface);
		color: var(--text);
	}
	.sess {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 8px 9px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.sess:hover {
		background: var(--surface);
	}
	.sess.on {
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.sess-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.sess-dot.busy {
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.sess-dot.err {
		background: var(--err);
	}
	.sess-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess-x {
		display: inline-flex;
		color: var(--dim2);
		opacity: 0;
		border-radius: 4px;
	}
	.sess:hover .sess-x {
		opacity: 1;
	}
	.sess-x:hover {
		color: var(--text);
	}
	.side-foot {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 12px;
		border-top: 1px solid var(--hairline);
	}
	.foot-btn {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
		font-size: 13px;
	}
	.foot-btn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.foot-icon {
		display: inline-flex;
		padding: 8px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.foot-icon:hover {
		background: var(--surface2);
		color: var(--text);
	}

	/* ---------- center ---------- */
	.center {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg);
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
	.row {
		display: flex;
		animation: rise 0.18s ease;
	}
	.row.user {
		justify-content: flex-end;
	}
	.bubble {
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 14px 14px 4px 14px;
		padding: 11px 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 78%;
	}
	.text {
		line-height: 1.65;
		white-space: pre-wrap;
		word-break: break-word;
		animation: rise 0.18s ease;
	}
	.reason {
		border-left: 2px solid var(--hairline);
		padding-left: 12px;
	}
	.reason-head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.reason-head:hover {
		color: var(--text);
	}
	.rchev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform 0.12s;
	}
	.reason.open .rchev {
		transform: rotate(90deg);
	}
	.reason-body {
		margin-top: 4px;
		color: var(--dim);
		font-style: italic;
		font-size: 13px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.system {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim2);
		text-align: center;
	}
	.error {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 32%, transparent);
		padding: 9px 12px;
		border-radius: var(--r-sm);
	}
	.thinking {
		display: flex;
		gap: 5px;
		padding: 6px 2px;
	}
	.td {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: tdot 1s ease-in-out infinite;
	}
	.td:nth-child(2) {
		animation-delay: 0.16s;
	}
	.td:nth-child(3) {
		animation-delay: 0.32s;
	}
	@keyframes tdot {
		0%,
		100% {
			opacity: 0.3;
			transform: translateY(0);
		}
		50% {
			opacity: 1;
			transform: translateY(-3px);
		}
	}

	/* ---------- composer ---------- */
	.composer-wrap {
		padding: 0 18px 18px;
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
	}
	.composer {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		padding: 12px 14px 10px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	textarea {
		width: 100%;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 14px;
		line-height: 1.55;
		max-height: 180px;
		padding: 2px 0 8px;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	.composer-bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cbtn {
		display: inline-flex;
		padding: 7px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.cbtn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.flatbtn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-size: 13px;
		font-family: var(--font-sans);
		cursor: pointer;
	}
	.flatbtn:hover {
		background: var(--surface2);
	}
	.flatbtn.model span {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.effortsel {
		position: relative;
		display: inline-flex;
	}
	.pop-backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 20;
		cursor: default;
	}
	.effort-pop {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 21;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
		animation: rise 0.12s ease;
	}
	.cspace {
		flex: 1;
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: var(--r-md);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
	}
	.cact.send {
		background: linear-gradient(145deg, var(--accent-bright), var(--accent));
		color: var(--on-accent);
		box-shadow: 0 4px 14px var(--accent-soft);
	}
	.cact.send:disabled {
		opacity: 0.4;
		box-shadow: none;
		cursor: default;
	}
	.cact.stop {
		background: var(--surface2);
		border: 1px solid var(--border);
		color: var(--err);
	}

	.slash {
		margin-bottom: 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		overflow: hidden;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.slash-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.slash-item.sel {
		background: var(--surface2);
	}
	.slash-cmd {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.slash-args {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.slash-desc {
		flex: 1;
		color: var(--dim);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.slash-marker {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--accent-bright);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-family: var(--font-mono);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 3px 5px 3px 8px;
	}
	.chip-x {
		display: inline-flex;
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		padding: 1px;
	}
	.chip-x:hover {
		color: var(--text);
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
	.modal-x {
		display: inline-flex;
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
	}
	.modal-x:hover {
		color: var(--text);
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
