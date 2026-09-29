<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { PanelLeft, Plus, Minus, Square, Copy, X } from 'lucide-svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';

	// The window's title bar, across the full width in the chrome colour: the
	// traffic lights (macOS) and the sidebar toggle over the rail and session
	// list, then the title of what is in front, aligned with the canvas, and the
	// canvas actions (plus the drawn window controls on Windows/Linux).
	let {
		leftWidth,
		sidebarOpen,
		onToggleSidebar,
		title = '',
		subtitle = '',
		addOptions = [],
		onAdd,
		actions
	}: {
		/** Width of the columns left of the canvas; the title starts past them. */
		leftWidth: number;
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
	<div class="lead" style:width="{leftWidth}px" data-tauri-drag-region>
		<button
			class="tb-btn"
			title={t('shell.toggleSidebar')}
			aria-label={t('shell.toggleSidebar')}
			aria-pressed={sidebarOpen}
			onclick={onToggleSidebar}><PanelLeft size={18} strokeWidth={1.5} /></button
		>
	</div>
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
				<PopMenu
					items={addOptions.map((o) => ({ key: o.key, label: o.label }))}
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
		padding-right: 12px;
		background: transparent;
		user-select: none;
	}
	/* Over the rail and session list. On macOS the traffic lights sit at its
	   start (trafficLightPosition in tauri.macos.conf.json centres them in the
	   bar); the toggle follows them. */
	.lead {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		min-width: max-content;
		padding-left: 14px;
	}
	:global(:root[data-os='macos']) .lead {
		padding-left: 84px;
	}
	:global(:root[data-os='windows']) .titlebar,
	:global(:root[data-os='linux']) .titlebar {
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
		padding-left: 12px;
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
</style>
