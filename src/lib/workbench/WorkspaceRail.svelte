<script lang="ts">
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import UserCircleIcon from 'phosphor-svelte/lib/UserCircleIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import ArrowCircleDownIcon from 'phosphor-svelte/lib/ArrowCircleDownIcon';
	import { t } from '$lib/i18n';
	import type { TabIcon } from './tabChrome';
	import type { WorkspaceEntry } from './workspaces';
	import TabGlyph from './TabGlyph.svelte';
	import TabChromePopover from './TabChromePopover.svelte';
	import AccountCard from './AccountCard.svelte';

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

	function openMenu(w: WorkspaceEntry, ev: MouseEvent) {
		ev.preventDefault();
		menuFor = { id: w.id, x: ev.clientX, y: ev.clientY };
	}
</script>

<nav class="rail" data-tauri-drag-region aria-label={t('shell.workspace.label')}>
	<div class="items" role="tablist">
		{#each workspaces as w (w.id)}
			<button
				class="ws"
				class:on={w.id === activeId}
				role="tab"
				aria-selected={w.id === activeId}
				title={w.name}
				onclick={() => !busy && onSwitch(w.id)}
				oncontextmenu={(e) => openMenu(w, e)}
			>
				<span class="tile">
					{#if w.icon || w.isDefault}
						<TabGlyph icon={w.icon ?? { kind: 'builtin', id: 'home' }} color={w.color} active={w.id === activeId} size={20} />
					{:else}
						<StackIcon size={20} weight={w.id === activeId ? 'fill' : 'regular'} />
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
				<span class="tile"><ArrowCircleDownIcon size={20} /></span>
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
			<span class="tile"><UserCircleIcon size={20} weight={card ? 'fill' : 'regular'} /></span>
		</button>
		<button class="ws" class:on={settingsOpen} title={t('shell.settings')} aria-label={t('shell.settings')} aria-pressed={settingsOpen} onclick={onSettings}>
			<span class="tile"><GearIcon size={20} weight={settingsOpen ? 'fill' : 'regular'} /></span>
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
		border-radius: var(--r-md);
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
	.ws:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
