<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { Send, Square, LoaderCircle, Paperclip, X, Check } from 'lucide-svelte';
	import { ChatState } from '$lib/chat.svelte';
	import { sendOp } from '$lib/protocol';

	const chat = new ChatState();
	let input = $state('');
	let attachments = $state<string[]>([]);
	let scroller = $state<HTMLElement | null>(null);
	let exited = $state(false);

	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const ctxPct = $derived(
		chat.contextWindow > 0 ? Math.min(100, Math.round((chat.contextTokens / chat.contextWindow) * 100)) : 0
	);
	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	const base = (p: string) => p.split('/').pop() ?? p;

	// --- picker (tree / model / resume) ---
	let selIdx = $state(0);
	const pickerTitle = $derived(
		chat.picker?.kind === 'tree'
			? 'Conversation tree'
			: chat.picker?.kind === 'model'
				? 'Select model'
				: chat.picker?.kind === 'resume'
					? 'Resume session'
					: ''
	);
	const activeModel = $derived(
		chat.picker?.kind === 'model' ? chat.picker.models.find((m) => m.active) : undefined
	);
	const pickerRows = $derived.by(() => {
		const p = chat.picker;
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
		if (chat.picker) {
			const i = pickerRows.findIndex((r) => r.active);
			selIdx = i >= 0 ? i : 0;
		}
	});

	function selectRow(command: string) {
		sendOp({ op: 'command', input: command });
		chat.closePicker();
	}
	function setEffort(effort: string) {
		if (activeModel) selectRow(`/model ${activeModel.model} ${effort}`);
	}
	function pickerKey(e: KeyboardEvent) {
		if (!chat.picker) return;
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

	onMount(() => {
		const unlisten = listen<string>('agent-event', (e) => {
			try {
				chat.handle(JSON.parse(e.payload));
			} catch {
				/* ignore malformed lines */
			}
			scrollToEnd();
		});
		const unexit = listen('agent-exit', () => {
			exited = true;
			chat.messages.push({ kind: 'error', text: 'engine process exited' });
		});
		const undrop = getCurrentWebview().onDragDropEvent((e) => {
			if (e.payload.type === 'drop') {
				for (const p of e.payload.paths) if (isImage(p) && !attachments.includes(p)) attachments.push(p);
			}
		});
		return () => {
			unlisten.then((f) => f());
			unexit.then((f) => f());
			undrop.then((f) => f());
		};
	});

	async function scrollToEnd() {
		await tick();
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	function submit() {
		const text = input.trim();
		if (!text && attachments.length === 0) return;
		if (text.startsWith('/')) {
			sendOp({ op: 'command', input: text });
		} else {
			sendOp({ op: 'user_message', content: text, images: attachments.length ? [...attachments] : undefined });
		}
		input = '';
		attachments = [];
	}

	function stop() {
		sendOp({ op: 'interrupt' });
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}
</script>

<svelte:window onkeydown={pickerKey} />

<div class="app">
	<header>
		<div class="brand"><span class="dot"></span> JuCode</div>
		<div class="meta">
			<span class="model">{chat.model || '—'}</span>
			{#if chat.provider}<span class="sep">·</span><span class="dim">{chat.provider}</span>{/if}
			<span class="state" class:busy={chat.busy} class:err={exited}>{exited ? 'exited' : chat.engineState}</span>
		</div>
		<div class="usage">
			{#if chat.contextWindow > 0}
				<span class="dim">ctx</span> {fmtTokens(chat.contextTokens)}/{fmtTokens(chat.contextWindow)}
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
				<div class="tool" class:err={m.isError}>
					<div class="tool-head">
						{#if m.running}<LoaderCircle size={13} class="spin" />{/if}
						<span class="tool-name">{m.name}</span>
						<span class="tool-state">{m.running ? 'running' : m.isError ? 'error' : 'done'}</span>
					</div>
					{#if m.output}<pre>{m.output}</pre>{/if}
				</div>
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

	{#if chat.picker}
		<div
			class="overlay"
			role="presentation"
			onclick={(e) => {
				if (e.target === e.currentTarget) chat.closePicker();
			}}
		>
			<div class="modal" role="dialog" tabindex="-1" aria-label={pickerTitle}>
				<div class="modal-head">
					<span>{pickerTitle}</span>
					<button class="modal-x" onclick={() => chat.closePicker()} aria-label="close"><X size={15} /></button>
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

	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
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
	.brand {
		font-weight: 600;
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
		color: var(--text);
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

	.tool {
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--panel);
		overflow: hidden;
	}
	.tool.err {
		border-color: color-mix(in oklch, var(--err) 40%, transparent);
	}
	.tool-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 11px;
		font-size: 12px;
		background: var(--panel-2);
	}
	.tool-name {
		font-family: var(--mono);
		font-weight: 600;
	}
	.tool-state {
		margin-left: auto;
		color: var(--dim);
		font-size: 11px;
	}
	.tool pre {
		margin: 0;
		padding: 10px 12px;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.5;
		color: var(--dim);
		max-height: 260px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
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
</style>
