<script lang="ts">
	// Status notices (retrying, compaction, engine warnings, stderr, restart
	// and subagent notices), kept out of the conversation: a small bell on the
	// strip under the composer, with a count of the ones not seen yet. Opening
	// the list marks them seen; the bell stays, quiet, to look again.
	import BellSimpleIcon from 'phosphor-svelte/lib/BellSimpleIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import { sheet } from '$lib/ui/motion';

	let { chat }: { chat: ChatState } = $props();
	let open = $state(false);
	let root = $state<HTMLElement | null>(null);
	let list = $state<HTMLElement | null>(null);

	const items = $derived(chat.statusLog);
	// A rewind can drop notices below the seen mark: count from there again.
	const unread = $derived(Math.max(0, items.length - Math.min(chat.statusSeen, items.length)));

	function toggle() {
		open = !open;
		if (open) chat.statusSeen = items.length;
	}
	// Seen while open: new ones arriving meanwhile count as read.
	$effect(() => {
		if (open) chat.statusSeen = items.length;
	});
	// The newest at the bottom, in view.
	$effect(() => {
		void items.length;
		if (open && list) list.scrollTop = list.scrollHeight;
	});

	function onDocDown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.stopPropagation();
			open = false;
		}
	}
</script>

<svelte:document onpointerdown={onDocDown} onkeydown={onKey} />

{#if items.length}
	<span class="anchor" bind:this={root}>
		<button
			class="bell"
			class:on={open}
			class:unread={unread > 0}
			onclick={toggle}
			aria-expanded={open}
			aria-label={unread ? `${t('chat.statusTitle')} · ${t('chat.statusUnread', { n: unread })}` : t('chat.statusTitle')}
			title={unread ? t('chat.statusUnread', { n: unread }) : t('chat.statusTitle')}
		>
			<BellSimpleIcon size={13} />
			{#if unread}<span class="badge">{unread > 99 ? '99+' : unread}</span>{/if}
		</button>
		{#if open}
			<div class="panel" role="dialog" aria-label={t('chat.statusTitle')} transition:sheet={{ y: 6 }}>
				<div class="phead">
					<span class="ptitle">{t('chat.statusTitle')} · {items.length}</span>
					<button class="pclose" onclick={() => (open = false)} aria-label={t('common.close')}><XIcon size={13} /></button>
				</div>
				<div class="plist" bind:this={list}>
					{#each items as it, i (i)}
						<div class="pitem">{it}</div>
					{/each}
				</div>
			</div>
		{/if}
	</span>
{/if}

<style>
	.anchor {
		position: relative;
		display: inline-flex;
		flex: none;
	}
	.bell {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		margin: -2px 0;
		padding: 0 5px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.bell.unread {
		color: var(--text);
	}
	.bell:hover,
	.bell.on {
		background: var(--surface2);
		color: var(--text);
	}
	.bell:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.badge {
		min-width: 16px;
		padding: 0 4px;
		border-radius: var(--r-full);
		background: var(--text);
		color: var(--bg);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		line-height: 15px;
		text-align: center;
	}
	.panel {
		position: absolute;
		right: -6px;
		bottom: calc(100% + 8px);
		z-index: 20;
		width: min(560px, calc(100vw - 48px));
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
		font-family: var(--font-sans);
		text-align: left;
	}
	.phead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px 8px 12px;
		border-bottom: 1px solid var(--hairline);
	}
	.ptitle {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--text);
	}
	.pclose {
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.pclose:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.plist {
		max-height: min(40vh, 320px);
		overflow-y: auto;
		padding: 4px 0;
	}
	.pitem {
		padding: 6px 12px;
		font-size: var(--fs-xs);
		line-height: 1.55;
		color: var(--dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.pitem + .pitem {
		border-top: 1px solid var(--hairline);
	}
</style>
