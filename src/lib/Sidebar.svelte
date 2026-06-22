<script lang="ts">
	import { Store, Plus, History, X, LoaderCircle, Settings as SettingsIcon, Moon, Sun } from 'lucide-svelte';
	import { themeState, toggleTheme } from '$lib/theme.svelte';
	import type { Project } from '$lib/types';

	let {
		projects,
		activeId,
		width,
		loggedIn,
		providerName,
		onSelect,
		onNewProject,
		onNewSession,
		onCloseSession,
		onCloseProject,
		onHistory,
		onSettings,
		onMarket
	}: {
		projects: Project[];
		activeId: string;
		width: number;
		loggedIn: boolean;
		providerName: string;
		onSelect: (id: string) => void;
		onNewProject: () => void;
		onNewSession: (p: Project) => void;
		onCloseSession: (id: string) => void;
		onCloseProject: (p: Project) => void;
		onHistory: (p: Project) => void;
		onSettings: () => void;
		onMarket: () => void;
	} = $props();
</script>

<aside class="sidebar" style:width="{width}px">
	<div class="brand" data-tauri-drag-region>
		<span class="word">JuCode</span>
	</div>

	<div class="nav">
		<button class="navcard" onclick={onMarket}><Store size={14} /><span>市场</span></button>
	</div>

	<div class="sess-head">
		<span>对话 · 按项目</span>
		<div class="sess-actions">
			<button onclick={onNewProject} aria-label="new project" title="新建项目（选择目录）"><Plus size={15} /></button>
		</div>
	</div>

	<div class="sess-list">
		{#each projects as p (p.id)}
			<div class="group">
				<span class="group-name" title={p.path}>{p.name}</span>
				<span class="group-count">{p.sessions.length}</span>
				<button class="group-add" onclick={() => onHistory(p)} aria-label="history" title="历史对话"><History size={13} /></button>
				<button class="group-add no-auto" onclick={() => onNewSession(p)} aria-label="new session" title="在此项目下新建对话"><Plus size={13} /></button>
				{#if projects.length > 1}
					<button class="group-x" onclick={() => onCloseProject(p)} aria-label="close project" title="关闭项目"><X size={12} /></button>
				{/if}
			</div>
			{#each p.sessions as s (s.id)}
				<button class="sess" class:on={s.id === activeId} onclick={() => onSelect(s.id)}>
					<span class="sess-dot" class:busy={s.chat.busy} class:err={s.chat.engineState === 'exited'} class:unseen={s.chat.unseen && !s.chat.busy}></span>
					<span class="sess-title">{s.chat.title}</span>
					{#if s.chat.busy}<LoaderCircle size={12} class="spin" />{/if}
					<span
						class="sess-x"
						role="button"
						tabindex="0"
						onclick={(e) => {
							e.stopPropagation();
							onCloseSession(s.id);
						}}
						onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onCloseSession(s.id))}
						aria-label="close"><X size={12} /></span
					>
				</button>
			{/each}
			{#if p.sessions.length === 0}
				<button class="sess-empty" onclick={() => onNewSession(p)}>+ 新建对话</button>
			{/if}
		{/each}
	</div>

	<button class="account" onclick={onSettings} title="账户设置">
		<span class="acc-dot" class:on={loggedIn}></span>
		<span class="acc-name">{loggedIn ? providerName : '未登录'}</span>
		<span class="acc-go">设置</span>
	</button>
	<div class="side-foot">
		<button class="foot-btn" onclick={onSettings}><SettingsIcon size={15} /><span>设置</span></button>
		<button class="foot-icon" onclick={toggleTheme} aria-label="toggle theme">
			{#if themeState.value === 'dark'}<Moon size={15} />{:else}<Sun size={15} />{/if}
		</button>
	</div>
</aside>

<style>
	.sidebar {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--sidebar);
		border-right: 1px solid var(--hairline);
		min-width: 0;
	}
	.account {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 8px;
		padding: 8px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		font-size: 12px;
	}
	.account:hover {
		background: var(--surface2);
	}
	.acc-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.acc-dot.on {
		background: var(--ok);
	}
	.acc-name {
		flex: 1;
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}
	.acc-go {
		color: var(--dim2);
		font-size: 11px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 26px 18px 14px;
	}
	.word {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 17px;
		letter-spacing: -0.01em;
	}
	.nav {
		display: flex;
		gap: 6px;
		padding: 0 14px 10px;
	}
	.navcard {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 0;
		border-radius: var(--r-sm);
		border: 1px solid var(--hairline);
		background: none;
		color: var(--dim);
		font-size: 12px;
		cursor: pointer;
	}
	.navcard:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 16px 8px;
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.sess-actions {
		display: flex;
		gap: 4px;
	}
	.sess-actions button {
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: 6px;
		cursor: pointer;
	}
	.sess-actions button:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 8px 6px;
	}
	.group-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.group-count {
		font-size: 10px;
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 999px;
		padding: 1px 7px;
		flex-shrink: 0;
	}
	.group-add,
	.group-x {
		display: inline-flex;
		padding: 3px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: 5px;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0;
	}
	.group-add {
		margin-left: auto;
	}
	.group-add.no-auto {
		margin-left: 0;
	}
	.group:hover .group-add,
	.group:hover .group-x {
		opacity: 1;
	}
	.group-add:hover,
	.group-x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.sess-empty {
		display: block;
		width: 100%;
		text-align: left;
		padding: 7px 12px;
		margin-left: 2px;
		border: none;
		background: none;
		color: var(--dim2);
		font-size: 12px;
		cursor: pointer;
		border-radius: var(--r-sm);
	}
	.sess-empty:hover {
		background: var(--surface);
		color: var(--text);
	}
	.sess {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 8px 9px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.sess:hover {
		background: var(--surface);
	}
	.sess.on {
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.sess-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.sess-dot.busy {
		background: var(--accent-bright);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.sess-dot.err {
		background: var(--err);
	}
	.sess-dot.unseen {
		background: var(--accent-bright);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.sess-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess-x {
		display: inline-flex;
		color: var(--dim2);
		opacity: 0;
		border-radius: 4px;
	}
	.sess:hover .sess-x {
		opacity: 1;
	}
	.sess-x:hover {
		color: var(--text);
	}
	.side-foot {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 12px;
		border-top: 1px solid var(--hairline);
	}
	.foot-btn {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
		font-size: 13px;
	}
	.foot-btn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.foot-icon {
		display: inline-flex;
		padding: 8px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.foot-icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
</style>
