<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import SquareIcon from '@lucide/svelte/icons/square';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import XIcon from '@lucide/svelte/icons/x';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { t } from '$lib/i18n';
	import { withShortcut } from '$lib/shortcuts';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';

	// The window's title bar, across the full width in the chrome colour: the
	// traffic lights (macOS) and the sidebar toggle at the start, the canvas
	// actions (plus the drawn window controls on Windows/Linux) at the end, and
	// the title of what is in front centred on the window between two
	// equal-width sides.
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
		addOptions?: { key: string; label: string; icon?: PopMenuItem['icon'] }[];
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
	<div class="lead" data-tauri-drag-region>
		<button
			class="tb-btn"
			title={withShortcut(t('shell.toggleSidebar'), 'sidebar')}
			aria-label={t('shell.toggleSidebar')}
			aria-pressed={sidebarOpen}
			onclick={onToggleSidebar}><PanelLeftIcon size={16} /></button
		>
	</div>
	<div class="title" data-tauri-drag-region>
		{#if title}<span class="t">{title}</span>{/if}
		{#if title && subtitle}<span class="s" aria-hidden="true">·</span>{/if}
		{#if subtitle}<span class="s">{subtitle}</span>{/if}
	</div>
	<div class="trail" data-tauri-drag-region>
		<div class="acts">
			{#if actions}{@render actions()}{/if}
			{#if addOptions.length}
				<button class="tb-btn" title={t('shell.addPanel')} aria-label={t('shell.addPanel')} aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}
					><PlusIcon size={16} /></button
				>
				{#if menuOpen}
					<PopMenu
						items={addOptions.map((o) => ({ key: o.key, label: o.label, icon: o.icon }))}
						onSelect={(key) => {
							menuOpen = false;
							onAdd?.(key);
						}}
						onClose={() => (menuOpen = false)}
					/>
				{/if}
			{/if}
		</div>
		{#if drawnControls}
			<div class="winctl">
				<button class="wc" title={t('shell.window.minimize')} aria-label={t('shell.window.minimize')} onclick={() => win().minimize()}><MinusIcon size={16} /></button>
				<button
					class="wc"
					title={maximized ? t('shell.window.restore') : t('shell.window.maximize')}
					aria-label={maximized ? t('shell.window.restore') : t('shell.window.maximize')}
					onclick={() => win().toggleMaximize()}
				>
					{#if maximized}<CopyIcon size={14} />{:else}<SquareIcon size={14} />{/if}
				</button>
				<button class="wc close" title={t('shell.window.close')} aria-label={t('shell.window.close')} onclick={() => win().close()}><XIcon size={16} /></button>
			</div>
		{/if}
	</div>
</header>

<style>
	/* Two 1fr sides keep the title centred on the window; a side only grows
	   past its half when its own content is wider. */
	.titlebar {
		/* Not zoomed with the rest of the interface: the traffic lights it
		   holds are the system's and stay their size and place (Tauri cannot
		   move them at run time). */
		zoom: calc(1 / var(--ui-zoom, 1));
		position: relative;
		display: grid;
		grid-template-columns: 1fr minmax(0, auto) 1fr;
		align-items: center;
		height: 48px;
		flex-shrink: 0;
		background: transparent;
		user-select: none;
	}
	/* Over the rail and session list. On macOS the traffic lights sit at its
	   start (trafficLightPosition in tauri.macos.conf.json centres them in the
	   bar); the toggle follows them. */
	.lead {
		justify-self: start;
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding-left: 14px;
	}
	:global(:root[data-os='macos']) .lead {
		padding-left: 84px;
	}
	:global(:root[data-os='windows']) .trail,
	:global(:root[data-os='linux']) .trail {
		padding-right: 0;
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
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tb-btn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.title {
		min-width: 0;
		padding: 0 12px;
		display: flex;
		align-items: baseline;
		gap: 8px;
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
	.trail {
		justify-self: end;
		align-self: stretch;
		display: flex;
		align-items: center;
		padding-right: 12px;
	}
	.acts {
		position: relative;
		display: flex;
		align-items: center;
		gap: 2px;
	}
</style>
