<script lang="ts">
	import CornerDownRightIcon from '@lucide/svelte/icons/corner-down-right';
	import FastForwardIcon from '@lucide/svelte/icons/fast-forward';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import SquareArrowUpIcon from '@lucide/svelte/icons/square-arrow-up';
	import { popOut } from '$lib/ui/motion';
	import { t } from '$lib/i18n';

	// Messages sent while a reply runs, inside the composer card above the
	// editor (as an agent's questions are): each waits for the turn to end,
	// joins the running reply (`onSteer`, where the engine can: `joins`),
	// stops the reply and goes now (`onInterrupt`), or comes back to the
	// editor (`onUnqueue`). The first `fixed` the engine has already.
	let {
		messages,
		fixed = 0,
		joins,
		hint = '',
		interruptHint = '',
		onSteer,
		onInterrupt,
		onUnqueue
	}: {
		messages: string[];
		fixed?: number;
		joins: boolean;
		/** The shortcut that sends a typed message now, shown in the heading. */
		hint?: string;
		/** The shortcut that stops the reply and sends a typed message. */
		interruptHint?: string;
		/** Sends queued message `index` into the running reply. */
		onSteer?: (index: number) => void;
		/** Stops the running reply and sends queued message `index` now. */
		onInterrupt?: (index: number) => void;
		/** Takes queued message `index` back to the editor. */
		onUnqueue?: (index: number) => void;
	} = $props();
</script>

<div class="tray" out:popOut={{ y: 3 }}>
	<div class="tray-head">
		<span class="heading">{t('chat.queuedHeading')}</span>
		<span class="meta"
			>{t('chat.queuedMeta', { n: messages.length })}{#if hint && onSteer && joins}{' · '}{t('chat.sendNowHint', { key: hint })}{/if}{#if interruptHint && onInterrupt}{' · '}{t('chat.interruptHint', { key: interruptHint })}{/if}</span
		>
	</div>
	<div class="list" role="list" aria-label={t('chat.queuedHeading')}>
		{#each messages as q, i (i)}
			<div class="row" role="listitem">
				<span class="ico"><CornerDownRightIcon size={14} /></span>
				<span class="ttl" title={q}>{q}</span>
				{#if i < fixed}
					<span class="sent">{t('chat.queuedSending')}</span>
				{:else}
					{#if onUnqueue}
						<button type="button" class="go" onmousedown={(e) => e.preventDefault()} onclick={() => onUnqueue(i)} title={t('chat.unqueueTitle')}>
							<Undo2Icon size={12} />{t('chat.unqueueAction')}
						</button>
					{/if}
					{#if onSteer && joins}
						<button type="button" class="go" onmousedown={(e) => e.preventDefault()} onclick={() => onSteer(i)} title={t('chat.steerJoinTitle')}>
							<FastForwardIcon size={12} />{t('chat.steerAction')}
						</button>
					{/if}
					{#if onInterrupt}
						<button type="button" class="go" onmousedown={(e) => e.preventDefault()} onclick={() => onInterrupt(i)} title={t('chat.interruptTitle')}>
							<SquareArrowUpIcon size={12} />{t('chat.interruptAction')}
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	/* The composer tray's frame (ComposerTray): rows above the editor, a
	   hairline under them. */
	.tray {
		margin: -4px -6px 8px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--hairline);
		animation: rise var(--t-med) var(--ease-out);
	}
	.tray-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 2px 8px 4px;
	}
	.heading {
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.meta {
		margin-left: auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.list {
		max-height: min(180px, 30vh);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 32px;
		padding: 2px 6px 2px 10px;
		border-radius: var(--r);
		animation: rise var(--t-med) var(--ease-out);
		transition: background var(--t-fast) var(--ease-out);
	}
	.row:hover {
		background: var(--surface2);
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
	}
	.ttl {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.sent {
		flex-shrink: 0;
		padding: 3px 9px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.go {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		padding: 3px 9px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.row:hover .go,
	.go:focus-visible {
		color: var(--text);
	}
	.go:hover {
		background: color-mix(in oklab, var(--text) 8%, transparent);
	}
	.go:active {
		transform: scale(0.97);
	}
</style>
