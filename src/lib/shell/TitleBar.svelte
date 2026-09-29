<script lang="ts">
	import type { Snippet } from 'svelte';
	import { PanelLeft, Plus } from 'lucide-svelte';
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
</script>

<header class="titlebar" data-tauri-drag-region>
	<button
		class="tb-btn toggle"
		class:on={sidebarOpen}
		title={t('shell.toggleSidebar')}
		aria-label={t('shell.toggleSidebar')}
		aria-pressed={sidebarOpen}
		onclick={onToggleSidebar}><PanelLeft size={16} strokeWidth={1.5} /></button
	>
	<div class="title" data-tauri-drag-region>
		{#if title}<span class="t">{title}</span>{/if}
		{#if subtitle}<span class="s">{subtitle}</span>{/if}
	</div>
	<div class="acts">
		{#if actions}{@render actions()}{/if}
		{#if addOptions.length}
			<button class="tb-btn" title={t('shell.addPanel')} aria-label={t('shell.addPanel')} aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}
				><Plus size={16} strokeWidth={1.5} /></button
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
</header>

<style>
	.titlebar {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		height: 44px;
		flex-shrink: 0;
		/* macOS: clear the traffic lights at the left edge. */
		padding: 0 10px 0 84px;
		background: var(--rail);
		border-bottom: 1px solid var(--hairline);
		user-select: none;
	}
	:global(:root[data-os='windows']) .titlebar,
	:global(:root[data-os='linux']) .titlebar {
		padding-left: 12px;
	}
	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
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
