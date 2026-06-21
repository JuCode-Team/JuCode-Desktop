<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { Send, Square, LoaderCircle, Paperclip, X, Check, Plus } from 'lucide-svelte';
	import { ChatState } from '$lib/chat.svelte';
	import { sendOp, createSession, closeSession, type EventPayload } from '$lib/protocol';
	import ToolCard from '$lib/ToolCard.svelte';

	interface Session {
		id: string;
		chat: ChatState;
	}

	let sessions = $state<Session[]>([]);
	let activeId = $state('');
	let input = $state('');
	let attachments = $state<string[]>([]);
	let scroller = $state<HTMLElement | null>(null);
	let selIdx = $state(0);

	const active = $derived(sessions.find((s) => s.id === activeId));
	const chat = $derived(active?.chat);

	let counter = 0;
	const uid = () => `s${Date.now().toString(36)}-${(counter++).toString(36)}`;
	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	const base = (p: string) => p.split('/').pop() ?? p;

	const ctxPct = $derived(
		chat && chat.contextWindow > 0
			? Math.min(100, Math.round((chat.contextTokens / chat.contextWindow) * 100))
			: 0
	);

	// --- pickers (tree / model / resume) operate on the active session ---
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
			return p.nodes.map((n) => ({
				id: n.id,
				label: n.label,
				detail: n.id,
				active: n.active,
				command: `/checkout ${n.id}`
			}));
		if (p.kind === 'resume')
			return p.items.map((it) => ({
				id: it.id,
				label: it.label,
				detail: it.detail,
				active: it.active,
				command: `/resume ${it.id}`
			}));
		return p.models.map((m) => ({
			id: m.model,
			label: m.model,
			detail: `${fmtTokens(m.context_window)} ctx`,
			active: m.active,
			command: `/model ${m.model}`
		}));
	});

	$effect(() => {
		if (chat?.picker) {
			const i = pickerRows.findIndex((r) => r.active);
			selIdx = i >= 0 ? i : 0;
		}
	});
	$effect(() => {
		activeId; // re-scroll when switching sessions
		scrollToEnd();
	});
	$effect(() => {
		// Prefill the composer when the engine asks (e.g. after /checkout).
		if (chat?.pendingFill != null) {
			input = chat.pendingFill;
			chat.pendingFill = null;
		}
	});

	function respondTrust(answer: 'yes' | 'no' | 'repo') {
		if (!chat) return;
		sendOp(activeId, { op: 'command', input: `/trust ${answer}` });
		chat.trustPrompt = null;
	}

	function newSession() {
		const id = uid();
		sessions.push({ id, chat: new ChatState() });
		activeId = id;
		createSession(id).catch(() => {});
		return id;
	}
	function closeTab(id: string) {
		closeSession(id).catch(() => {});
		const idx = sessions.findIndex((s) => s.id === id);
		if (idx >= 0) sessions.splice(idx, 1);
		if (activeId === id) activeId = sessions[Math.min(idx, sessions.length - 1)]?.id ?? '';
		if (sessions.length === 0) newSession();
	}

	function submit() {
		if (!chat) return;
		const text = input.trim();
		if (!text && attachments.length === 0) return;
		if (text.startsWith('/')) {
			sendOp(activeId, { op: 'command', input: text });
		} else {
			sendOp(activeId, {
				op: 'user_message',
				content: text,
				images: attachments.length ? [...attachments] : undefined
			});
		}
		input = '';
		attachments = [];
	}
	function stop() {
		sendOp(activeId, { op: 'interrupt' });
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function selectRow(command: string) {
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

	async function scrollToEnd() {
		await tick();
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	onMount(() => {
		const cleanups: Array<() => void> = [];
		let disposed = false;
		// Register listeners BEFORE spawning the first engine so no startup event
		// (startup / model_status / command_list) is lost to a registration race.
		(async () => {
			const unlisten = await listen<EventPayload>('agent-event', (e) => {
				const s = sessions.find((x) => x.id === e.payload.session);
				if (!s) return;
				try {
					s.chat.handle(JSON.parse(e.payload.data));
				} catch {
					/* ignore malformed lines */
				}
				if (s.id === activeId) scrollToEnd();
			});
			const unexit = await listen<string>('agent-exit', (e) => {
				const s = sessions.find((x) => x.id === e.payload);
				if (!s) return;
				s.chat.engineState = 'exited';
				s.chat.messages.push({ kind: 'error', text: 'engine process exited' });
			});
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type === 'drop') {
					for (const p of e.payload.paths)
						if (isImage(p) && !attachments.includes(p)) attachments.push(p);
				}
			});
			cleanups.push(unlisten, unexit, undrop);
			if (disposed) {
				cleanups.forEach((f) => f());
				return;
			}
			newSession();
		})();
		return () => {
			disposed = true;
			cleanups.forEach((f) => f());
		};
	});
