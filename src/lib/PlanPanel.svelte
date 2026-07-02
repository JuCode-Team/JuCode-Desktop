<script lang="ts">
	import { ListTodo, Circle, CircleDot, CircleCheck } from 'lucide-svelte';
	import type { PlanStep } from '$lib/chat.svelte';
	import { t } from '$lib/i18n';

	let { plan }: { plan: PlanStep[] } = $props();

	const META: Record<string, { icon: typeof Circle; cls: string }> = {
		pending: { icon: Circle, cls: 'pending' },
		in_progress: { icon: CircleDot, cls: 'active' },
		completed: { icon: CircleCheck, cls: 'done' }
	};
	const metaOf = (s: string) => META[s] ?? META.pending;
	const done = $derived(plan.filter((p) => p.status === 'completed').length);
</script>

<div class="panel">
	{#if plan.length}
		<div class="head">
			<span class="title">{t('dock.plan.title')}</span>
			<span class="count">{done}/{plan.length}</span>
		</div>
		<ol class="steps">
			{#each plan as p, i (i)}
				{@const m = metaOf(p.status)}
				<li class="step {m.cls}">
					<span class="ico"><m.icon size={15} /></span>
					<span class="text">{p.step}</span>
				</li>
			{/each}
		</ol>
	{:else}
		<div class="empty">
			<ListTodo size={26} />
			<p>{t('dock.plan.empty')}</p>
			<span>{t('dock.plan.emptyHint')}</span>
		</div>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 18px 10px;
	}
	.title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim);
		background: var(--surface2);
		border-radius: 999px;
		padding: 2px 9px;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0 12px 16px;
		overflow-y: auto;
	}
	.step {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 7px 8px;
		border-radius: var(--r-sm);
		font-size: 13px;
		line-height: 1.4;
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--dim2);
	}
	.step.active .ico {
		color: var(--accent-bright);
	}
	.step.done .ico {
		color: var(--ok);
	}
	.step.active {
		background: var(--accent-soft);
	}
	.step.active .text {
		color: var(--text);
		font-weight: 600;
	}
	.step.done .text {
		color: var(--dim);
		text-decoration: line-through;
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
</style>
