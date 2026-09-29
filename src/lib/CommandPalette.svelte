<script lang="ts">
	import { tick } from 'svelte';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import GaugeIcon from 'phosphor-svelte/lib/GaugeIcon';
	import PulseIcon from 'phosphor-svelte/lib/PulseIcon';
	import StethoscopeIcon from 'phosphor-svelte/lib/StethoscopeIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import GitForkIcon from 'phosphor-svelte/lib/GitForkIcon';
	import StorefrontIcon from 'phosphor-svelte/lib/StorefrontIcon';
	import SettingsIcon from 'phosphor-svelte/lib/GearIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import CircleHalfIcon from 'phosphor-svelte/lib/CircleHalfIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import type { ChatState } from '$lib/chat.svelte';
	import { caps, type BackendCaps } from '$lib/backends';
	import Modal from '$lib/ui/Modal.svelte';
	import { t } from '$lib/i18n';

	let {
		chat,
		hasProject,
		canNewTask = false,
		panelOptions = [],
		onClose,
		onRun,
		onNewSession,
		onNewProject,
		onNewTask,
		onSettings,
		onMarket,
		onOpenPanel,
		onToggleSidebar,
		onToggleTheme,
		onSetup
	}: {
		chat: ChatState | undefined;
		hasProject: boolean;
		/** 当前激活项目可以开并行任务（是普通项目而非 worktree）。 */
		canNewTask?: boolean;
		/** Tool tiles the canvas can open (Git / Terminal / Files / Browser / …). */
		panelOptions?: { key: string; label: string }[];
		onClose: () => void;
		onRun: (cmd: string) => void;
		onNewSession: () => void;
		onNewProject: () => void;
		onNewTask: () => void;
		onSettings: () => void;
		onMarket: () => void;
		/** Open (or focus) a tool tile on the canvas mosaic. */
		onOpenPanel: (kind: string) => void;
		onToggleSidebar: () => void;
		onToggleTheme: () => void;
		onSetup: () => void;
	} = $props();

	type Action = {
		id: string;
		label: string;
		hint?: string;
		keys?: string;
		icon: typeof PlusIcon;
		keywords?: string;
		disabled?: boolean;
		/** Backend capability required for the entry (omit = always shown). */
		cap?: keyof BackendCaps;
		run: () => void;
	};

	// Capability gating for the active session's engine backend.
	const bcaps = $derived(caps(chat));

	let query = $state('');
	let idx = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	const wrap = (fn: () => void) => () => {
		onClose();
		fn();
	};

	// Curated app actions plus the engine's slash commands (deduped against the
	// curated ones, which already cover the common /model, /tree, /resume… verbs).
	const actions = $derived.by<Action[]>(() => {
		const curated: Action[] = [
			{ id: 'new-session', label: t('shell.cmd.newSession'), keys: '⌘N', icon: PlusIcon, keywords: t('shell.cmd.newSessionKw'), disabled: !hasProject, run: wrap(onNewSession) },
			{ id: 'new-project', label: t('shell.cmd.newProject'), icon: FolderPlusIcon, keywords: t('shell.cmd.newProjectKw'), run: wrap(onNewProject) },
			{ id: 'new-task', label: t('shell.cmd.newTask'), hint: t('shell.cmd.newTaskHint'), icon: GitForkIcon, keywords: t('shell.cmd.newTaskKw'), disabled: !canNewTask, run: wrap(onNewTask) },
			{ id: 'model', label: t('shell.cmd.model'), icon: CpuIcon, keywords: t('shell.cmd.modelKw'), cap: 'modelPicker', run: wrap(() => onRun('/model')) },
			{ id: 'rewind', label: t('shell.cmd.rewind'), hint: t('shell.cmd.rewindHint'), icon: ArrowCounterClockwiseIcon, keywords: t('shell.cmd.rewindKw'), cap: 'checkpoints', run: wrap(() => onRun('/rewind')) },
			{ id: 'resume', label: t('shell.cmd.resume'), icon: ClockCounterClockwiseIcon, keywords: t('shell.cmd.resumeKw'), cap: 'resume', run: wrap(() => onRun('/resume')) },
			{ id: 'tree', label: t('shell.cmd.tree'), icon: GitBranchIcon, keywords: t('shell.cmd.treeKw'), cap: 'branchTree', run: wrap(() => onRun('/tree')) },
			{ id: 'compact', label: t('shell.cmd.compact'), icon: StackIcon, keywords: t('shell.cmd.compactKw'), cap: 'compact', run: wrap(() => onRun('/compact')) },
			{ id: 'context', label: t('shell.cmd.context'), icon: GaugeIcon, keywords: t('shell.cmd.contextKw'), cap: 'slashCommands', run: wrap(() => onRun('/context')) },
			{ id: 'stats', label: t('shell.cmd.stats'), icon: PulseIcon, keywords: t('shell.cmd.statsKw'), cap: 'slashCommands', run: wrap(() => onRun('/stats')) },
			{ id: 'doctor', label: t('shell.cmd.doctor'), icon: StethoscopeIcon, keywords: t('shell.cmd.doctorKw'), cap: 'slashCommands', run: wrap(() => onRun('/doctor')) },
			{ id: 'market', label: t('shell.cmd.market'), icon: StorefrontIcon, keywords: t('shell.cmd.marketKw'), cap: 'skills', run: wrap(onMarket) },
			// Tool tiles on the canvas: Git, Terminal, Files, Browser, Plan, …
			...panelOptions.map((p): Action => ({
				id: `panel-${p.key}`,
				label: t('shell.cmd.openPanel', { name: p.label }),
				hint: t('shell.cmd.openPanelHint'),
				icon: SquaresFourIcon,
				keywords: `${t('shell.cmd.openPanelKw')} ${p.key} ${p.label}`,
				run: wrap(() => onOpenPanel(p.key))
			})),
			{ id: 'settings', label: t('shell.cmd.settings'), keys: '⌘,', icon: SettingsIcon, keywords: t('shell.cmd.settingsKw'), run: wrap(onSettings) },
			{ id: 'setup', label: t('shell.cmd.setup'), hint: t('shell.cmd.setupHint'), icon: WrenchIcon, keywords: t('shell.cmd.setupKw'), run: wrap(onSetup) },
			{ id: 'sidebar', label: t('shell.cmd.sidebar'), keys: '⌘B', icon: SidebarSimpleIcon, keywords: t('shell.cmd.sidebarKw'), run: wrap(onToggleSidebar) },
			{ id: 'theme', label: t('shell.cmd.theme'), icon: CircleHalfIcon, keywords: t('shell.cmd.themeKw'), run: wrap(onToggleTheme) }
		];
		const known = new Set(['/model', '/rewind', '/undo', '/resume', '/tree', '/compact', '/context', '/stats', '/doctor', '/new']);
		const gated = curated.filter((a) => !a.cap || bcaps[a.cap]);
		const slash: Action[] = (bcaps.slashCommands ? (chat?.commands ?? []) : [])
			.filter((c) => !known.has(c.command))
			.map((c) => ({
				id: `cmd${c.command}`,
				label: c.command,
				hint: c.description,
				icon: CaretRightIcon,
				keywords: `${c.command} ${c.description ?? ''}`,
				run: wrap(() => onRun(c.command))
			}));
		return [...gated, ...slash];
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = q
			? actions.filter((a) => `${a.label} ${a.keywords ?? ''}`.toLowerCase().includes(q))
			: actions;
		return list;
	});

	$effect(() => {
		filtered;
		idx = 0;
	});
	$effect(() => {
		tick().then(() => inputEl?.focus());
	});

	function run(a: Action | undefined) {
		if (a && !a.disabled) a.run();
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			idx = Math.min(idx + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			idx = Math.max(idx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(filtered[idx]);
		}
	}
</script>

<Modal label={t('shell.paletteLabel')} width={560} placement="top" padded={false} {onClose}>
	<div class="search">
		<MagnifyingGlassIcon size={16} />
		<input bind:this={inputEl} bind:value={query} onkeydown={onKey} placeholder={t('shell.paletteSearch')} />
	</div>
	<div class="rows">
		{#each filtered as a, i (a.id)}
			<button class="row" class:sel={i === idx} class:off={a.disabled} onclick={() => run(a)} onmouseenter={() => (idx = i)}>
				<span class="ico"><a.icon size={15} /></span>
				<span class="label">{a.label}</span>
				{#if a.hint}<span class="hint">{a.hint}</span>{/if}
				{#if a.keys}<span class="keys">{a.keys}</span>{/if}
			</button>
		{/each}
		{#if filtered.length === 0}<div class="empty">{t('shell.paletteEmpty')}</div>{/if}
	</div>
	<div class="foot">{t('shell.paletteFoot')}</div>
</Modal>

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 13px 16px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
	}
	.search input {
		flex: 1;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-lg);
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.rows {
		max-height: calc(64vh - 90px);
		overflow-y: auto;
		padding: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		text-align: left;
		padding: 9px 11px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: var(--fs-sm);
	}
	.row.sel {
		background: var(--surface2);
	}
	.row.off {
		opacity: 0.4;
		cursor: default;
	}
	.ico {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.row.sel .ico {
		color: var(--accent-bright);
	}
	.label {
		flex-shrink: 0;
	}
	.hint {
		flex: 1;
		color: var(--dim2);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.keys {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		flex-shrink: 0;
	}
	.empty {
		padding: 22px;
		text-align: center;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		text-align: center;
	}
</style>