</script>

<svelte:window onkeydown={pickerKey} />

<div class="app">
	<aside class="sidebar">
		<div class="side-head">
			<span class="brand"><span class="dot"></span> JuCode</span>
			<button class="new-btn" onclick={() => newSession()} aria-label="new session"><Plus size={16} /></button>
		</div>
		<div class="session-list">
			{#each sessions as s (s.id)}
				<button class="sess" class:on={s.id === activeId} onclick={() => (activeId = s.id)}>
					<span
						class="sess-dot"
						class:busy={s.chat.busy}
						class:err={s.chat.engineState === 'exited'}
					></span>
					<span class="sess-title">{s.chat.title}</span>
					{#if s.chat.busy}<LoaderCircle size={12} class="spin" />{/if}
					{#if sessions.length > 1}
						<span
							class="sess-x"
							role="button"
							tabindex="0"
							onclick={(e) => {
								e.stopPropagation();
								closeTab(s.id);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.stopPropagation();
									closeTab(s.id);
								}
							}}
							aria-label="close session"><X size={12} /></span
						>
					{/if}
				</button>
			{/each}
		</div>
	</aside>

	<div class="main">
		{#if chat}
			<header>
				<div class="meta">
					<span class="model">{chat.model || '—'}</span>
					{#if chat.provider}<span class="sep">·</span><span class="dim">{chat.provider}</span>{/if}
					<span class="state" class:busy={chat.busy} class:err={chat.engineState === 'exited'}
						>{chat.engineState}</span
					>
					{#if chat.pending > 0}<span class="dim">+{chat.pending} queued</span>{/if}
				</div>
				<div class="usage">
					{#if chat.contextWindow > 0}
						<span class="dim">ctx</span>
						{fmtTokens(chat.contextTokens)}/{fmtTokens(chat.contextWindow)}
						<span class="bar"><span class="fill" style:width="{ctxPct}%"></span></span>
					{/if}
					{#if chat.cost > 0}<span class="cost">${chat.cost.toFixed(3)}</span>{/if}
				</div>
			</header>

			<main bind:this={scroller}>
				{#each chat.messages as m (m)}
					{#if m.kind === 'user'}
						<div class="msg user"><div class="role">you</div><div class="body">{m.text}</div></div>
					{:else if m.kind === 'assistant'}
						<div class="msg assistant"><div class="role">jucode</div><div class="body">{m.text}</div></div>
					{:else if m.kind === 'reasoning'}
						<div class="msg reasoning"><div class="role">thinking</div><div class="body">{m.text}</div></div>
					{:else if m.kind === 'tool'}
						<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} />
					{:else if m.kind === 'system'}
						<div class="msg system">{m.text}</div>
					{:else if m.kind === 'error'}
						<div class="msg error">{m.text}</div>
					{/if}
				{/each}
			</main>

			<footer>
				{#if attachments.length}
					<div class="chips">
						{#each attachments as p, i (p)}
							<span class="chip"><Paperclip size={12} />{base(p)}
								<button class="chip-x" onclick={() => attachments.splice(i, 1)} aria-label="remove"><X size={12} /></button>
							</span>
						{/each}
					</div>
				{/if}
				<div class="composer">
					<textarea
						bind:value={input}
						onkeydown={onKey}
						placeholder="Message JuCode…  (drop an image to attach · / for commands · Shift+Enter for newline)"
						rows="1"
					></textarea>
					{#if chat.busy}
						<button class="act stop" onclick={stop} aria-label="stop"><Square size={16} /></button>
					{:else}
						<button class="act send" onclick={submit} disabled={!input.trim() && !attachments.length} aria-label="send"><Send size={16} /></button>
					{/if}
				</div>
			</footer>
		{/if}
	</div>

	{#if chat?.trustPrompt}
		<div class="overlay" role="presentation">
			<div class="modal trust" role="dialog" tabindex="-1" aria-label="Trust project">
				<div class="modal-head"><span>Trust this project?</span></div>
				<div class="trust-body">
					<p>
						This project has local skills or hooks that can run code. Trust it to let
						JuCode load them.
					</p>
					<code class="trust-path">{chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd}</code>
				</div>
				<div class="trust-actions">
					<button class="btn ghost" onclick={() => respondTrust('no')}>Don't trust</button>
					{#if chat.trustPrompt.repoRoot}
						<button class="btn" onclick={() => respondTrust('repo')}>Trust repo</button>
					{/if}
					<button class="btn primary" onclick={() => respondTrust('yes')}>Trust</button>
				</div>
			</div>
		</div>
	{/if}

	{#if chat?.picker}
		<div
			class="overlay"
			role="presentation"
			onclick={(e) => {
				if (e.target === e.currentTarget) chat?.closePicker();
			}}
		>
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
						<button
							class="prow"
							class:sel={i === selIdx}
							onclick={() => selectRow(row.command)}
							onmouseenter={() => (selIdx = i)}
						>
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
	:global(:root) {
		--bg: #0e0e11;
		--panel: #16161b;
		--panel-2: #1c1c22;
		--border: #2a2a32;
		--text: #e8e4ee;
		--dim: #8a8794;
		--accent: #bea0ff;
		--err: #ff6b6b;
		--mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
		--sans: -apple-system, system-ui, 'Inter', sans-serif;
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: var(--sans);
	}
	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.app {
		display: flex;
		height: 100vh;
	}

	.sidebar {
		width: 230px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border-right: 1px solid var(--border);
	}
	.side-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 12px 10px 14px;
		border-bottom: 1px solid var(--border);
	}
	.brand {
		font-weight: 600;
		font-size: 14px;
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 8px var(--accent);
	}
	.new-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 7px;
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--text);
		cursor: pointer;
	}
	.new-btn:hover {
		border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
	}
	.session-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.sess {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 8px 9px;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.sess:hover {
		background: var(--panel-2);
	}
	.sess.on {
		background: var(--panel-2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.sess-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim);
		flex-shrink: 0;
	}
	.sess-dot.busy {
		background: var(--accent);
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
		align-items: center;
		color: var(--dim);
		opacity: 0;
		border-radius: 4px;
	}
	.sess:hover .sess-x {
		opacity: 1;
	}
	.sess-x:hover {
		color: var(--text);
	}

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	header {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		font-size: 13px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.model {
		font-family: var(--mono);
	}
	.sep {
		color: var(--dim);
	}
	.dim {
		color: var(--dim);
	}
	.state {
		font-family: var(--mono);
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--panel-2);
		color: var(--dim);
		border: 1px solid var(--border);
	}
	.state.busy {
		color: var(--accent);
		border-color: color-mix(in oklch, var(--accent) 40%, transparent);
	}
	.state.err {
		color: var(--err);
	}
	.usage {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--mono);
		font-size: 12px;
	}
	.bar {
		width: 64px;
		height: 5px;
		border-radius: 3px;
		background: var(--panel-2);
		overflow: hidden;
		display: inline-block;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.cost {
		color: var(--accent);
	}

	main {
		flex: 1;
		overflow-y: auto;
		padding: 20px 16px 28px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 860px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.msg .role {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim);
		margin-bottom: 4px;
	}
	.msg .body {
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.55;
	}
	.msg.user .body {
		background: var(--panel-2);
		border: 1px solid var(--border);
		padding: 10px 13px;
		border-radius: 10px;
	}
	.msg.assistant .role {
		color: var(--accent);
	}
	.msg.reasoning {
		opacity: 0.7;
		font-size: 13px;
	}
	.msg.reasoning .body {
		color: var(--dim);
		font-style: italic;
	}
	.msg.system {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--dim);
		text-align: center;
	}
	.msg.error {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--err);
		background: color-mix(in oklch, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklch, var(--err) 35%, transparent);
		padding: 9px 12px;
		border-radius: 8px;
	}

	footer {
		border-top: 1px solid var(--border);
		background: var(--panel);
		padding: 12px 16px 16px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		max-width: 828px;
		margin: 0 auto 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-family: var(--mono);
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 3px 5px 3px 8px;
		color: var(--text);
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
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		max-width: 828px;
		margin: 0 auto;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 8px 8px 8px 14px;
	}
	.composer:focus-within {
		border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.5;
		max-height: 180px;
		padding: 6px 0;
	}
	textarea::placeholder {
		color: var(--dim);
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 9px;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
	}
	.act.send {
		background: var(--accent);
		color: #1a1320;
	}
	.act.send:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.act.stop {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--err);
	}

	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
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
		border-radius: 14px;
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
		border-bottom: 1px solid var(--border);
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
		border-bottom: 1px solid var(--border);
		font-size: 12px;
	}
	.eff {
		font-family: var(--mono);
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--dim);
		cursor: pointer;
	}
	.eff.on {
		color: #1a1320;
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
		border-radius: 8px;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.prow.sel {
		background: var(--panel-2);
	}
	.prow-main {
		flex: 1;
		font-family: var(--mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prow-detail {
		color: var(--dim);
		font-size: 12px;
		font-family: var(--mono);
		flex-shrink: 0;
	}
	:global(.prow-check) {
		color: var(--accent);
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
		border-top: 1px solid var(--border);
		font-size: 11px;
		font-family: var(--mono);
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
		color: var(--text);
	}
	.trust-path {
		display: block;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--dim);
		background: var(--panel-2);
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
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--text);
		cursor: pointer;
	}
	.btn:hover {
		border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
	}
	.btn.ghost {
		color: var(--dim);
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #1a1320;
		font-weight: 600;
	}
</style>
