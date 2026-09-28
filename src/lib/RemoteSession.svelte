<script lang="ts">
	// One daemon session on the remote page: the conversation, a pending
	// approval and a composer. Watching it makes the session attended, so
	// approvals prompt here; leaving only unwatches it.
	import { onDestroy, onMount, tick } from 'svelte';
	import { ArrowLeft, Send, Square, RotateCw } from 'lucide-svelte';
	import MessageList from '$lib/MessageList.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { ChatState } from '$lib/chat.svelte';
	import { createJucodeAdapter } from '$lib/backends/jucode';
	import { daemon, type Op } from '$lib/protocol';
	import type { ApproveOp } from '$lib/approval';
	import { t } from '$lib/i18n';

	let {
		session,
		agent,
		title,
		register,
		onBack
	}: {
		/** An existing daemon session; omit to start a new one as `agent`. */
		session?: string;
		agent?: string;
		title: string;
		/** Routes daemon frames and exits for `id` here; returns an unregister. */
		register: (id: string, onFrame: (raw: string) => void, onExit: () => void) => () => void;
		onBack: () => void;
	} = $props();

	const id = `remote-${Math.random().toString(36).slice(2)}`;
	const chat = new ChatState();
	const adapter = createJucodeAdapter();
	let text = $state('');
	let error = $state('');
	let exited = $state(false);
	/** Set once the session is open here; sending earlier would fail and the
	 *  arriving snapshot would wipe the optimistic message. */
	let connected = $state(false);
	let scroller = $state<HTMLElement | null>(null);
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
		tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	}

	async function connect() {
		error = '';
		exited = false;
		connected = false;
		try {
			// A new session gets its id from the snapshot; later reconnects
			// reopen that same session.
			const resume = session ?? (chat.sessionId || undefined);
			await daemon.open(id, '', resume, resume ? undefined : agent);
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
		void connect();
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

	function submit() {
		const content = text.trim();
		if (!content || !connected) return;
		chat.optimisticUser(content);
		send({ op: 'user_message', content });
		text = '';
	}

	function respond(op: ApproveOp) {
		send(op);
		chat.pendingApproval = null;
	}
</script>

<div class="session">
	<header>
		<button class="back" onclick={onBack} aria-label={t('shell.remote.back')}><ArrowLeft size={18} /></button>
		<span class="title">{title}</span>
		{#if chat.busy}<span class="busy"></span>{/if}
	</header>

	<div class="scroll" bind:this={scroller}>
		<MessageList
			messages={chat.messages}
			{streamingMsg}
			{streamingReasoning}
			phase={chat.phase}
			compactionTokens={chat.compactionTokens}
			onEdit={(value) => (text = value)}
			onRewind={() => {}}
		/>
	</div>

	{#if chat.pendingApproval}
		<div class="approval">
			{#key chat.pendingApproval.callId}
				<ApprovalCard approval={chat.pendingApproval} onRespond={respond} />
			{/key}
		</div>
	{/if}

	{#if exited}
		<div class="notice">
			<span>{error || t('shell.remote.disconnected')}</span>
			<Button size="sm" onclick={connect}><RotateCw size={13} /> {t('shell.remote.reconnect')}</Button>
		</div>
	{/if}

	<form class="composer" onsubmit={(e) => (e.preventDefault(), submit())}>
		<textarea
			rows="1"
			bind:value={text}
			placeholder={t('shell.remote.messagePlaceholder')}
			onkeydown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), submit())}
		></textarea>
		{#if chat.busy}
			<button type="button" class="icon" onclick={() => send({ op: 'interrupt' })} aria-label={t('shell.remote.stop')}>
				<Square size={16} />
			</button>
		{/if}
		<button type="submit" class="icon primary" disabled={!text.trim() || !connected} aria-label={t('shell.remote.send')}>
			<Send size={16} />
		</button>
	</form>
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
		background: none;
		color: var(--text);
	}
	.title {
		flex: 1;
		font-weight: 600;
		font-size: 15px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.busy {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 12px 12px 4px;
	}
	.approval {
		padding: 8px 12px;
		border-top: 1px solid var(--hairline);
		max-height: 50vh;
		overflow-y: auto;
	}
	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 12px;
		font-size: 12.5px;
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
	}
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 8px 12px calc(env(safe-area-inset-bottom) + 8px);
		border-top: 1px solid var(--hairline);
		background: var(--panel);
	}
	textarea {
		flex: 1;
		min-height: 40px;
		max-height: 40vh;
		padding: 9px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		/* 16px keeps iOS from zooming into the field. */
		font-size: 16px;
		font-family: var(--font-sans);
		resize: none;
		outline: none;
		field-sizing: content;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
	}
	.icon.primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--accent-contrast, #fff);
	}
	.icon:disabled {
		opacity: 0.45;
	}
</style>
