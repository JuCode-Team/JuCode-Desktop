<script lang="ts">
	import { tick } from 'svelte';
	import { ChevronDown, Plus, X } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import type { TabIcon } from './tabChrome';
	import type { WorkspaceEntry } from './workspaces';
	import TabGlyph from './TabGlyph.svelte';
	import TabChromePopover from './TabChromePopover.svelte';

	// The virtual-desktop tab bar at the very top of the canvas: one tab per
	// workspace, a + to create more. Doubles as the window drag strip (the
	// chrome carries data-tauri-drag-region; the interactive bits don't).
	let {
		workspaces,
		activeId,
		shifted = false,
		busy = false,
		onSwitch,
		onNew,
		onRename,
		onChrome,
		onDelete
	}: {
		workspaces: WorkspaceEntry[];
		activeId: string;
		/** Sidebar hidden: pad past the traffic lights / toggle overlay. */
		shifted?: boolean;
		/** A workspace swap is in flight: ignore switch / new / delete clicks. */
		busy?: boolean;
		onSwitch: (id: string) => void;
		onNew: () => void;
		onRename: (id: string, name: string) => void;
		onChrome: (id: string, chrome: { color?: string | null; icon?: TabIcon | null }) => void;
		onDelete: (id: string) => void;
	} = $props();

	let renaming = $state<string | null>(null);
	let renameVal = $state('');
	let renameEl = $state<HTMLInputElement | null>(null);
	let menuFor = $state<{ id: string; x: number; y: number } | null>(null);
	const menuWs = $derived(menuFor ? (workspaces.find((w) => w.id === menuFor!.id) ?? null) : null);

	function startRename(w: WorkspaceEntry) {
		renaming = w.id;
		renameVal = w.name;
		tick().then(() => renameEl?.select());
	}
	function commitRename() {
		if (renaming && renameVal.trim()) onRename(renaming, renameVal);
		renaming = null;
	}
	function renameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renaming = null;
		}
	}

	function openMenu(w: WorkspaceEntry, ev: MouseEvent) {
		ev.preventDefault();
		menuFor = { id: w.id, x: ev.clientX, y: ev.clientY };
	}
	function openMenuAt(w: WorkspaceEntry, el: HTMLElement) {
		const r = el.getBoundingClientRect();
		menuFor = { id: w.id, x: r.left, y: r.bottom + 6 };
	}
</script>

<header class="wsbar" class:shifted data-tauri-drag-region>
	<div class="wstabs" role="tablist" aria-label={t('shell.workspace.label')}>
		{#each workspaces as w (w.id)}
			<div
				class="wstab"
				class:on={w.id === activeId}
				style:--ws-accent={w.color ?? 'var(--accent)'}
				role="tab"
				tabindex="0"
				aria-selected={w.id === activeId}
				title={w.isDefault ? t('shell.workspace.defaultBadge') : w.name}
				onclick={() => !busy && renaming !== w.id && onSwitch(w.id)}
				onkeydown={(e) => e.key === 'Enter' && !busy && onSwitch(w.id)}
				oncontextmenu={(e) => openMenu(w, e)}
			>
				<TabGlyph
					icon={w.icon ?? (w.isDefault ? { kind: 'builtin', id: 'home' } : null)}
					color={w.color}
					active={w.id === activeId}
					size={12}
				/>
				{#if renaming === w.id}
					<!-- svelte-ignore a11y_no_static_element_interactions (keep tab clicks out of the editor) -->
					<input
						class="wsedit"
						bind:this={renameEl}
						bind:value={renameVal}
						onblur={commitRename}
						onkeydown={renameKey}
						onclick={(e) => e.stopPropagation()}
						ondblclick={(e) => e.stopPropagation()}
					/>
				{:else}
					<span class="wsname" ondblclick={(e) => { e.stopPropagation(); startRename(w); }} role="presentation">{w.name}</span>
				{/if}
				<button
					class="wsbtn chev"
					aria-label={t('shell.workspace.menu')}
					title={t('shell.workspace.menu')}
					onclick={(e) => {
						e.stopPropagation();
						openMenuAt(w, e.currentTarget as HTMLElement);
					}}
					ondblclick={(e) => e.stopPropagation()}
				>
					<ChevronDown size={11} />
				</button>
				{#if !w.isDefault}
					<button
						class="wsbtn close"
						aria-label={t('shell.workspace.delete')}
						title={t('shell.workspace.delete')}
						disabled={busy}
						onclick={(e) => {
							e.stopPropagation();
							onDelete(w.id);
						}}
						ondblclick={(e) => e.stopPropagation()}
					>
						<X size={11} />
					</button>
				{/if}
			</div>
		{/each}
		<button class="wsadd" aria-label={t('shell.workspace.new')} title={t('shell.workspace.new')} disabled={busy} onclick={onNew}>
			<Plus size={13} />
		</button>
	</div>
	<div class="wspace" data-tauri-drag-region></div>
</header>

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
	.wsbar {
		display: flex;
		align-items: stretch;
		min-height: 34px;
		padding: 0 10px;
		border-bottom: 1px solid var(--hairline);
		transition: padding-left var(--t-med) var(--ease-out);
	}
	/* Sidebar hidden → the traffic lights + sidebar toggle overlay the bar;
	   shift the tabs clear of them. */
	.wsbar.shifted {
		padding-left: 122px;
	}
	/* Windows/Linux: no traffic lights, so only the toggle overlays the bar. */
	:global(:root[data-os='windows']) .wsbar.shifted,
	:global(:root[data-os='linux']) .wsbar.shifted {
		padding-left: 52px;
	}
	.wstabs {
		display: flex;
		align-items: stretch;
		gap: 2px;
		min-width: 0;
		overflow-x: auto;
	}
	.wstabs::-webkit-scrollbar {
		height: 0;
	}
	.wstab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 9px;
		margin: 4px 0 0;
		border-bottom: 2px solid transparent;
		font-size: 12px;
		font-weight: 600;
		color: var(--dim);
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
		-webkit-user-select: none;
		flex-shrink: 0;
		transition:
			color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
	}
	.wstab:hover {
		color: var(--text);
		background: var(--surface);
	}
	.wstab.on {
		color: var(--text);
		border-bottom-color: var(--ws-accent);
	}
	.wsname {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wsedit {
		width: 110px;
		padding: 2px 6px;
		border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--hairline));
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font-size: 12px;
		font-family: var(--font-sans);
		outline: none;
	}
	.wsbtn {
		display: inline-flex;
		padding: 2px;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--dim2);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
	}
	.wstab:hover .wsbtn,
	.wstab.on .wsbtn {
		opacity: 1;
	}
	.wsbtn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.wsadd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: center;
		padding: 4px;
		margin-left: 2px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim2);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.wsadd:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.wspace {
		flex: 1;
	}
</style>
