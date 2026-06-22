<script lang="ts">
	import { Target } from 'lucide-svelte';
	import type { Goal } from '$lib/chat.svelte';

	let { goal }: { goal: Goal | null } = $props();

	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const pct = $derived(
		goal?.token_budget ? Math.min(100, Math.round((goal.tokens_used / goal.token_budget) * 100)) : null
	);
	const statusLabel = $derived(
		(
			{
				active: 'in progress',
				paused: 'paused',
				blocked: 'blocked',
				complete: 'complete'
			} as Record<string, string>
		)[goal?.status ?? ''] ?? goal?.status
	);
</script>

<div class="panel">
	{#if goal}
		<div class="body">
			<div class="top">
				<div class="obj">{goal.objective}</div>
				{#if pct !== null}<div class="pct">{pct}<span>%</span></div>{/if}
			</div>
			<div class="sub">{statusLabel}{#if goal.time_used_seconds} · {Math.round(goal.time_used_seconds / 60)}m{/if}</div>
			{#if pct !== null}
				<div class="bar"><span class="fill" style:width="{pct}%"></span></div>
				<div class="budget">{fmt(goal.tokens_used)} / {fmt(goal.token_budget ?? 0)} tokens</div>
			{:else}
				<div class="budget">{fmt(goal.tokens_used)} tokens used · no budget set</div>
			{/if}
		</div>
	{:else}
		<div class="empty">
			<Target size={26} />
			<p>No active goal</p>
			<span>Set one with <code>/goal &lt;objective&gt;</code></span>
		</div>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.body {
		padding: 18px;
	}
	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.obj {
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 700;
		line-height: 1.3;
	}
	.pct {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 800;
		color: var(--accent-bright);
		line-height: 1;
		white-space: nowrap;
	}
	.pct span {
		font-size: 15px;
	}
	.sub {
		margin-top: 6px;
		font-size: 12px;
		color: var(--dim);
		font-family: var(--font-mono);
	}
	.bar {
		margin-top: 14px;
		height: 6px;
		border-radius: 999px;
		background: var(--surface2);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--accent), var(--accent-bright));
		border-radius: 999px;
	}
	.budget {
		margin-top: 8px;
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--dim2);
		padding: 30px;
		text-align: center;
	}
	.empty p {
		margin: 4px 0 0;
		font-size: 14px;
		color: var(--dim);
	}
	.empty span {
		font-size: 12px;
	}
	.empty code {
		font-family: var(--font-mono);
		color: var(--accent-bright);
	}
</style>
