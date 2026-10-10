<script lang="ts">
	// The open conversation (or a new one: `id` absent): its messages, which
	// follow a streaming reply while you are at the end, and the composer —
	// in the middle of an empty page, at the bottom once there is a thread.
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { t } from '$lib/i18n';
	import { toast } from '$lib/ui/toast.svelte';
	import { chat, contextFull } from './chat.svelte';
	import { models } from './models.svelte';
	import { chatPrefs } from './prefs.svelte';
	import { shell } from './shell.svelte';
	import MessageItem from './MessageItem.svelte';
	import WebComposer from './WebComposer.svelte';

	let { id }: { id?: string } = $props();

	// Only the address drives this: the store's own changes (the first
	// message saving the conversation) must not reset it.
	$effect(() => {
		const to = id;
		untrack(() => {
			if (to) void chat.open(to);
			else if (chat.saved) chat.fresh();
		});
	});
	// A new conversation saved by its first message: its own address.
	$effect(() => {
		if (!id && chat.saved && chat.id) void goto(`/c/${chat.id}`, { replaceState: true, keepFocus: true, noScroll: true });
	});

	const opts = () => ({ model: chatPrefs.current, effort: chatPrefs.effort, search: chatPrefs.search, research: chatPrefs.research });
	async function send(text: string, files: File[]): Promise<boolean> {
		follow = true;
		try {
			await chat.send(text, files, opts());
			return true;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
			return false;
		}
	}

	// Following the end: kept while you are there, dropped when you scroll up.
	let scroller = $state<HTMLElement | null>(null);
	let follow = $state(true);
	let atEnd = $state(true);
	function onScroll() {
		if (!scroller) return;
		atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
		follow = atEnd;
	}
	function toEnd(smooth = false) {
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
	}
	$effect(() => {
		// Any change to the thread (a message, streamed text).
		const last = chat.msgs.at(-1);
		void chat.msgs.length;
		void last?.content;
		void last?.reasoning;
		void last?.status;
		if (follow) tick().then(() => toEnd());
	});
	// A conversation opened: from its end.
	$effect(() => {
		void chat.id;
		follow = true;
	});

	const empty = $derived(!chat.loading && chat.msgs.length === 0);
	const closed = $derived(models.loaded && !models.list.length);
	// Too long for the model: it ends here (never shortened behind your back).
	const full = $derived(!chat.busy && contextFull(models.find(chatPrefs.current), chat.msgs));
</script>

<div class="view">
	<header>
		{#if shell.collapsed}
			<button class="icon" onclick={() => shell.toggle()} title={t('web.side.expand')} aria-label={t('web.side.expand')}><SidebarSimpleIcon size={18} /></button>
		{/if}
		<button class="icon narrow" onclick={() => shell.toggle()} title={t('web.side.expand')} aria-label={t('web.side.expand')}><SidebarSimpleIcon size={18} /></button>
		<span class="title">{chat.title || ''}</span>
		<span class="grow"></span>
		{#if shell.collapsed || !empty}
			<button class="icon" onclick={() => (chat.fresh(), goto('/chat'))} title={t('web.side.newChat')} aria-label={t('web.side.newChat')}><NotePencilIcon size={18} /></button>
		{/if}
	</header>

	{#if closed}
		<div class="center">
			<h1>{t('web.chat.closed')}</h1>
			<p class="hint">{models.error || t('web.chat.closedHint')}</p>
		</div>
	{:else if empty}
		<div class="center">
			<h1>{t('web.chat.greeting')}</h1>
			<div class="col"><WebComposer busy={chat.busy} onSend={send} onStop={() => chat.interrupt()} autofocus /></div>
		</div>
	{:else}
		<div class="scroll" bind:this={scroller} onscroll={onScroll}>
			<div class="col thread">
				{#if chat.loading}<p class="loading"><CircleNotchIcon size={16} class="spin" /></p>{/if}
				{#each chat.msgs as m, i (m.id)}
					<MessageItem
						{m}
						last={i === chat.msgs.length - 1}
						busy={chat.busy}
						onRegenerate={() => chat.regenerate(opts())}
						onEdit={(text) => {
							follow = true;
							void chat.edit(m.id, text, opts());
						}}
						onCancelResearch={() => chat.cancelResearch()}
					/>
				{/each}
				{#if chat.error}<p class="error">{chat.error}</p>{/if}
			</div>
		</div>
		<div class="bottom">
			{#if !atEnd}
				<button class="jump" onclick={() => ((follow = true), toEnd(true))} title={t('web.chat.jump')} aria-label={t('web.chat.jump')}><ArrowDownIcon size={16} /></button>
			{/if}
			<div class="col">
				{#if full}
					<div class="full">
						<span>{t('web.chat.full')}</span>
						<button onclick={() => (chat.fresh(), goto('/chat'))}><NotePencilIcon size={16} />{t('web.side.newChat')}</button>
					</div>
				{:else}
					<WebComposer busy={chat.busy} onSend={send} onStop={() => chat.interrupt()} />
				{/if}
				<p class="disclaimer">{t('web.chat.disclaimer')}</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.view {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 52px;
		padding: 8px 12px;
	}
	.title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--dim);
	}
	.grow {
		flex: 1;
	}
	.icon {
		display: inline-flex;
		padding: 7px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.icon.narrow {
		display: none;
	}
	.col {
		width: 100%;
		max-width: 780px;
		margin: 0 auto;
		padding: 0 20px;
	}
	.center {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 22px;
		padding-bottom: 12vh;
	}
	h1 {
		margin: 0;
		font-size: var(--fs-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		text-align: center;
	}
	.hint {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.thread {
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding-top: 12px;
		padding-bottom: 32px;
	}
	.loading {
		display: flex;
		justify-content: center;
		color: var(--dim2);
	}
	.error {
		margin: 0;
		color: var(--err);
		font-size: var(--fs-sm);
	}
	.bottom {
		position: relative;
		padding-bottom: max(8px, env(safe-area-inset-bottom));
	}
	.jump {
		position: absolute;
		top: -48px;
		left: 50%;
		display: inline-flex;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-float);
		transform: translateX(-50%);
		cursor: pointer;
	}
	.full {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 12px 12px 16px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--panel);
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.full button {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border: none;
		border-radius: var(--r-md);
		background: var(--text);
		color: var(--bg);
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.disclaimer {
		margin: 6px 0 0;
		text-align: center;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	@media (max-width: 760px) {
		.icon.narrow {
			display: inline-flex;
		}
		.col {
			padding: 0 12px;
		}
	}
</style>
