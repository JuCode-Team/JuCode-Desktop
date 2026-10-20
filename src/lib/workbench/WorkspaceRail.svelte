<script lang="ts">
	import ActiveIcon from '$lib/icons/ActiveIcon.svelte';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CircleUserIcon from '@lucide/svelte/icons/circle-user';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import CircleArrowDownIcon from '@lucide/svelte/icons/circle-arrow-down';
	import { t } from '$lib/i18n';
	import { withShortcut } from '$lib/shortcuts';
	import type { TabIcon } from './tabChrome';
	import type { WorkspaceEntry } from './workspaces';
	import TabGlyph from './TabGlyph.svelte';
	import TabChromePopover from './TabChromePopover.svelte';
	import AccountCard from './AccountCard.svelte';
	import { rowIn, rowOut } from '$lib/ui/motion';
	import { railDrop } from './railDrop.svelte';

	// The outermost column: one entry per workspace (the top-level context —
	// switching it swaps the sidebar's projects and the canvas layout) and + to
	// add one. Names show on hover; right-click opens the chrome popover
	// (rename, color, icon, delete).
	let {
		workspaces,
		activeId,
		busy = false,
		onSwitch,
		onNew,
		onRename,
		onChrome,
		onDelete,
		onMove,
		loggedIn,
		updateAvailable = false,
		settingsOpen = false,
		onManageAccount,
		onSettings,
		onUpdate
	}: {
		workspaces: WorkspaceEntry[];
		activeId: string;
		/** A workspace swap is in flight: ignore switch / new / delete clicks. */
		busy?: boolean;
		onSwitch: (id: string) => void;
		onNew: () => void;
		onRename: (id: string, name: string) => void;
		onChrome: (id: string, chrome: { color?: string | null; icon?: TabIcon | null }) => void;
		onDelete: (id: string) => void;
		/** A dragged entry dropped before or after `target`. */
		onMove: (id: string, target: string, after: boolean) => void;
		/** Signed in to the JuCode account (not tied to any one chat). */
		loggedIn: boolean;
		updateAvailable?: boolean;
		/** The settings page is in front: the gear shows as selected. */
		settingsOpen?: boolean;
		/** Settings → Account: the card's sign-in / manage row. */
		onManageAccount: () => void;
		onSettings: () => void;
		/** Open settings at the update section. */
		onUpdate: () => void;
	} = $props();

	let menuFor = $state<{ id: string; x: number; y: number } | null>(null);
	const menuWs = $derived(menuFor ? (workspaces.find((w) => w.id === menuFor!.id) ?? null) : null);

	// Account card: hover opens it and leaving closes it after a short grace (so
	// the pointer can cross the gap); a click pins it until Esc or a click outside.
	let accountBtn = $state<HTMLButtonElement | null>(null);
	let card = $state<{ left: number; bottom: number } | null>(null);
	let pinned = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	function showCard() {
		clearTimeout(closeTimer);
		if (card || !accountBtn) return;
		const r = accountBtn.getBoundingClientRect();
		card = { left: r.right + 8, bottom: window.innerHeight - r.bottom };
	}
	function hideCardSoon() {
		clearTimeout(closeTimer);
		if (!pinned) closeTimer = setTimeout(() => (card = null), 160);
	}
	function closeCard() {
		clearTimeout(closeTimer);
		card = null;
		pinned = false;
	}
	function toggleCard() {
		if (card && pinned) return closeCard();
		showCard();
		pinned = true;
	}
	function outsideDown(e: PointerEvent) {
		const el = e.target as Element;
		if (card && !accountBtn?.contains(el) && !el.closest?.('.acct-card')) closeCard();
	}

	// Drag to reorder, with pointer events as the sidebar rows do (HTML drag
	// and drop is not reliable in the macOS webview): a press stays a click
	// until the pointer travels, then the entry follows it and the others
	// slide aside to show where it lands.
	let itemsEl = $state<HTMLElement | null>(null);
	/** `dy`: how far the entry has moved; `others`: the other entries in
	 *  order; `at`: where it would land among them; `size`: the room it takes. */
	let drag = $state<{ id: string; live: boolean; dy: number; from: number; at: number; size: number; others: string[] } | null>(null);
	function wsDown(e: PointerEvent, id: string) {
		if (e.button !== 0 || busy || !itemsEl) return;
		const list = itemsEl;
		const startX = e.clientX;
		const startY = e.clientY;
		let centres: number[] = [];
		drag = { id, live: false, dy: 0, from: 0, at: 0, size: 0, others: [] };
		const begin = () => {
			const rows = [...list.querySelectorAll<HTMLElement>('[data-ws-id]')];
			const rects = rows.map((el) => el.getBoundingClientRect());
			const from = rows.findIndex((el) => el.dataset.wsId === id);
			if (!drag || from < 0 || rows.length < 2) return false;
			const next = rects[from + 1] ?? null;
			const prev = rects[from - 1] ?? null;
			const size = next ? next.top - rects[from]!.top : prev ? rects[from]!.bottom - prev.bottom : rects[from]!.height;
			centres = rects.filter((_, i) => i !== from).map((r) => r.top + r.height / 2);
			const others = rows.filter((_, i) => i !== from).map((el) => el.dataset.wsId!);
			Object.assign(drag, { live: true, from, at: from, size, others });
			return true;
		};
		const noSelect = (ev: Event) => ev.preventDefault();
		const move = (ev: PointerEvent) => {
			if (!drag?.live && (!drag || Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5 || !begin())) return;
			drag!.dy = ev.clientY - startY;
			drag!.at = centres.filter((c) => c < ev.clientY).length;
		};
		const end = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', end);
			window.removeEventListener('selectstart', noSelect);
			const d = drag;
			drag = null;
			if (!d?.live) return;
			// The release ends the drag; it does not switch workspace.
			const swallow = (c: Event) => c.stopPropagation();
			window.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
			if (ev.type !== 'pointerup' || d.at === d.from) return;
			const to = d.at < d.others.length ? { id: d.others[d.at]!, after: false } : { id: d.others[d.others.length - 1]!, after: true };
			onMove(id, to.id, to.after);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
		window.addEventListener('selectstart', noSelect);
	}
	/** How far entry `id` moves while one is dragged. */
	function shiftOf(id: string): number {
		if (!drag?.live) return 0;
		if (id === drag.id) return drag.dy;
		const k = drag.others.indexOf(id);
		if (k >= drag.from && k < drag.at) return -drag.size;
		if (k >= drag.at && k < drag.from) return drag.size;
		return 0;
	}

	function openMenu(w: WorkspaceEntry, ev: MouseEvent) {
		ev.preventDefault();
		menuFor = { id: w.id, x: ev.clientX, y: ev.clientY };
	}
