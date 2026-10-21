<script lang="ts">
	import { overBrowser } from '$lib/browser.svelte';
	import type { Snippet } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { t } from '$lib/i18n';
	import {
		activateTab,
		closeTab,
		insertTab,
		leavesOf,
		moveTab,
		resizeSplit,
		type DropZone,
		type LeafNode,
		type SplitNode,
		type TileLayout,
		type TileNode,
		type TileTab
	} from './tiles';
	import type { TabIcon } from './tabChrome';
	import TabGlyph from './TabGlyph.svelte';

	// Renders a TileLayout: recursive splits with draggable gutters, per-leaf
	// tab stacks, pointer-drag of tabs between leaves (edge drop = split, with
	// a translucent landing preview). All
	// state transforms come from tiles.ts; this component only reports the next
	// layout through `onchange` (and pointer focus through `onFocus`).
	let {
		layout,
		onchange,
		panel,
		label,
		addOptions = [],
		onAdd,
		barAdd = true,
		emptyText = '',
		emptyHint = '',
		focused = null,
		onFocus,
		decorate,
		tabMark,
		actions,
		onTabContext,
		onTabRename
	}: {
		layout: TileLayout;
		onchange: (next: TileLayout) => void;
		/** One tab's content. Every tab stays mounted; inactive ones are hidden
		 *  (so e.g. terminals survive tab switches). */
		panel: Snippet<[TileTab]>;
		label: (tab: TileTab) => string;
		/** Panel kinds offered by each leaf's + menu. On the empty canvas a
		 *  `primary` option leads as the main action; the rest form a grid. */
		addOptions?: { key: string; label: string; icon?: typeof PlusIcon; primary?: boolean }[];
		onAdd?: (leafId: string | null, key: string) => void;
		/** The + on each tab bar; off where the window title bar has one. */
		barAdd?: boolean;
		emptyText?: string;
		emptyHint?: string;
		/** The focused leaf (owned by the caller; drives engine-action targeting). */
		focused?: string | null;
		/** Pointer went down inside a leaf — report it as the focused one. */
		onFocus?: (leafId: string) => void;
		/** Per-tab chrome (session tag color / icon); null keeps the plain dot. */
		decorate?: (tab: TileTab) => { color?: string; icon?: TabIcon } | null;
		/** Trailing mark after a tab's label (a chat's status). */
		tabMark?: Snippet<[TileTab]>;
		/** Optional controls for the active tab, rendered at the right of its bar. */
		actions?: Snippet<[TileTab]>;
		/** Right-click on a tab (the caller decides whether to open a menu). */
		onTabContext?: (tab: TileTab, ev: MouseEvent) => void;
		/** Double-click on a tab (rename affordance). */
		onTabRename?: (tab: TileTab, ev: MouseEvent) => void;
	} = $props();

	let rootEl = $state<HTMLElement | null>(null);
	/** A tab being dragged: `dx` is how far the pointer has moved along its
	 *  own bar, `width` the room the other tabs make for it, `from` its index. */
	let drag = $state<{
		tabId: string;
		label: string;
		x: number;
		y: number;
		dx: number;
		live: boolean;
		fromLeaf: string;
		from: number;
		width: number;
	} | null>(null);
	/** Where a dragged tab would land: a zone of a pane (stack / split), or a
	 *  place in a tab bar (`index` among the bar's other tabs). */
	type Landing = { leafId: string; zone: DropZone } | { leafId: string; index: number };
	let hover = $state<Landing | null>(null);
	const zoneOf = (h: Landing | null) => (h && 'zone' in h ? h : null);
	const slotOf = (h: Landing | null) => (h && 'index' in h ? h : null);
	let addMenuFor = $state<string | null>(null);
	// Measured so the floating drag ghost can be clamped inside the viewport.
	let ghostW = $state(0);
	let ghostH = $state(0);

	const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

	// Esc: cancel an in-flight drag, else close the add menu. A pane that
	// already claimed Escape (e.g. a chat pane closing its picker) wins.
	function windowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		if (drag?.live) {
			drag = null;
			hover = null;
		} else if (addMenuFor) {
			addMenuFor = null;
		}
	}

	/** Which leaf (and which drop zone inside it) the pointer is over. */
	function zoneAt(x: number, y: number): { leafId: string; zone: DropZone } | null {
		if (!rootEl) return null;
		for (const el of rootEl.querySelectorAll<HTMLElement>('[data-leaf]')) {
			const r = el.getBoundingClientRect();
			if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
			const rx = (x - r.left) / Math.max(1, r.width);
			const ry = (y - r.top) / Math.max(1, r.height);
			const edges: [number, DropZone][] = [
				[rx, 'left'],
				[1 - rx, 'right'],
				[ry, 'top'],
				[1 - ry, 'bottom']
			];
			edges.sort((a, b) => a[0] - b[0]);
			return { leafId: el.dataset.leaf!, zone: edges[0][0] < 0.22 ? edges[0][1] : 'center' };
		}
		return null;
	}

	/** The tab-bar slot under the pointer: the bar the tab came from keeps it
	 *  until the pointer is well clear of it (DRAG_OUT below), so a reorder
	 *  never turns into a split by accident. `bars`: the bars and the centres
	 *  of their other tabs as they were when the drag began (the tabs move
	 *  aside while it goes on). */
	const DRAG_OUT = 28;
	type Bar = { leafId: string; rect: DOMRect; centres: number[] };
	function measureBars(tabId: string): Bar[] {
		if (!rootEl) return [];
		return [...rootEl.querySelectorAll<HTMLElement>('[data-bar]')].map((bar) => ({
			leafId: bar.dataset.bar!,
			rect: bar.getBoundingClientRect(),
			centres: [...bar.querySelectorAll<HTMLElement>('[data-tab]')]
				.filter((el) => el.dataset.tab !== tabId)
				.map((el) => {
					const r = el.getBoundingClientRect();
					return r.left + r.width / 2;
				})
		}));
	}
	function slotAt(bars: Bar[], x: number, y: number, fromLeaf: string): Landing | null {
		for (const { leafId, rect: r, centres } of bars) {
			const slack = leafId === fromLeaf ? DRAG_OUT : 4;
			if (x < r.left || x > r.right || y < r.top - slack || y > r.bottom + slack) continue;
			return { leafId, index: centres.filter((c) => c < x).length };
		}
		return null;
	}

	/** How far tab `j` of `leaf` moves while a tab is dragged along a bar: the
	 *  dragged one follows the pointer, the others make room where it would land. */
	function shiftOf(leaf: LeafNode, j: number): number {
		const slot = slotOf(hover);
		if (!drag?.live || !slot || slot.leafId !== leaf.id) return 0;
		const own = leaf.id === drag.fromLeaf;
		if (own && j === drag.from) return drag.dx;
		const k = own && j > drag.from ? j - 1 : j;
		if (!own) return k >= slot.index ? drag.width : 0;
		if (k >= drag.from && k < slot.index) return -drag.width;
		if (k >= slot.index && k < drag.from) return drag.width;
		return 0;
	}

	// A press is a click (activate) until the pointer travels 8px; then it is
	// a drag. Along a tab bar it reorders: the tab follows the pointer and the
	// others slide aside; pulled out of the bar, it moves to another pane or
	// splits one, with a floating label and a landing preview under the cursor.
	function tabPointerDown(e: PointerEvent, tab: TileTab) {
		if (e.button !== 0) return;
		// Stop the browser from starting a text selection under the drag
		// (user-select:none alone doesn't cover text outside the mosaic).
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const el = e.currentTarget as HTMLElement;
		const fromLeaf = el.closest<HTMLElement>('[data-bar]')?.dataset.bar ?? '';
		const from = leavesOf(layout.root).find((l) => l.id === fromLeaf)?.tabs.findIndex((x) => x.id === tab.id) ?? -1;
		// The bar's gap between tabs (.ltabs) is part of the room a tab takes.
		const width = el.getBoundingClientRect().width + 2;
		let bars: Bar[] = [];
		drag = { tabId: tab.id, label: label(tab), x: startX, y: startY, dx: 0, live: false, fromLeaf, from, width };
		const preventSelect = (ev: Event) => {
			if (drag) ev.preventDefault();
		};
		const move = (ev: PointerEvent) => {
			if (!drag) return;
			if (!drag.live && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
			if (!drag.live) bars = measureBars(drag.tabId);
			drag.live = true;
			drag.x = ev.clientX;
			drag.y = ev.clientY;
			drag.dx = ev.clientX - startX;
			hover = slotAt(bars, ev.clientX, ev.clientY, fromLeaf) ?? zoneAt(ev.clientX, ev.clientY);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('selectstart', preventSelect);
			const d = drag;
			const h = hover;
			drag = null;
			hover = null;
			if (!d) return;
			if (!d.live) onchange(activateTab(layout, d.tabId));
			else if (h && 'index' in h) onchange(insertTab(layout, d.tabId, h.leafId, h.index));
			else if (h) onchange(moveTab(layout, d.tabId, h.leafId, h.zone));
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('selectstart', preventSelect);
	}

	function gutterDown(e: PointerEvent, split: SplitNode) {
		e.preventDefault();
		const container = (e.currentTarget as HTMLElement).parentElement;
		if (!container) return;
		const r = container.getBoundingClientRect();
		const move = (ev: PointerEvent) => {
			const ratio =
				split.dir === 'row'
					? (ev.clientX - r.left) / Math.max(1, r.width)
					: (ev.clientY - r.top) / Math.max(1, r.height);
			onchange(resizeSplit(layout, split.id, ratio));
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	import PopMenu from '$lib/ui/PopMenu.svelte';
	import { rowIn, tabOut } from '$lib/ui/motion';
</script>

<svelte:window onkeydown={windowKeydown} />

<div class="mosaic" class:dragging={drag?.live} bind:this={rootEl}>
	{#if layout.root}
		{@render node(layout.root)}
	{:else}
		<div class="mo-empty">
			{#if emptyText || emptyHint}
				<div class="mo-empty-head">
					{#if emptyText}<p class="mo-empty-title">{emptyText}</p>{/if}
					{#if emptyHint}<p class="mo-empty-hint">{emptyHint}</p>{/if}
				</div>
			{/if}
			{#each addOptions.filter((o) => o.primary) as o (o.key)}
				<button class="mo-empty-primary" onclick={() => onAdd?.(null, o.key)}>
					{#if o.icon}<o.icon size={16} />{/if}{o.label}
				</button>
			{/each}
			<div class="mo-empty-opts">
				{#each addOptions.filter((o) => !o.primary) as o (o.key)}
					<button class="mo-empty-btn" onclick={() => onAdd?.(null, o.key)}>
						{#if o.icon}<o.icon size={16} />{/if}<span>{o.label}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
	{#if drag?.live && slotOf(hover)?.leafId !== drag.fromLeaf}
		<div
			class="ghost"
			bind:clientWidth={ghostW}
			bind:clientHeight={ghostH}
			style:left="{clamp(drag.x + 12, 4, window.innerWidth - ghostW - 4)}px"
			style:top="{clamp(drag.y + 10, 4, window.innerHeight - ghostH - 4)}px"
		>
			{drag.label}
		</div>
	{/if}
</div>

{#snippet node(n: TileNode)}
	{#if n.kind === 'split'}
		<div class="split {n.dir}">
			<div class="cell" style:flex="{n.ratio} 1 0">{@render node(n.a)}</div>
			<div
				class="gutter {n.dir}"
				role="separator"
				aria-label="resize"
				aria-orientation={n.dir === 'row' ? 'vertical' : 'horizontal'}
				onpointerdown={(e) => gutterDown(e, n)}
			></div>
			<div class="cell" style:flex="{1 - n.ratio} 1 0">{@render node(n.b)}</div>
		</div>
	{:else}
		{@render leafView(n)}
	{/if}
{/snippet}

{#snippet leafView(leaf: LeafNode)}
	{@const activeTab = leaf.tabs.find((tab) => tab.id === leaf.active)}
	<!-- svelte-ignore a11y_no_static_element_interactions (pointer focus tracking only) -->
	<section
		class="leaf"
		class:focus={focused === leaf.id}
		class:droptarget={drag?.live && zoneOf(hover)?.leafId === leaf.id}
		data-leaf={leaf.id}
		onpointerdowncapture={() => onFocus?.(leaf.id)}
	>
		<div class="lbar" data-tauri-drag-region data-bar={leaf.id} role="tablist" tabindex="-1">
			<div class="ltabs">
				{#each leaf.tabs as tab, j (tab.id)}
					{@const chrome = decorate?.(tab) ?? null}
					{@const dragged = drag?.live && drag.tabId === tab.id}
					{@const shift = shiftOf(leaf, j)}
					<div
						class="ltab"
						in:rowIn
						out:tabOut
						class:on={leaf.active === tab.id}
						class:lifted={dragged && slotOf(hover)?.leafId !== leaf.id}
						class:held={dragged && slotOf(hover)?.leafId === leaf.id}
						style:transform={shift ? `translateX(${shift}px)` : undefined}
						data-tab={tab.id}
						role="tab"
						tabindex="0"
						aria-selected={leaf.active === tab.id}
						onpointerdown={(e) => tabPointerDown(e, tab)}
						ondblclick={(e) => onTabRename?.(tab, e)}
						oncontextmenu={(e) => onTabContext?.(tab, e)}
						onkeydown={(e) => e.key === 'Enter' && onchange(activateTab(layout, tab.id))}
					>
						{#if chrome && (chrome.icon || chrome.color)}
							<TabGlyph icon={chrome.icon} color={chrome.color} active={leaf.active === tab.id} size={12} />
						{/if}
						<span class="llabel" style:color={chrome?.color && leaf.active === tab.id ? chrome.color : undefined}>{label(tab)}</span>
						{#if tabMark}{@render tabMark(tab)}{/if}
						<button
							class="lclose"
							aria-label="close tab"
							onpointerdown={(e) => e.stopPropagation()}
							ondblclick={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								onchange(closeTab(layout, tab.id));
							}}><XIcon size={12} /></button
						>
					</div>
				{/each}
			</div>
			<div class="lactions">
				{#if actions && activeTab}{@render actions(activeTab)}{/if}
				{#if barAdd && addOptions.length}
					<button
						class="lbtn"
						aria-label="add panel"
						onclick={() => (addMenuFor = addMenuFor === leaf.id ? null : leaf.id)}><PlusIcon size={14} /></button
					>
				{/if}
			</div>
			{#if addMenuFor === leaf.id}
				<PopMenu
					items={addOptions.map((o) => ({ key: o.key, label: o.label, icon: o.icon }))}
					onSelect={(key) => {
						addMenuFor = null;
						onAdd?.(leaf.id, key);
					}}
					onClose={() => (addMenuFor = null)}
				/>
			{/if}
		</div>
		<div class="lbody">
			{#each leaf.tabs as tab (tab.id)}
				<div class="lpane" class:hidden={leaf.active !== tab.id}>{@render panel(tab)}</div>
			{/each}
		</div>
		{#if drag?.live && zoneOf(hover)?.leafId === leaf.id}
			{@const z = zoneOf(hover)!}
			<div use:overBrowser class="dropzone {z.zone}">
				<span class="dropzone-label">
					{z.zone === 'center' ? t('dock.mosaic.stackHere') : t('dock.mosaic.splitHere')}
				</span>
			</div>
		{/if}
	</section>
{/snippet}

<style>
	.mosaic {
		position: relative;
		height: 100%;
		display: flex;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
	}
	.mosaic.dragging {
		cursor: grabbing;
		user-select: none;
	}
	.split {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.split.row {
		flex-direction: row;
	}
	.split.col {
		flex-direction: column;
	}
	.cell {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	/* Splitter: a 2px visible line, but the ::before pseudo-element widens the
	   pointer target to ~10px on the drag axis without shifting layout. */
	.gutter {
		position: relative;
		z-index: 3;
		flex-shrink: 0;
		background: var(--hairline);
		transition: background var(--t-fast) var(--ease-out);
	}
	.gutter::before {
		content: '';
		position: absolute;
	}
	.gutter.row {
		width: 2px;
		cursor: col-resize;
	}
	.gutter.row::before {
		inset: 0 -4px;
	}
	.gutter.col {
		height: 2px;
		cursor: row-resize;
	}
	.gutter.col::before {
		inset: -4px 0;
	}
	.gutter:hover,
	.gutter:active {
		background: color-mix(in oklab, var(--accent) 55%, var(--hairline));
	}
	.leaf {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--bg);
	}
	/* The pane a dragged tab would land in: a border on the pane itself. */
	.leaf.droptarget {
		box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--accent) 65%, transparent);
	}
	/* Focused leaf: the tab bar's hairline warms up — engine actions (model,
	   approvals, palette commands) target this pane's chat session. */
	.lbar {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
		user-select: none;
	}
	.ltabs {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}
	.ltabs::-webkit-scrollbar {
		height: 0;
	}
	/* Block tabs: a fill marks the open one, the rest are dim text on the bar
	   until hovered. */
	.ltab {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 30px;
		max-width: 240px;
		padding: 0 6px 0 12px;
		border-radius: var(--r);
		font-size: var(--fs-sm);
		color: var(--dim);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		flex-shrink: 0;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.ltab:hover {
		color: var(--text);
	}
	.ltab.on {
		background: var(--surface2);
		color: var(--text);
	}
	/* While a tab is dragged along its bar the others slide aside; it rides
	   above them under the pointer. */
	.mosaic.dragging .ltab {
		transition:
			transform 150ms var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.mosaic.dragging .ltab.held {
		position: relative;
		z-index: 2;
		background: var(--panel);
		box-shadow: var(--shadow-sm);
		transition: none;
	}
	.ltab.lifted {
		opacity: 0.45;
	}
	.llabel {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lclose {
		display: inline-flex;
		padding: 3px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: var(--r);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.ltab:hover .lclose,
	.ltab.on .lclose {
		opacity: 1;
	}
	.lclose:hover {
		color: var(--text);
		/* the open tab is already --surface2 */
		background: color-mix(in oklab, var(--text) 10%, transparent);
	}
	.lactions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}
	.lbtn {
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: var(--r);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.lbtn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.lbody {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.lpane {
		position: absolute;
		inset: 0;
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.lpane.hidden {
		display: none;
	}
	/* Landing preview while dragging a tab over this leaf: a thin border and
	   a faint fill outlining the exact area, plus a label saying what a drop
	   does (stack into the tab group vs split the pane). */
	.dropzone {
		position: absolute;
		z-index: 5;
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in oklab, var(--accent) 6%, transparent);
		border: 1px solid color-mix(in oklab, var(--accent) 60%, transparent);
		border-radius: var(--r);
	}
	.dropzone-label {
		padding: 3px 9px;
		font-size: var(--fs-xs);
		font-weight: 600;
		white-space: nowrap;
		color: var(--text);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
	}
	.dropzone.center {
		inset: 0;
	}
	.dropzone.left {
		inset: 0 50% 0 0;
	}
	.dropzone.right {
		inset: 0 0 0 50%;
	}
	.dropzone.top {
		inset: 0 0 50% 0;
	}
	.dropzone.bottom {
		inset: 50% 0 0 0;
	}
	.ghost {
		position: fixed;
		z-index: 90;
		pointer-events: none;
		padding: 4px 10px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--text);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
	}
	.mo-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 24px;
	}
	.mo-empty > * {
		width: min(360px, 100%);
	}
	.mo-empty-head {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 6px;
		text-align: center;
	}
	.mo-empty-head p {
		margin: 0;
	}
	.mo-empty-title {
		font-size: var(--fs-md);
		color: var(--text);
	}
	.mo-empty-hint {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.mo-empty-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 40px;
		font-size: var(--fs-sm);
		border: none;
		border-radius: var(--r);
		background: var(--accent);
		color: var(--on-accent);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.mo-empty-primary:hover {
		background: var(--accent-bright);
	}
	.mo-empty-opts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}
	.mo-empty-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		height: 36px;
		padding: 0 12px;
		font-size: var(--fs-xs);
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
		color: var(--dim);
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.mo-empty-btn span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mo-empty-btn :global(svg) {
		flex-shrink: 0;
		color: var(--dim2);
		transition: color var(--t-fast) var(--ease-out);
	}
	.mo-empty-btn:hover {
		color: var(--text);
		background: var(--surface2);
		border-color: var(--border-strong);
	}
	.mo-empty-btn:hover :global(svg) {
		color: var(--text);
	}
</style>
