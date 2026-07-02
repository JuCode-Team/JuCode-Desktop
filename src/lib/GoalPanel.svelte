<script lang="ts">
	import { Target, Loader, Pause, OctagonAlert, CircleCheck, Clock, Coins } from 'lucide-svelte';
	import type { Goal } from '$lib/chat.svelte';
	import { t } from '$lib/i18n';

	let { goal }: { goal: Goal | null } = $props();

	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const fmtTime = (s: number) =>
		s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}m`;
	const pct = $derived(
		goal?.token_budget ? Math.min(100, Math.round((goal.tokens_used / goal.token_budget) * 100)) : null
	);

	const META: Record<string, { key: string; cls: string; icon: typeof Target }> = {
		active: { key: 'active', cls: 'active', icon: Loader },
		paused: { key: 'paused', cls: 'paused', icon: Pause },
		blocked: {
			key: 'blocked',
			cls: 'blocked',
			icon: OctagonAlert
		},
		complete: { key: 'complete', cls: 'complete', icon: CircleCheck }
	};
	const meta = $derived.by(() => {
		const m = META[goal?.status ?? ''];
		if (!m) return { label: goal?.status ?? '', cls: 'active', icon: Target, hint: '' };
		return { label: t(`dock.goal.${m.key}`), cls: m.cls, icon: m.icon, hint: t(`dock.goal.${m.key}Hint`) };
	});
</script>

<div class="panel">
	{#if goal}
		<div class="body">
			<div class="badge {meta.cls}">
				<meta.icon size={13} class={goal.status === 'active' ? 'spin' : ''} />
				{meta.label}
			</div>

			<div class="obj">{goal.objective}</div>
			{#if meta.hint}<div class="hint">{meta.hint}</div>{/if}

			<div class="stats">
				<div class="stat">
					<span class="stat-ico"><Coins size={13} /></span>
					<div>
						<div class="stat-val">{fmt(goal.tokens_used)}{#if goal.token_budget} / {fmt(goal.token_budget)}{/if}</div>
						<div class="stat-lab">tokens{#if !goal.token_budget} · {t('dock.goal.noBudget')}{/if}</div>
					</div>
				</div>
				<div class="stat">
					<span class="stat-ico"><Clock size={13} /></span>
					<div>
						<div class="stat-val">{fmtTime(goal.time_used_seconds)}</div>
						<div class="stat-lab">{t('dock.goal.timeUsed')}</div>
					</div>
				</div>
			</div>

			{#if pct !== null}
				<div class="prog">
					<div class="prog-top"><span>{t('dock.goal.tokenBudget')}</span><span class="prog-pct">{pct}%</span></div>
					<div class="bar"><span class="fill" class:over={pct >= 90} style:width="{pct}%"></span></div>
				</div>
			{/if}
		</div>
	{:else}
		<div class="empty">
			<Target size={26} />
			<p>{t('dock.goal.empty')}</p>
			<span>{t('dock.goal.emptyHintPre')} <code>/goal &lt;{t('dock.goal.goalPlaceholder')}&gt;</code> {t('dock.goal.emptyHintPost')}</span>
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
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 11px;
		border-radius: 999px;
		border: 1px solid transparent;
	}
	.badge.active {
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-color: color-mix(in oklab, var(--accent) 35%, transparent);
	}
	.badge.paused {
		color: var(--dim);
		background: var(--surface2);
		border-color: var(--border);
	}
	.badge.blocked {
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 14%, transparent);
		border-color: color-mix(in oklab, var(--warn) 35%, transparent);
	}
	.badge.complete {
		color: var(--ok);
		background: color-mix(in oklab, var(--ok) 14%, transparent);
		border-color: color-mix(in oklab, var(--ok) 35%, transparent);
	}
	.obj {
		margin-top: 12px;
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 700;
		line-height: 1.35;
	}
	.hint {
		margin-top: 6px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--dim);
	}
	.stats {
		display: flex;
		gap: 10px;
		margin-top: 16px;
	}
	.stat {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.stat-ico {
		display: inline-flex;
		color: var(--dim);
	}
	.stat-val {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 600;
	}
	.stat-lab {
		font-size: 11px;
		color: var(--dim2);
		margin-top: 1px;
	}
	.prog {
		margin-top: 16px;
	}
	.prog-top {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--dim);
		margin-bottom: 6px;
	}
	.prog-pct {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.bar {
		height: 6px;
		border-radius: 999px;
		background: var(--surface2);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent), var(--accent-bright));
	}
	.fill.over {
		background: var(--err);
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