</script>

<nav class="rail" data-tauri-drag-region aria-label={t('shell.workspace.label')}>
	<div class="items" class:dragging={drag?.live} role="tablist" bind:this={itemsEl}>
		{#each workspaces as w (w.id)}
			<button
				class="ws"
				in:rowIn
				out:rowOut
				class:on={w.id === activeId}
				class:held={drag?.live && drag.id === w.id}
				class:drop={railDrop.id === w.id}
				style:transform={shiftOf(w.id) ? `translateY(${shiftOf(w.id)}px)` : undefined}
				data-ws-id={w.id}
				role="tab"
				aria-selected={w.id === activeId}
				title={w.name}
				onpointerdown={(e) => wsDown(e, w.id)}
				onclick={() => !busy && onSwitch(w.id)}
				oncontextmenu={(e) => openMenu(w, e)}
			>
				<span class="tile">
					{#if w.icon || w.isDefault}
						<TabGlyph icon={w.icon ?? { kind: 'builtin', id: 'home' }} color={w.color} active={w.id === activeId} size={20} />
					{:else}
						<ActiveIcon icon={LayersIcon} size={20} active={w.id === activeId} />
					{/if}
				</span>
			</button>
		{/each}
		<button class="ws add" title={t('shell.workspace.new')} aria-label={t('shell.workspace.new')} disabled={busy} onclick={onNew}>
			<span class="tile"><PlusIcon size={20} /></span>
		</button>
	</div>
	<!-- Bottom: the person and the app, as in Codex — out of the session list. -->
	<div class="foot">
		{#if updateAvailable}
			<button class="ws" title={t('shell.updateAvailable')} aria-label={t('shell.updateAvailable')} onclick={onUpdate}>
				<span class="tile"><CircleArrowDownIcon size={20} /></span>
			</button>
		{/if}
		<button
			bind:this={accountBtn}
			class="ws"
			class:on={!!card}
			aria-label={t('shell.account.title')}
			aria-haspopup="dialog"
			aria-expanded={!!card}
			onmouseenter={showCard}
			onmouseleave={hideCardSoon}
			onclick={toggleCard}
		>
			<span class="tile"><ActiveIcon icon={CircleUserIcon} size={20} active={!!card} /></span>
		</button>
		<button class="ws" class:on={settingsOpen} title={withShortcut(t('shell.settings'), 'settings')} aria-label={t('shell.settings')} aria-pressed={settingsOpen} onclick={onSettings}>
			<span class="tile"><ActiveIcon icon={SettingsIcon} size={20} active={settingsOpen} /></span>
		</button>
	</div>
</nav>

<svelte:window onpointerdown={outsideDown} onkeydown={(e) => e.key === 'Escape' && card && closeCard()} />

{#if card}
	<AccountCard
		{loggedIn}
		left={card.left}
		bottom={card.bottom}
		onEnter={() => clearTimeout(closeTimer)}
		onLeave={hideCardSoon}
		onManage={() => {
			closeCard();
			onManageAccount();
		}}
	/>
{/if}

{#if menuFor && menuWs}
	<TabChromePopover
		x={menuFor.x}
		y={menuFor.y}
		name={menuWs.name}
		color={menuWs.color ?? null}
		icon={menuWs.icon ?? null}
		onRename={(n) => onRename(menuWs.id, n)}
		onColor={(c) => onChrome(menuWs.id, { color: c })}
		onIcon={(i) => onChrome(menuWs.id, { icon: i })}
		onDelete={!menuWs.isDefault && workspaces.length > 1
			? () => {
					const id = menuWs.id;
					menuFor = null;
					onDelete(id);
				}
			: undefined}
		deleteLabel={t('shell.workspace.delete')}
		onClose={() => (menuFor = null)}
	/>
{/if}

<style>
	.rail {
		width: 68px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
				padding: 4px 0 12px;
		background: transparent;
	}
	.foot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		margin-top: auto;
		padding-top: 8px;
	}
	.items {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		min-height: 0;
		overflow-y: auto;
		/* Room for the selected tile's shadow inside the scroll box. */
		padding: 4px 0 8px;
	}
	.ws {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 60px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: var(--r);
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			box-shadow var(--t-fast) var(--ease-out);
	}
	.ws:hover .tile {
		background: var(--surface2);
		color: var(--text);
	}
	.ws.on .tile {
		background: var(--surface2);
		color: var(--text);
	}
	/* A project dragged from the sidebar would move here. */
	.ws.drop .tile {
		background: var(--surface2);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	/* Dragging an entry: it follows the pointer above the others, which
	   slide aside to show where it lands. */
	.items.dragging {
		cursor: grabbing;
		user-select: none;
	}
	.items.dragging .ws {
		pointer-events: none;
		transition: transform 150ms var(--ease-out);
	}
	.items.dragging .ws.held {
		position: relative;
		z-index: 2;
		transition: none;
	}
	.items.dragging .ws.held .tile {
		background: var(--surface2);
		box-shadow: var(--shadow-sm);
	}
	.ws:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
