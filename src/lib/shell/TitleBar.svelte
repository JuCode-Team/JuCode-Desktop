<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { PanelLeft, Plus, Minus, Square, Copy, X } from 'lucide-svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { t } from '$lib/i18n';

	// The window's own layer: traffic lights (macOS), the sidebar toggle, the
	// title of what is in front and the canvas actions. With the workspace rail
	// it forms the window chrome around the content (session list + canvas).
	let {
		sidebarOpen,
		onToggleSidebar,
		title = '',
		subtitle = '',
		addOptions = [],
		onAdd,
		actions
	}: {
		sidebarOpen: boolean;
		onToggleSidebar: () => void;
		title?: string;
		subtitle?: string;
		/** Panels that can be opened next to the focused one. */
		addOptions?: { key: string; label: string }[];
		onAdd?: (key: string) => void;
		/** Extra actions for the session in front (e.g. continue in the TUI). */
		actions?: Snippet;
	} = $props();

	let menuOpen = $state(false);

	// Windows and Linux run without the system title bar (decorations off in
	// tauri.windows/linux.conf.json), so the window controls are drawn here.
	// macOS keeps its native traffic lights.
	const drawnControls =
		typeof document !== 'undefined' && document.documentElement.dataset.os !== 'macos';
	let maximized = $state(false);
	onMount(() => {
		if (!drawnControls || !('__TAURI_INTERNALS__' in window)) return;
		const win = getCurrentWindow();
		const sync = () => win.isMaximized().then((m) => (maximized = m)).catch(() => {});
		sync();
		const unlisten = win.onResized(sync);
		return () => {
			unlisten.then((f) => f());
		};
	});
	const win = () => getCurrentWindow();
</script>

<header class="titlebar" data-tauri-drag-region>
	<button
		class="tb-btn toggle"
		class:on={sidebarOpen}
		title={t('shell.toggleSidebar')}
		aria-label={t('shell.toggleSidebar')}
		aria-pressed={sidebarOpen}
		onclick={onToggleSidebar}><PanelLeft size={18} strokeWidth={1.5} /></button
	>
	<div class="title" data-tauri-drag-region>
		{#if title}<span class="t">{title}</span>{/if}
		{#if subtitle}<span class="s">{subtitle}</span>{/if}
	</div>
	<div class="acts">
		{#if actions}{@render actions()}{/if}
		{#if addOptions.length}
			<button class="tb-btn" title={t('shell.addPanel')} aria-label={t('shell.addPanel')} aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}
				><Plus size={18} strokeWidth={1.5} /></button
			>
			{#if menuOpen}
				<button class="backdrop" aria-label="close menu" tabindex="-1" onclick={() => (menuOpen = false)}></button>
				<div class="menu" role="menu">
					{#each addOptions as o (o.key)}
						<button
							class="item"
							role="menuitem"
							onclick={() => {
								menuOpen = false;
								onAdd?.(o.key);
							}}>{o.label}</button
						>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
	{#if drawnControls}
		<div class="winctl">
			<button class="wc" title={t('shell.window.minimize')} aria-label={t('shell.window.minimize')} onclick={() => win().minimize()}><Minus size={18} strokeWidth={1.5} /></button>
			<button
				class="wc"
				title={maximized ? t('shell.window.restore') : t('shell.window.maximize')}
				aria-label={maximized ? t('shell.window.restore') : t('shell.window.maximize')}
				onclick={() => win().toggleMaximize()}
			>
				{#if maximized}<Copy size={14} strokeWidth={1.5} />{:else}<Square size={13} strokeWidth={1.5} />{/if}
			</button>
			<button class="wc close" title={t('shell.window.close')} aria-label={t('shell.window.close')} onclick={() => win().close()}><X size={18} strokeWidth={1.5} /></button>
		</div>
	{/if}
</header>

<style>
	.titlebar {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		height: 48px;
		flex-shrink: 0;
		/* macOS: clear the traffic lights at the left edge. */
		padding: 0 10px 0 84px;
		background: var(--rail);
		border-bottom: 1px solid var(--hairline);
		user-select: none;
	}
	:global(:root[data-os='windows']) .titlebar,
	:global(:root[data-os='linux']) .titlebar {
		padding: 0 0 0 12px;
	}
	.winctl {
		display: flex;
		align-self: stretch;
		margin-left: 6px;
	}
	.wc {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 46px;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.wc:hover {
		background: var(--surface2);
		color: var(--text);
	}
	/* Close turns red on hover, as the system controls do. */
	.wc.close:hover {
		background: var(--err);
		color: var(--on-accent);
	}
	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tb-btn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
		white-space: nowrap;
		overflow: hidden;
	}
	.t {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.s {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.acts {
		position: relative;
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		border: none;
		background: none;
	}
	.menu {
		position: absolute;
		top: 36px;
		right: 0;
		z-index: 41;
		min-width: 180px;
		padding: 6px;
		border-radius: var(--r-md);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
	}
	.item {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 32px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface2);
	}
</style>
