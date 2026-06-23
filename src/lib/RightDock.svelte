<script lang="ts">
	import { X, Plus } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import GoalPanel from './GoalPanel.svelte';
	import PlanPanel from './PlanPanel.svelte';
	import FilesPanel from './FilesPanel.svelte';
	import GitPanel from './GitPanel.svelte';
	import ChangesPanel from './ChangesPanel.svelte';
	import TerminalPanel from './TerminalPanel.svelte';
	import type { Goal, PlanStep } from '$lib/chat.svelte';

	let {
		goal,
		plan = [],
		cwd = '',
		changed = [],
		onRevertFile
	}: { goal: Goal | null; plan?: PlanStep[]; cwd?: string; changed?: string[]; onRevertFile?: (p: string) => void } = $props();

	const PANELS = [
		{ key: 'plan', label: '计划' },
		{ key: 'goal', label: '目标' },
		{ key: 'changes', label: '改动' },
		{ key: 'files', label: '文件' },
		{ key: 'git', label: 'Git' },
		{ key: 'term', label: '终端' }
	];
	const labelOf = (key: string) => PANELS.find((p) => p.key === key)?.label ?? key;

	function loadTabs(): string[] {
		try {
			const t = JSON.parse(localStorage.getItem('jucode-dock-tabs') || 'null');
			if (Array.isArray(t)) return t.filter((k) => PANELS.some((p) => p.key === k));
		} catch {
			/* ignore */
		}
		return ['goal'];
	}

	let openTabs = $state<string[]>(loadTabs());
	let active = $state(
		(() => {
			const saved = localStorage.getItem('jucode-dock-active');
			return saved && openTabs.includes(saved) ? saved : (openTabs[0] ?? '');
		})()
	);
	let addOpen = $state(false);
	let dragKey = $state<string | null>(null);
	let bar = $state<HTMLElement | null>(null);

	const available = $derived(PANELS.filter((p) => !openTabs.includes(p.key)));

	$effect(() => {
		localStorage.setItem('jucode-dock-tabs', JSON.stringify(openTabs));
		localStorage.setItem('jucode-dock-active', active);
	});

	function openPanel(key: string) {
		if (!openTabs.includes(key)) openTabs = [...openTabs, key];
		active = key;
		addOpen = false;
	}
	function closeTab(key: string) {
		const idx = openTabs.indexOf(key);
		openTabs = openTabs.filter((k) => k !== key);
		if (active === key) active = openTabs[Math.min(idx, openTabs.length - 1)] ?? '';
	}
	function startDrag(e: PointerEvent, key: string) {
		if (e.button !== 0) return;
		dragKey = key;
		const move = (ev: PointerEvent) => {
			if (!bar) return;
			const tabs = [...bar.querySelectorAll<HTMLElement>('[data-tab]')];
			const over = tabs.find((el) => {
				const r = el.getBoundingClientRect();
				return ev.clientX >= r.left && ev.clientX <= r.right;
			});
			const overKey = over?.dataset.tab;
			if (overKey && overKey !== dragKey) {
				const from = openTabs.indexOf(dragKey!);
				const to = openTabs.indexOf(overKey);
				const arr = [...openTabs];
				arr.splice(to, 0, arr.splice(from, 1)[0]);
				openTabs = arr;
			}
		};
		const up = () => {
			dragKey = null;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

<div class="dock">
	<div class="tabbar">
		<div class="tabs" bind:this={bar}>
			{#each openTabs as key (key)}
			<div
				class="tab"
				class:on={key === active}
				class:dragging={key === dragKey}
				data-tab={key}
				role="tab"
				tabindex="0"
				aria-selected={key === active}
				onpointerdown={(e) => startDrag(e, key)}
				onclick={() => (active = key)}
				onkeydown={(e) => e.key === 'Enter' && (active = key)}
			>
				<span class="tdot" class:on={key === active}></span>
				<span class="tlabel">{labelOf(key)}</span>
				<IconButton
					size="sm"
					label="close tab"
					onpointerdown={(e: PointerEvent) => e.stopPropagation()}
					onclick={(e: MouseEvent) => {
						e.stopPropagation();
						closeTab(key);
					}}><X size={12} /></IconButton>
			</div>
			{/each}
		</div>
		<div class="add">
			<IconButton onclick={() => (addOpen = !addOpen)} label="add panel" disabled={available.length === 0}><Plus size={15} /></IconButton>
			{#if addOpen}
				<button class="add-backdrop" aria-label="close" onclick={() => (addOpen = false)}></button>
				<div class="add-menu">
					{#each available as p (p.key)}
						<button class="add-item" onclick={() => openPanel(p.key)}>{p.label}</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="content">
		{#each openTabs as key (key)}
			<div class="pane" class:hidden={key !== active}>
				{#if key === 'plan'}<PlanPanel {plan} />
				{:else if key === 'goal'}<GoalPanel {goal} />
				{:else if key === 'changes'}<ChangesPanel {cwd} files={changed} onRevert={onRevertFile} />
				{:else if key === 'files'}<FilesPanel rootDir={cwd} />
				{:else if key === 'git'}<GitPanel {cwd} />
				{:else if key === 'term'}<TerminalPanel {cwd} />{/if}
			</div>
		{/each}
		{#if openTabs.length === 0}
			<div class="empty">
				<p>没有打开的面板</p>
				<span>点 <b>+</b> 打开一个</span>
			</div>
		{/if}
	</div>
</div>

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
		transition: opacity 0.12s;
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
		animation: rise 0.12s ease;
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
</style>
