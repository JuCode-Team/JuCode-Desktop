<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X, Plus, Maximize2, Minimize2 } from 'lucide-svelte';
	import {
		activateTab,
		closeTab,
		moveTab,
		resizeSplit,
		toggleMaximize,
		type DropZone,
		type LeafNode,
		type SplitNode,
		type TileLayout,
		type TileNode,
		type TileTab
	} from './tiles';

	// Renders a TileLayout: recursive splits with draggable gutters, per-leaf
	// tab stacks, pointer-drag of tabs between leaves (edge drop = split, with
	// a translucent landing preview), dblclick on a tab bar to maximize. All
	// state transforms come from tiles.ts; this component only reports the next
	// layout through `onchange`.
	let {
		layout,
		onchange,
		panel,
		label,
		addOptions = [],
		onAdd,
		emptyText = ''
	}: {
		layout: TileLayout;
		onchange: (next: TileLayout) => void;
		/** One tab's content. Every tab stays mounted; inactive ones are hidden
		 *  (so e.g. terminals survive tab switches). */
		panel: Snippet<[TileTab]>;
		label: (tab: TileTab) => string;
		/** Panel kinds offered by each leaf's + menu. */
		addOptions?: { key: string; label: string }[];
		onAdd?: (leafId: string | null, key: string) => void;
		emptyText?: string;
	} = $props();

	let rootEl = $state<HTMLElement | null>(null);
	let drag = $state<{ tabId: string; label: string; x: number; y: number; live: boolean } | null>(null);
	let hover = $state<{ leafId: string; zone: DropZone } | null>(null);
	let addMenuFor = $state<string | null>(null);

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

	// A press is a click (activate) until the pointer travels; then it becomes
	// a drag with a floating label and a landing preview under the cursor.
	function tabPointerDown(e: PointerEvent, tab: TileTab) {
		if (e.button !== 0) return;
		const startX = e.clientX;
		const startY = e.clientY;
		drag = { tabId: tab.id, label: label(tab), x: startX, y: startY, live: false };
		const move = (ev: PointerEvent) => {
			if (!drag) return;
			if (!drag.live && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
			drag.live = true;
			drag.x = ev.clientX;
			drag.y = ev.clientY;
			hover = zoneAt(ev.clientX, ev.clientY);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			const d = drag;
			const h = hover;
			drag = null;
			hover = null;
			if (!d) return;
			if (!d.live) onchange(activateTab(layout, d.tabId));
			else if (h) onchange(moveTab(layout, d.tabId, h.leafId, h.zone));
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
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

	// Dblclick on the bar (not its buttons) toggles maximize for the leaf.
	function barDblClick(e: MouseEvent, leaf: LeafNode) {
		if ((e.target as HTMLElement).closest('button')) return;
		onchange(toggleMaximize(layout, leaf.id));
	}
</script>

<div class="mosaic" class:dragging={drag?.live} bind:this={rootEl}>
	{#if layout.root}
		{@render node(layout.root)}
	{:else}
		<div class="mo-empty">
			{#if emptyText}<p>{emptyText}</p>{/if}
			<div class="mo-empty-opts">
				{#each addOptions as o (o.key)}
					<button class="mo-empty-btn" onclick={() => onAdd?.(null, o.key)}>{o.label}</button>
				{/each}
			</div>
		</div>
	{/if}
	{#if drag?.live}
		<div class="ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 10}px">{drag.label}</div>
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
	<section class="leaf" class:maxed={layout.maximized === leaf.id} data-leaf={leaf.id}>
		<div class="lbar" ondblclick={(e) => barDblClick(e, leaf)} role="tablist" tabindex="-1">
			<div class="ltabs">
				{#each leaf.tabs as tab (tab.id)}
					<div
						class="ltab"
						class:on={leaf.active === tab.id}
						class:lifted={drag?.live && drag.tabId === tab.id}
						role="tab"
						tabindex="0"
						aria-selected={leaf.active === tab.id}
						onpointerdown={(e) => tabPointerDown(e, tab)}
						onkeydown={(e) => e.key === 'Enter' && onchange(activateTab(layout, tab.id))}
					>
						<span class="ldot" class:on={leaf.active === tab.id}></span>
						<span class="llabel">{label(tab)}</span>
						<button
							class="lclose"
							aria-label="close tab"
							onpointerdown={(e) => e.stopPropagation()}
							ondblclick={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								onchange(closeTab(layout, tab.id));
							}}><X size={11} /></button
						>
					</div>
				{/each}
			</div>
			<div class="lactions">
				{#if addOptions.length}
					<button
						class="lbtn"
						aria-label="add panel"
						onclick={() => (addMenuFor = addMenuFor === leaf.id ? null : leaf.id)}><Plus size={13} /></button
					>
				{/if}
				<button
					class="lbtn"
					aria-label={layout.maximized === leaf.id ? 'restore' : 'maximize'}
					onclick={() => onchange(toggleMaximize(layout, leaf.id))}
				>
					{#if layout.maximized === leaf.id}<Minimize2 size={12} />{:else}<Maximize2 size={12} />{/if}
				</button>
			</div>
			{#if addMenuFor === leaf.id}
				<button class="lmenu-backdrop" aria-label="close menu" onclick={() => (addMenuFor = null)}></button>
				<div class="lmenu">
					{#each addOptions as o (o.key)}
						<button
							class="lmenu-item"
							onclick={() => {
								addMenuFor = null;
								onAdd?.(leaf.id, o.key);
							}}>{o.label}</button
						>
					{/each}
				</div>
			{/if}
		</div>
		<div class="lbody">
			{#each leaf.tabs as tab (tab.id)}
				<div class="lpane" class:hidden={leaf.active !== tab.id}>{@render panel(tab)}</div>
			{/each}
		</div>
		{#if drag?.live && hover?.leafId === leaf.id}
			<div class="dropzone {hover.zone}"></div>
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
	/* Cells must not clip: a maximized leaf positions itself against .mosaic
	   and any overflow:hidden ancestor would cut it off. */
	.cell {
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.gutter {
		flex-shrink: 0;
		background: var(--hairline);
		transition: background var(--t-fast) var(--ease-out);
	}
	.gutter.row {
		width: 4px;
		cursor: col-resize;
	}
	.gutter.col {
		height: 4px;
		cursor: row-resize;
	}
	.gutter:hover {
		background: var(--accent-soft);
	}
	.leaf {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--panel);
	}
	/* Maximize = reposition over the whole mosaic; nothing re-mounts. */
	.leaf.maxed {
		position: absolute;
		inset: 0;
		z-index: 6;
	}
	.lbar {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 6px 5px;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.ltabs {
		display: flex;
		align-items: center;
		gap: 3px;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}
	.ltabs::-webkit-scrollbar {
		height: 0;
	}
	.ltab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 5px 4px 9px;
		border-radius: var(--r-sm);
		font-size: 12px;
		color: var(--dim);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.ltab:hover {
		background: var(--surface);
		color: var(--text);
	}
	.ltab.on {
		background: var(--surface2);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.ltab.lifted {
		opacity: 0.45;
	}
	.ldot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.ldot.on {
		background: var(--accent-bright);
	}
	.llabel {
		font-weight: 600;
	}
	.lclose {
		display: inline-flex;
		padding: 2px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: 4px;
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
		background: var(--surface2);
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
		border-radius: var(--r-sm);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.lbtn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.lmenu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.lmenu {
		position: absolute;
		top: calc(100% + 4px);
		right: 6px;
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
	}
	.lmenu-item {
		text-align: left;
		padding: 6px 10px;
		border: none;
		background: none;
		border-radius: var(--r-sm);
		color: var(--text);
		font-size: 12.5px;
		cursor: pointer;
	}
	.lmenu-item:hover {
		background: var(--surface2);
	}
	.lbody {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.lpane {
		position: absolute;
		inset: 0;
	}
	.lpane.hidden {
		display: none;
	}
	/* Landing preview while dragging a tab over this leaf. */
	.dropzone {
		position: absolute;
		z-index: 5;
		pointer-events: none;
		background: color-mix(in oklab, var(--accent) 13%, transparent);
		border: 1px solid color-mix(in oklab, var(--accent) 45%, transparent);
		border-radius: var(--r-sm);
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
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		box-shadow: var(--shadow-pop);
	}
	.mo-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--dim2);
		padding: 24px;
		text-align: center;
	}
	.mo-empty p {
		margin: 0;
		font-size: 13px;
		color: var(--dim);
	}
	.mo-empty-opts {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		max-width: 280px;
	}
	.mo-empty-btn {
		padding: 5px 11px;
		font-size: 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--dim);
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.mo-empty-btn:hover {
		color: var(--text);
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
</style>
