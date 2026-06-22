<script lang="ts">
	import GoalPanel from './GoalPanel.svelte';
	import FilesPanel from './FilesPanel.svelte';
	import GitPanel from './GitPanel.svelte';
	import TerminalPanel from './TerminalPanel.svelte';
	import type { Goal } from '$lib/chat.svelte';

	let { goal }: { goal: Goal | null } = $props();
	let tab = $state<'goal' | 'files' | 'git' | 'term'>('goal');
	let termOpened = $state(false);

	const tabs: Array<[typeof tab, string]> = [
		['goal', '目标'],
		['files', '文件'],
		['git', 'Git'],
		['term', '终端']
	];

	$effect(() => {
		if (tab === 'term') termOpened = true;
	});
</script>

<div class="dock">
	<div class="tabbar">
		{#each tabs as [key, label] (key)}
			<button class="tab" class:on={tab === key} onclick={() => (tab = key)}>{label}</button>
		{/each}
	</div>
	<div class="content">
		{#if tab === 'goal'}<GoalPanel {goal} />{/if}
		{#if tab === 'files'}<FilesPanel />{/if}
		{#if tab === 'git'}<GitPanel />{/if}
		{#if termOpened}
			<div class="termwrap" class:hidden={tab !== 'term'}><TerminalPanel /></div>
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
		gap: 16px;
		padding: 14px 16px 0;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.tab {
		background: none;
		border: none;
		color: var(--dim);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 600;
		padding: 0 0 12px;
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.content {
		flex: 1;
		min-height: 0;
		position: relative;
	}
	.content > :global(*) {
		height: 100%;
	}
	.termwrap {
		height: 100%;
	}
	.hidden {
		display: none;
	}
</style>
