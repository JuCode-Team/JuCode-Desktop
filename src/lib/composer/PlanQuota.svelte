<script lang="ts">
	// The official plan's usage windows (Claude subscription, ChatGPT plan),
	// as the session's engine last reported them: share used and when each
	// window resets. The bar turns to the warning colour near the cap.
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';

	let { usage }: { usage: NonNullable<ChatState['planUsage']> } = $props();

	function label(w: { key: string; minutes: number | null }): string {
		if (w.key === 'seven_day_overage_included') return t('chat.quota.weekOverage');
		const m = w.minutes ?? (w.key === 'five_hour' ? 300 : w.key === 'seven_day' ? 10_080 : null);
		if (m === 10_080) return t('chat.quota.week');
		if (m === null) return w.key;
		return m < 1440 ? t('chat.quota.hours', { n: Math.round(m / 60) }) : t('chat.quota.days', { n: Math.round(m / 1440) });
	}

	function resets(at: number | null): string {
		if (at === null) return '';
		const mins = Math.round((at - Date.now()) / 60_000);
		if (mins <= 1) return t('chat.quota.resetSoon');
		if (mins < 60) return t('chat.quota.resetMinutes', { n: mins });
		if (mins < 1440) return t('chat.quota.resetHours', { h: Math.floor(mins / 60), m: mins % 60 });
		return t('chat.quota.resetDays', { n: Math.round(mins / 1440) });
	}

	const plan = $derived(usage.plan ? usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1) : '');
</script>

<section class="quota" aria-label={t('chat.quota.title')}>
	<div class="qhead">
		<span class="qlabel">{t('chat.quota.title')}</span>
		{#if plan}<span class="qplan">{plan}</span>{/if}
	</div>
	{#each usage.windows as w (w.key)}
		<div class="qrow">
			<div class="qline">
				<span class="qname">{label(w)}</span>
				<span class="qnum">{Math.round(w.used)}%</span>
				{#if w.resetsAt}<span class="qreset">{resets(w.resetsAt)}</span>{/if}
			</div>
			<div class="qtrack">
				<div class="qfill" class:warn={w.used >= 80} class:full={w.used >= 100} style:width="{Math.min(100, Math.max(0, w.used))}%"></div>
			</div>
		</div>
	{/each}
</section>

<style>
	.quota {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 8px 6px;
	}
	.qhead {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--fs-xs);
	}
	.qlabel {
		flex: 1;
		color: var(--dim2);
	}
	.qplan {
		font-size: var(--fs-2xs);
		color: var(--dim);
		padding: 1px 6px;
		border-radius: var(--r-full);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.qline {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 3px;
		font-size: var(--fs-xs);
	}
	.qname {
		flex: 1;
		color: var(--dim);
	}
	.qnum {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.qreset {
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.qtrack {
		height: 4px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.qfill {
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--t-med) var(--ease-out);
	}
	.qfill.warn {
		background: var(--warn);
	}
	.qfill.full {
		background: var(--err);
	}
</style>
