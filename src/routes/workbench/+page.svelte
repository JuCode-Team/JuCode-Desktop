<script lang="ts">
	// Dev demo for the mosaic tile workbench. Runs without a Tauri backend so
	// the layout mechanics (drag to split, resize, stack, dblclick-maximize)
	// can be exercised and reviewed in a plain browser. Not linked from the
	// app UI — visit /workbench directly.
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import {
		emptyLayout,
		leavesOf,
		openTab,
		singleLeafLayout,
		splitLeaf,
		type TileLayout,
		type TileTab
	} from '$lib/workbench/tiles';

	const KINDS: Record<string, { label: string; body: string }> = {
		notes: {
			label: 'Notes',
			body: 'Drag this tab by its label. Drop it on the middle of another panel to stack it there, or near an edge to split that panel.'
		},
		diff: {
			label: 'Diff',
			body: 'Panels keep their content when you rearrange them — nothing re-mounts, so a terminal or an editor would survive the move.'
		},
		terminal: {
			label: 'Terminal',
			body: 'Double-click a tab bar to maximize this panel; double-click again to put it back. Drag the divider between panels to resize.'
		},
		log: {
			label: 'Log',
			body: 'Close the last tab of a panel and the neighbor takes over the space. The whole arrangement serializes to JSON with a version.'
		}
	};

	let seq = 0;
	function demoLayout(): TileLayout {
		seq = 0;
		const base = singleLeafLayout([
			{ id: `d${seq++}`, panel: 'notes' },
			{ id: `d${seq++}`, panel: 'log' }
		]);
		const first = leavesOf(base.root)[0];
		const { layout: withDiff, leafId } = splitLeaf(base, first.id, 'right', { id: `d${seq++}`, panel: 'diff' });
		return splitLeaf(withDiff, leafId, 'bottom', { id: `d${seq++}`, panel: 'terminal' }).layout;
	}

	let layout = $state<TileLayout>(demoLayout());
	const addOptions = Object.entries(KINDS).map(([key, v]) => ({ key, label: v.label }));
</script>

<svelte:head><title>Workbench demo</title></svelte:head>

<div class="page">
	<header>
		<div>
			<h1>Mosaic workbench</h1>
			<p>
				A hand-rolled binary tile tree. Drag tabs between panels (edges split, center stacks),
				drag the dividers to resize, double-click a tab bar to maximize.
			</p>
		</div>
		<div class="actions">
			<button onclick={() => (layout = demoLayout())}>Reset layout</button>
			<button onclick={() => (layout = emptyLayout())}>Clear</button>
		</div>
	</header>

	<div class="stage">
		<Mosaic
			{layout}
			onchange={(l) => (layout = l)}
			label={(tab: TileTab) => KINDS[tab.panel]?.label ?? tab.panel}
			{addOptions}
			onAdd={(leafId, key) => (layout = openTab(layout, leafId, { id: `d${seq++}`, panel: key }))}
			emptyText="Nothing open. Add a panel to start."
		>
			{#snippet panel(tab)}
				<div class="demo-pane">
					<p>{KINDS[tab.panel]?.body ?? tab.panel}</p>
					<code>tab id: {tab.id}</code>
				</div>
			{/snippet}
		</Mosaic>
	</div>
</div>

<style>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 22px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	h1 {
		margin: 0 0 4px;
		font-family: var(--font-display);
		font-size: 17px;
	}
	header p {
		margin: 0;
		font-size: 12.5px;
		color: var(--dim);
		max-width: 560px;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}
	.actions button {
		padding: 6px 12px;
		font-size: 12.5px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.actions button:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.stage {
		flex: 1;
		min-height: 0;
		padding: 12px;
	}
	.demo-pane {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		overflow-y: auto;
	}
	.demo-pane p {
		margin: 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--dim);
		max-width: 420px;
	}
	.demo-pane code {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
	}
</style>
