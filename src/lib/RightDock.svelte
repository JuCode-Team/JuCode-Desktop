<script lang="ts">
	import { untrack } from 'svelte';
	import { X, Plus, ListTodo, Target, FileDiff, FolderTree, GitBranch, Terminal, Globe, History, Activity } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import GoalPanel from './GoalPanel.svelte';
	import PlanPanel from './PlanPanel.svelte';
	import FilesPanel from './FilesPanel.svelte';
	import GitPanel from './GitPanel.svelte';
	import ChangesPanel from './ChangesPanel.svelte';
	import TurnsPanel from './TurnsPanel.svelte';
	import DiagnosticsPanel from './DiagnosticsPanel.svelte';
	import TerminalPanel from './TerminalPanel.svelte';
	import BrowserPanel from './BrowserPanel.svelte';
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import {
		activateTab,
		deserializeLayout,
		emptyLayout,
		leavesOf,
		openTab,
		serializeLayout,
		singleLeafLayout,
		type TileLayout,
		type TileTab
	} from '$lib/workbench/tiles';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { browser } from '$lib/browser.svelte';
	import type { Goal, PlanStep, TurnDiff, ChatState } from '$lib/chat.svelte';
	import type { WorktreeMeta } from '$lib/types';
	import { t } from '$lib/i18n';

	let {
		goal,
		plan = [],
		cwd = '',
		changed = [],
		turns = [],
		chat = null,
		worktree = null,
		goalsEnabled = true,
		llm = null,
		onRevertFile,
		onOpenFile,
		onOpenTask,
		onTaskRemoved
	}: {
		goal: Goal | null;
		plan?: PlanStep[];
		cwd?: string;
		changed?: string[];
		turns?: TurnDiff[];
		chat?: ChatState | null;
		/** 当前激活项目是并行任务 worktree 时的元数据（透传给 Git 面板）。 */
		worktree?: WorktreeMeta | null;
		/** 一次性文案生成的目标端点（provider/base_url/format/model），透传给 Git 面板。 */
		llm?: { provider: string; baseUrl: string; format: string; model: string } | null;
		/** 当前会话引擎是否支持 goal/plan（不支持时隐藏这两个标签页）。 */
		goalsEnabled?: boolean;
		onRevertFile?: (p: string) => void;
		onOpenFile?: (p: string) => void;
		onOpenTask?: (path: string, meta: WorktreeMeta) => void;
		onTaskRemoved?: (path: string) => void;
	} = $props();

	const ALL_PANELS = [
		{ key: 'plan', icon: ListTodo },
		{ key: 'goal', icon: Target },
		{ key: 'changes', icon: FileDiff },
		{ key: 'turns', icon: History },
		{ key: 'files', icon: FolderTree },
		{ key: 'git', icon: GitBranch },
		{ key: 'term', icon: Terminal },
		{ key: 'browser', icon: Globe },
		{ key: 'diag', icon: Activity }
	];
	// Plan/Goal are engine features. Goal stays gated by the backend cap; the plan
	// tab also appears whenever there's an actual plan (e.g. claude's TodoWrite),
	// even on backends that don't advertise goals.
	const PANELS = $derived(
		ALL_PANELS.filter((p) => {
			if (p.key === 'goal') return goalsEnabled;
			if (p.key === 'plan') return goalsEnabled || plan.length > 0;
			return true;
		})
	);
	const labelOf = (key: string) => (ALL_PANELS.some((p) => p.key === key) ? t(`dock.tabs.${key}`) : key);

	// A tab is an *instance* of a panel, so several tabs can share a panel type
	// (e.g. two terminals); each carries its own id.
	type Tab = { id: string; panel: string };
	let counter = 0;
	const newId = () => `t${Date.now().toString(36)}-${(counter++).toString(36)}`;

	function loadTabs(): Tab[] {
		try {
			const raw = JSON.parse(localStorage.getItem('jucode-dock-tabs') || 'null');
			if (Array.isArray(raw)) {
				const tabs = raw
					.map((t): Tab | null => {
						if (typeof t === 'string') return { id: newId(), panel: t }; // migrate old format
						if (t && typeof t.id === 'string' && typeof t.panel === 'string') return { id: t.id, panel: t.panel };
						return null;
					})
					.filter((t): t is Tab => t !== null && ALL_PANELS.some((p) => p.key === t.panel));
				if (tabs.length) return tabs;
			}
		} catch {
			/* ignore */
		}
		return [{ id: newId(), panel: 'goal' }];
	}

	let openTabs = $state<Tab[]>(loadTabs());
	// Tab instances of hidden panels stay in storage but aren't rendered, so
	// switching back to a goals-capable session restores them untouched.
	const visibleTabs = $derived(openTabs.filter((t) => goalsEnabled || (t.panel !== 'plan' && t.panel !== 'goal')));
	let active = $state(
		(() => {
			const saved = localStorage.getItem('jucode-dock-active');
			return saved && openTabs.some((t) => t.id === saved) ? saved : (openTabs[0]?.id ?? '');
		})()
	);
	let addOpen = $state(false);
	let dragId = $state<string | null>(null);
	let bar = $state<HTMLElement | null>(null);

	// Number repeated panels so duplicates are distinguishable (终端 1 / 终端 2).
	function tabLabel(tab: Tab): string {
		const base = labelOf(tab.panel);
		const same = openTabs.filter((t) => t.panel === tab.panel);
		return same.length < 2 ? base : `${base} ${same.indexOf(tab) + 1}`;
	}

	// If the active tab just got hidden (session switch to a goals-less
	// backend), fall back to the first visible tab.
	$effect(() => {
		if (visibleTabs.length && !visibleTabs.some((t) => t.id === active)) {
			active = visibleTabs[0].id;
		}
	});

	$effect(() => {
		localStorage.setItem('jucode-dock-tabs', JSON.stringify(openTabs));
		localStorage.setItem('jucode-dock-active', active);
	});

	function openPanel(panel: string) {
		// The embedded browser is a singleton native webview — a second tab
		// would fight over it, so re-activate the existing one instead.
		if (panel === 'browser') {
			const existing = openTabs.find((t) => t.panel === 'browser');
			if (existing) {
				active = existing.id;
				addOpen = false;
				return;
			}
		}
		const id = newId();
		openTabs = [...openTabs, { id, panel }];
		active = id;
		addOpen = false;
	}

	// A browser open (agent tool call, typed URL, element pick) reveals the tab.
	$effect(() => {
		if (browser.openSignal === 0) return;
		untrack(() => (prefs.mosaic ? mosaicAdd(null, 'browser') : openPanel('browser')));
	});

	// ---------- mosaic (tiled) mode — behind the `mosaic` feature flag ----------
	// The tile layout is workspace state: it loads from and persists to the
	// active workspace's app-data entry (never localStorage). When a workspace
	// has no tile layout yet, the legacy single-stack dock tabs seed one leaf.
	let tiles = $state<TileLayout>(emptyLayout());
	$effect(() => {
		void workspaces.activeId; // rebuild when the active workspace changes
		tiles = untrack(() => initialTiles());
	});
	function initialTiles(): TileLayout {
		const parsed = deserializeLayout(workspaces.active?.layout ?? null);
		if (parsed?.root) return parsed;
		return singleLeafLayout(
			openTabs.map((t) => ({ id: t.id, panel: t.panel })),
			active
		);
	}
	function setTiles(next: TileLayout) {
		tiles = next;
		workspaces.updateLayout(serializeLayout(next));
	}
	function mosaicAdd(leafId: string | null, panel: string) {
		// Same singleton rule as openPanel: the embedded browser is one native
		// webview, so a second tab would fight over it — refocus instead.
		if (panel === 'browser') {
			const existing = leavesOf(tiles.root)
				.flatMap((l) => l.tabs)
				.find((tab) => tab.panel === 'browser');
			if (existing) {
				setTiles(activateTab(tiles, existing.id));
				return;
			}
		}
		setTiles(openTab(tiles, leafId, { id: newId(), panel }));
	}
	const mosaicLabel = (tab: TileTab) => labelOf(tab.panel);
	function closeTab(id: string) {
		const idx = openTabs.findIndex((t) => t.id === id);
		openTabs = openTabs.filter((t) => t.id !== id);
		if (active === id) active = openTabs[Math.min(idx, openTabs.length - 1)]?.id ?? '';
	}
	function startDrag(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		dragId = id;
		const move = (ev: PointerEvent) => {
			if (!bar) return;
			const tabs = [...bar.querySelectorAll<HTMLElement>('[data-tab]')];
			const over = tabs.find((el) => {
				const r = el.getBoundingClientRect();
				return ev.clientX >= r.left && ev.clientX <= r.right;
			});
			const overId = over?.dataset.tab;
			if (overId && overId !== dragId) {
				const from = openTabs.findIndex((t) => t.id === dragId);
				const to = openTabs.findIndex((t) => t.id === overId);
				const arr = [...openTabs];
				arr.splice(to, 0, arr.splice(from, 1)[0]);
				openTabs = arr;
			}
		};
		const up = () => {
			dragId = null;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

{#snippet panelBody(kind: string)}
	{#if kind === 'plan'}<PlanPanel {plan} />
	{:else if kind === 'goal'}<GoalPanel {goal} />
	{:else if kind === 'changes'}<ChangesPanel {cwd} files={changed} onRevert={onRevertFile} />
	{:else if kind === 'turns'}<TurnsPanel {turns} onOpenFile={onOpenFile} />
	{:else if kind === 'files'}<FilesPanel rootDir={cwd} />
	{:else if kind === 'git'}<GitPanel {cwd} {worktree} {llm} {onOpenTask} {onTaskRemoved} />
	{:else if kind === 'term'}<TerminalPanel {cwd} />
	{:else if kind === 'browser'}<BrowserPanel />
	{:else if kind === 'diag'}<DiagnosticsPanel {chat} />{/if}
{/snippet}

{#if prefs.mosaic}
	<div class="dock">
		<Mosaic
			layout={tiles}
			onchange={setTiles}
			label={mosaicLabel}
			addOptions={PANELS.map((p) => ({ key: p.key, label: labelOf(p.key) }))}
			onAdd={mosaicAdd}
			emptyText={t('dock.dock.empty')}
		>
			{#snippet panel(tab)}
				{@render panelBody(tab.panel)}
			{/snippet}
		</Mosaic>
	</div>
{:else}
<div class="dock">
	<div class="tabbar">
		<div class="tabs" bind:this={bar}>
			{#each visibleTabs as tab (tab.id)}
			<div
				class="tab"
				class:on={tab.id === active}
				class:dragging={tab.id === dragId}
				data-tab={tab.id}
				role="tab"
				tabindex="0"
				aria-selected={tab.id === active}
				onpointerdown={(e) => startDrag(e, tab.id)}
				onclick={() => (active = tab.id)}
				onkeydown={(e) => e.key === 'Enter' && (active = tab.id)}
			>
				<span class="tdot" class:on={tab.id === active}></span>
				<span class="tlabel">{tabLabel(tab)}</span>
				<IconButton
					size="sm"
					label="close tab"
					onpointerdown={(e: PointerEvent) => e.stopPropagation()}
					onclick={(e: MouseEvent) => {
						e.stopPropagation();
						closeTab(tab.id);
					}}><X size={12} /></IconButton>
			</div>
			{/each}
		</div>
		<div class="add">
			<IconButton onclick={() => (addOpen = !addOpen)} label="add panel"><Plus size={15} /></IconButton>
			{#if addOpen}
				<button class="add-backdrop" aria-label="close" onclick={() => (addOpen = false)}></button>
				<div class="add-menu">
					{#each PANELS as p (p.key)}
						<button class="add-item" onclick={() => openPanel(p.key)}>{labelOf(p.key)}</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="content">
		{#each visibleTabs as tab (tab.id)}
			<div class="pane" class:hidden={tab.id !== active}>
				{@render panelBody(tab.panel)}
			</div>
		{/each}
		{#if visibleTabs.length === 0}
			<div class="empty">
				<p>{t('dock.dock.empty')}</p>
				<span>{t('dock.dock.hint')} <b>+</b></span>
					<div class="empty-grid">
						{#each PANELS as p (p.key)}
							<button class="pcardbtn" onclick={() => openPanel(p.key)}>
								<p.icon size={18} />
								<span>{labelOf(p.key)}</span>
							</button>
						{/each}
					</div>
			</div>
		{/if}
	</div>
</div>
{/if}

<style>
	.dock {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--panel);
	}
	.tabbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 8px 7px;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.tabs {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}
	.tabs::-webkit-scrollbar {
		height: 0;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 6px 5px 10px;
		border-radius: var(--r-sm);
		font-size: 12px;
		color: var(--dim);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.tab:hover {
		background: var(--surface);
		color: var(--text);
	}
	.tab.on {
		background: var(--surface2);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	/* keep the tab's close button quiet until the tab is hovered or active */
	.tab :global(.ib) {
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.tab:hover :global(.ib),
	.tab.on :global(.ib) {
		opacity: 1;
	}
	.tab.dragging {
		opacity: 0.6;
	}
	.tdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.tdot.on {
		background: var(--accent-bright);
	}
	.tlabel {
		font-weight: 600;
	}
	.add {
		position: relative;
		flex-shrink: 0;
	}
	.add-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.add-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 81;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 5px;
		min-width: 120px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.add-item {
		text-align: left;
		padding: 7px 10px;
		border: none;
		background: none;
		border-radius: var(--r-sm);
		color: var(--text);
		font-size: 13px;
		cursor: pointer;
	}
	.add-item:hover {
		background: var(--surface2);
	}
	.content {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	.pane {
		position: absolute;
		inset: 0;
	}
	.pane.hidden {
		display: none;
	}
	.empty {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		color: var(--dim2);
	}
	.empty p {
		margin: 0;
		font-size: 14px;
		color: var(--dim);
	}
	.empty span {
		font-size: 12px;
	}
	.empty b {
		color: var(--accent-bright);
	}
	.empty {
		padding: 24px 18px;
	}
	.empty-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		width: 100%;
		max-width: 260px;
		margin-top: 14px;
	}
	.pcardbtn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 15px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--dim);
		font-size: 12.5px;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
	}
	.pcardbtn:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
		color: var(--text);
		background: var(--surface2);
	}
</style>
