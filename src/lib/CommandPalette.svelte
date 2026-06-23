<script lang="ts">
	import { tick } from 'svelte';
	import {
		Search, Plus, FolderPlus, Cpu, RotateCcw, History, Layers,
		Gauge, Activity, Stethoscope, GitBranch, Store, Settings as SettingsIcon,
		PanelRight, SunMoon, ChevronRight, Wrench
	} from 'lucide-svelte';
	import type { ChatState } from '$lib/chat.svelte';

	let {
		chat,
		hasProject,
		onClose,
		onRun,
		onNewSession,
		onNewProject,
		onSettings,
		onMarket,
		onTogglePanel,
		onToggleTheme,
		onSetup
	}: {
		chat: ChatState | undefined;
		hasProject: boolean;
		onClose: () => void;
		onRun: (cmd: string) => void;
		onNewSession: () => void;
		onNewProject: () => void;
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
		run: () => void;
	};

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
			{ id: 'new-session', label: '新建对话', keys: '⌘N', icon: Plus, keywords: 'new session 对话', disabled: !hasProject, run: wrap(onNewSession) },
			{ id: 'new-project', label: '新建项目', icon: FolderPlus, keywords: 'new project 项目 目录', run: wrap(onNewProject) },
			{ id: 'model', label: '切换模型 / 推理强度', icon: Cpu, keywords: 'model effort 模型', run: wrap(() => onRun('/model')) },
			{ id: 'rewind', label: '回退到历史回合', hint: '会还原文件改动', icon: RotateCcw, keywords: 'rewind undo 回退 撤销', run: wrap(() => onRun('/rewind')) },
			{ id: 'resume', label: '恢复历史会话', icon: History, keywords: 'resume history 历史 恢复', run: wrap(() => onRun('/resume')) },
			{ id: 'tree', label: '对话分支树', icon: GitBranch, keywords: 'tree branch 分支 树', run: wrap(() => onRun('/tree')) },
			{ id: 'compact', label: '压缩上下文', icon: Layers, keywords: 'compact 压缩', run: wrap(() => onRun('/compact')) },
			{ id: 'context', label: '上下文用量', icon: Gauge, keywords: 'context usage 上下文', run: wrap(() => onRun('/context')) },
			{ id: 'stats', label: '会话统计', icon: Activity, keywords: 'stats 统计', run: wrap(() => onRun('/stats')) },
			{ id: 'doctor', label: '环境诊断', icon: Stethoscope, keywords: 'doctor 诊断', run: wrap(() => onRun('/doctor')) },
			{ id: 'market', label: '扩展市场', icon: Store, keywords: 'market skills 市场 技能 扩展', run: wrap(onMarket) },
			{ id: 'settings', label: '设置', keys: '⌘,', icon: SettingsIcon, keywords: 'settings 设置 provider', run: wrap(onSettings) },
			{ id: 'setup', label: '安装向导 / 环境检查', hint: 'git、登录', icon: Wrench, keywords: 'setup wizard env git login 安装 向导 环境 登录', run: wrap(onSetup) },
			{ id: 'panel', label: '切换右侧面板', keys: '⌘B', icon: PanelRight, keywords: 'panel dock 面板', run: wrap(onTogglePanel) },
			{ id: 'theme', label: '切换主题', icon: SunMoon, keywords: 'theme dark light 主题', run: wrap(onToggleTheme) }
		];
		const known = new Set(['/model', '/rewind', '/undo', '/resume', '/tree', '/compact', '/context', '/stats', '/doctor', '/new']);
		const slash: Action[] = (chat?.commands ?? [])
			.filter((c) => !known.has(c.command))
			.map((c) => ({
				id: `cmd${c.command}`,
				label: c.command,
				hint: c.description,
				icon: ChevronRight,
				keywords: `${c.command} ${c.description ?? ''}`,
				run: wrap(() => onRun(c.command))
			}));
		return [...curated, ...slash];
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
	<div class="palette" role="dialog" aria-modal="true" tabindex="-1" aria-label="命令面板">
		<div class="search">
			<Search size={16} />
			<input bind:this={inputEl} bind:value={query} onkeydown={onKey} placeholder="搜索命令或操作…" />
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
			{#if filtered.length === 0}<div class="empty">没有匹配的命令</div>{/if}
		</div>
		<div class="foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
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
		animation: fade 0.12s ease;
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
		animation: pop 0.14s cubic-bezier(0.2, 0.9, 0.3, 1);
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
