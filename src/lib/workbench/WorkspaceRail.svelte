<script lang="ts">
	import { Layers, Plus, PanelLeft } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import type { TabIcon } from './tabChrome';
	import type { WorkspaceEntry } from './workspaces';
	import TabGlyph from './TabGlyph.svelte';
	import TabChromePopover from './TabChromePopover.svelte';

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
		sidebarOpen,
		onToggleSidebar
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
		sidebarOpen: boolean;
		onToggleSidebar: () => void;
	} = $props();

	let menuFor = $state<{ id: string; x: number; y: number } | null>(null);
	const menuWs = $derived(menuFor ? (workspaces.find((w) => w.id === menuFor!.id) ?? null) : null);

	function openMenu(w: WorkspaceEntry, ev: MouseEvent) {
		ev.preventDefault();
		menuFor = { id: w.id, x: ev.clientX, y: ev.clientY };
	}
</script>

<nav class="rail" data-tauri-drag-region aria-label={t('shell.workspace.label')}>
	<button class="ws toggle" class:on={sidebarOpen} title={t('shell.toggleSidebar')} aria-label={t('shell.toggleSidebar')} aria-pressed={sidebarOpen} onclick={onToggleSidebar}>
		<span class="tile"><PanelLeft size={17} strokeWidth={1.5} /></span>
	</button>
	<div class="sep"></div>
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
						<TabGlyph icon={w.icon ?? { kind: 'builtin', id: 'home' }} color={w.color} active={w.id === activeId} size={17} />
					{:else}
						<Layers size={17} strokeWidth={1.5} />
					{/if}
				</span>
			</button>
		{/each}
		<button class="ws add" title={t('shell.workspace.new')} aria-label={t('shell.workspace.new')} disabled={busy} onclick={onNew}>
			<span class="tile"><Plus size={17} strokeWidth={1.5} /></span>
		</button>
	</div>
</nav>

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
		width: 72px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
				/* The rail is wide enough to hold the macOS traffic lights above it;
		   other platforms have a native title bar. */
		padding: 44px 0 12px;
		background: var(--rail);
	}
	:global(:root[data-os='windows']) .rail,
	:global(:root[data-os='linux']) .rail {
		padding-top: 12px;
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
	.sep {
		width: 24px;
		height: 1px;
		margin: 10px 0 6px;
		background: var(--hairline);
	}
	.ws.toggle.on .tile {
		background: none;
		box-shadow: none;
		color: var(--dim);
	}
	.ws.toggle.on:hover .tile {
		background: var(--surface2);
		color: var(--text);
	}
	.ws {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 56px;
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
		width: 38px;
		height: 38px;
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
		background: var(--bg);
		color: var(--text);
		box-shadow: var(--shadow-canvas);
	}
	.ws:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
