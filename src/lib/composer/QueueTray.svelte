<script lang="ts">
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import ForwardIcon from '@lucide/svelte/icons/forward';
	import SquareArrowUpIcon from '@lucide/svelte/icons/square-arrow-up';
	import XIcon from '@lucide/svelte/icons/x';
	import { popOut } from '$lib/ui/motion';
	import { t } from '$lib/i18n';

	// Messages sent while a reply runs, inside the composer card above the
	// editor (as an agent's questions are), folded to their heading on a
	// click. Each waits for the turn to end in its place, which a drag by its
	// handle changes (`onMove`); it joins the running reply (`onSteer`, where
	// the engine can: `joins`; else stops the reply and goes now,
	// `onInterrupt`), comes back to the editor (`onUnqueue`), or is dropped
	// (`onDiscard`). The first `fixed` the engine has already: they only show.
	let {
		messages,
		fixed = 0,
		joins,
		hint = '',
		interruptHint = '',
		onSteer,
		onInterrupt,
		onUnqueue,
		onDiscard,
		onMove
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
		/** Drops queued message `index`. */
		onDiscard?: (index: number) => void;
		/** Moves queued message `index` to place `to`. */
		onMove?: (index: number, to: number) => void;
	} = $props();

	let folded = $state(false);

	// Dragging a row by its handle: it follows the pointer, the others slide
	// aside to show where it lands (among the rows after the fixed ones).
	let listEl = $state<HTMLElement | null>(null);
	let drag = $state<{ from: number; at: number; dy: number; size: number } | null>(null);
	function grab(e: PointerEvent, from: number) {
		if (e.button !== 0 || !listEl || !onMove) return;
		e.preventDefault();
		const rows = [...listEl.querySelectorAll<HTMLElement>('[data-row]')];
		const rects = rows.map((el) => el.getBoundingClientRect());
		const size = rects[from]!.height;
		const centres = rects.map((r) => r.top + r.height / 2);
		const startY = e.clientY;
		drag = { from, at: from, dy: 0, size };
		const move = (ev: PointerEvent) => {
			if (!drag) return;
			drag.dy = ev.clientY - startY;
			const y = centres[from]! + drag.dy;
			const at = centres.filter((c, i) => i !== from && c < y).length;
			drag.at = Math.max(fixed, at);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
			const d = drag;
			drag = null;
			if (d && d.at !== d.from) onMove?.(d.from, d.at);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	}
	function shiftOf(i: number): number {
		if (!drag) return 0;
		if (i === drag.from) return drag.dy;
		if (i > drag.from && i <= drag.at) return -drag.size;
		if (i < drag.from && i >= drag.at) return drag.size;
		return 0;
	}
</script>

<div class="tray" out:popOut={{ y: 3 }}>
	<button type="button" class="tray-head" onmousedown={(e) => e.preventDefault()} onclick={() => (folded = !folded)} aria-expanded={!folded}>
		<ListOrderedIcon size={14} />
		<span class="heading">{t('chat.queuedHeading')}</span>
		<span class="meta"
			>{#if hint && onSteer && joins}{t('chat.sendNowHint', { key: hint })}{/if}{#if interruptHint && onInterrupt}{hint && onSteer && joins ? ' · ' : ''}{t('chat.interruptHint', { key: interruptHint })}{/if}</span
		>
		<span class="count">{messages.length}</span>
		<span class="chev" class:folded><ChevronDownIcon size={14} /></span>
	</button>
	{#if !folded}
		<div class="list" class:dragging={!!drag} role="list" aria-label={t('chat.queuedHeading')} bind:this={listEl}>
			{#each messages as q, i (i)}
				<div class="row" class:held={drag?.from === i} style:transform={shiftOf(i) ? `translateY(${shiftOf(i)}px)` : undefined} role="listitem" data-row>
					{#if i < fixed}
						<span class="grip off"><GripVerticalIcon size={14} /></span>
						<span class="ttl" title={q}>{q}</span>
						<span class="sent">{t('chat.queuedSending')}</span>
					{:else}
						<span class="grip" role="button" tabindex="-1" aria-label={t('chat.queueDrag')} title={t('chat.queueDrag')} onpointerdown={(e) => grab(e, i)}><GripVerticalIcon size={14} /></span>
						<span class="ttl" title={q}>{q}</span>
						{#if onUnqueue}
							<button type="button" class="icon" onmousedown={(e) => e.preventDefault()} onclick={() => onUnqueue(i)} title={t('chat.unqueueTitle')} aria-label={t('chat.unqueueTitle')}>
								<PencilIcon size={14} />
							</button>
						{/if}
						{#if onSteer && joins}
							<button type="button" class="go" onmousedown={(e) => e.preventDefault()} onclick={() => onSteer(i)} title={t('chat.steerJoinTitle')}>
								<ForwardIcon size={14} />{t('chat.steerAction')}
							</button>
						{:else if onInterrupt}
							<button type="button" class="go" onmousedown={(e) => e.preventDefault()} onclick={() => onInterrupt(i)} title={t('chat.interruptTitle')}>
								<SquareArrowUpIcon size={14} />{t('chat.interruptAction')}
							</button>
						{/if}
						{#if onDiscard}
							<button type="button" class="icon" onmousedown={(e) => e.preventDefault()} onclick={() => onDiscard(i)} title={t('chat.queueDiscard')} aria-label={t('chat.queueDiscard')}>
								<XIcon size={14} />
							</button>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
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
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 2px 8px 6px 10px;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.heading {
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.meta {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.count {
		color: var(--dim);
		font-size: var(--fs-sm);
		font-variant-numeric: tabular-nums;
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.chev.folded {
		transform: rotate(-90deg);
	}
	.list {
		max-height: min(180px, 30vh);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.list.dragging {
		user-select: none;
	}
	.list.dragging .row {
		transition: transform 150ms var(--ease-out);
	}
	.list.dragging .row.held {
		position: relative;
		z-index: 1;
		background: var(--surface2);
		transition: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		padding: 2px 6px 2px 6px;
		border-radius: var(--r);
		animation: rise var(--t-med) var(--ease-out);
		transition: background var(--t-fast) var(--ease-out);
	}
	.row:hover {
		background: var(--surface2);
	}
	.grip {
		display: inline-flex;
		flex-shrink: 0;
		padding: 2px;
		color: var(--dim2);
		cursor: grab;
	}
	.grip.off {
		cursor: default;
		opacity: 0.4;
	}
	.list.dragging .grip {
		cursor: grabbing;
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
	.go,
	.icon {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		padding: 4px 8px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.icon {
		padding: 4px;
	}
	.row:hover .go,
	.row:hover .icon,
	.go:focus-visible,
	.icon:focus-visible {
		color: var(--text);
	}
	.go:hover,
	.icon:hover {
		background: color-mix(in oklab, var(--text) 8%, transparent);
	}
	.go:active,
	.icon:active {
		transform: scale(0.97);
	}
</style>
