<script lang="ts">
	import { tick } from 'svelte';
	import {
		Search, Plus, FolderPlus, Cpu, RotateCcw, History, Layers,
		Gauge, Activity, Stethoscope, GitBranch, GitBranchPlus, Store, Settings as SettingsIcon,
		PanelRight, SunMoon, ChevronRight, Wrench
	} from 'lucide-svelte';
	import type { ChatState } from '$lib/chat.svelte';
	import { caps, type BackendCaps } from '$lib/backends';
	import { focusTrap } from '$lib/focusTrap';
	import { t } from '$lib/i18n';

	let {
		chat,
		hasProject,
		canNewTask = false,
		onClose,
		onRun,
		onNewSession,
		onNewProject,
		onNewTask,
		onSettings,
		onMarket,
		onTogglePanel,
		onToggleTheme,
		onSetup
	}: {
		chat: ChatState | undefined;
		hasProject: boolean;
		/** 当前激活项目可以开并行任务（是普通项目而非 worktree）。 */
		canNewTask?: boolean;
		onClose: () => void;
		onRun: (cmd: string) => void;
		onNewSession: () => void;
		onNewProject: () => void;
		onNewTask: () => void;
		onSettings: () => void;
		onMarket: () => void;
		onTogglePanel: () => void;
		onToggleTheme: () => void;
		onSetup: () => void;
	} = $props();

	type Action = {
		id: string;
		label: string;
		hint?: string;
		keys?: string;
		icon: typeof Plus;
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
			{ id: 'new-session', label: t('shell.cmd.newSession'), keys: '⌘N', icon: Plus, keywords: t('shell.cmd.newSessionKw'), disabled: !hasProject, run: wrap(onNewSession) },
			{ id: 'new-project', label: t('shell.cmd.newProject'), icon: FolderPlus, keywords: t('shell.cmd.newProjectKw'), run: wrap(onNewProject) },
			{ id: 'new-task', label: t('shell.cmd.newTask'), hint: t('shell.cmd.newTaskHint'), icon: GitBranchPlus, keywords: t('shell.cmd.newTaskKw'), disabled: !canNewTask, run: wrap(onNewTask) },
			{ id: 'model', label: t('shell.cmd.model'), icon: Cpu, keywords: t('shell.cmd.modelKw'), cap: 'modelPicker', run: wrap(() => onRun('/model')) },
			{ id: 'rewind', label: t('shell.cmd.rewind'), hint: t('shell.cmd.rewindHint'), icon: RotateCcw, keywords: t('shell.cmd.rewindKw'), cap: 'checkpoints', run: wrap(() => onRun('/rewind')) },
			{ id: 'resume', label: t('shell.cmd.resume'), icon: History, keywords: t('shell.cmd.resumeKw'), cap: 'resume', run: wrap(() => onRun('/resume')) },
			{ id: 'tree', label: t('shell.cmd.tree'), icon: GitBranch, keywords: t('shell.cmd.treeKw'), cap: 'branchTree', run: wrap(() => onRun('/tree')) },
			{ id: 'compact', label: t('shell.cmd.compact'), icon: Layers, keywords: t('shell.cmd.compactKw'), cap: 'compact', run: wrap(() => onRun('/compact')) },
			{ id: 'context', label: t('shell.cmd.context'), icon: Gauge, keywords: t('shell.cmd.contextKw'), cap: 'slashCommands', run: wrap(() => onRun('/context')) },
			{ id: 'stats', label: t('shell.cmd.stats'), icon: Activity, keywords: t('shell.cmd.statsKw'), cap: 'slashCommands', run: wrap(() => onRun('/stats')) },
			{ id: 'doctor', label: t('shell.cmd.doctor'), icon: Stethoscope, keywords: t('shell.cmd.doctorKw'), cap: 'slashCommands', run: wrap(() => onRun('/doctor')) },
			{ id: 'market', label: t('shell.cmd.market'), icon: Store, keywords: t('shell.cmd.marketKw'), cap: 'skills', run: wrap(onMarket) },
			{ id: 'settings', label: t('shell.cmd.settings'), keys: '⌘,', icon: SettingsIcon, keywords: t('shell.cmd.settingsKw'), run: wrap(onSettings) },
			{ id: 'setup', label: t('shell.cmd.setup'), hint: t('shell.cmd.setupHint'), icon: Wrench, keywords: t('shell.cmd.setupKw'), run: wrap(onSetup) },
			{ id: 'panel', label: t('shell.cmd.panel'), keys: '⌘B', icon: PanelRight, keywords: t('shell.cmd.panelKw'), run: wrap(onTogglePanel) },
			{ id: 'theme', label: t('shell.cmd.theme'), icon: SunMoon, keywords: t('shell.cmd.themeKw'), run: wrap(onToggleTheme) }
		];
		const known = new Set(['/model', '/rewind', '/undo', '/resume', '/tree', '/compact', '/context', '/stats', '/doctor', '/new']);
		const gated = curated.filter((a) => !a.cap || bcaps[a.cap]);
		const slash: Action[] = (bcaps.slashCommands ? (chat?.commands ?? []) : [])
			.filter((c) => !known.has(c.command))
			.map((c) => ({
				id: `cmd${c.command}`,
				label: c.command,
				hint: c.description,
				icon: ChevronRight,
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
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
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

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="palette" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('shell.paletteLabel')} use:focusTrap>
		<div class="search">
			<Search size={16} />
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
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 14vh;
		z-index: 70;
		animation: fade var(--t-fast) var(--ease-out);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.palette {
		width: min(560px, 92vw);
		max-height: 64vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		animation: pop var(--t-med) var(--ease-spring);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.99);
		}
	}
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
		font-size: 15px;
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.rows {
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
		font-size: 13.5px;
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
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.keys {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.empty {
		padding: 22px;
		text-align: center;
		color: var(--dim);
		font-size: 13px;
	}
	.foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--dim2);
		text-align: center;
	}
</style>
