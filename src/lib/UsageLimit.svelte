<script lang="ts">
	// The engine's plan usage limit above the composer: which limit, how much
	// of it is used, when it resets. Once hit, the stopped turn can carry on
	// by itself at the reset (limitResume.svelte.ts).
	import XIcon from '@lucide/svelte/icons/x';
	import { t, getLocale } from '$lib/i18n';
	import { BACKEND_LABELS, type BackendId } from '$lib/backends';
	import type { UsageLimit } from '$lib/chat.svelte';

	let {
		limit,
		backend,
		resumeArmed,
		onResume,
		onCancelResume,
		onDismiss
	}: {
		limit: UsageLimit;
		backend: BackendId;
		resumeArmed: boolean;
		onResume: () => void;
		onCancelResume: () => void;
		onDismiss: () => void;
	} = $props();

	// Minutes are enough for a reset hours away.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(id);
	});

	const WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage'];
	const name = $derived(
		`${BACKEND_LABELS[backend]} ${WINDOWS.includes(limit.window) ? t(`shell.limit.window.${limit.window}`) : t('shell.limit.window.any')}`
	);
	const title = $derived(
		limit.level === 'limited'
			? t('shell.limit.hit', { name })
			: limit.used !== null
				? t('shell.limit.used', { name, n: Math.round(limit.used) })
				: t('shell.limit.near', { name })
	);

	// The reset: the time of day (with the date if not today), then how far off.
	const reset = $derived.by(() => {
		const at = limit.resetsAt;
		if (!at || at <= now) return '';
		const date = new Date(at);
		const today = new Date(now).toDateString() === date.toDateString();
		const locale = getLocale() === 'zh' ? 'zh-CN' : 'en-US';
		const clock = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
		const when = today ? clock : `${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} ${clock}`;
		const mins = Math.ceil((at - now) / 60_000);
		const h = Math.floor(mins / 60);
		const left = h >= 24 ? t('shell.limit.days', { d: Math.floor(h / 24), h: h % 24 }) : h > 0 ? t('shell.limit.hours', { h, m: mins % 60 }) : t('shell.limit.minutes', { m: mins });
		return t('shell.limit.resets', { when, left });
	});
	// Past its reset, a limit nobody waits on is over.
	$effect(() => {
		if (limit.resetsAt && now > limit.resetsAt && !resumeArmed) onDismiss();
	});
	// The bar: how full the limit is (a hit one is full).
	const fill = $derived(limit.level === 'limited' ? 100 : Math.min(100, Math.max(0, limit.used ?? 0)));
</script>

<div class="limit" role="status">
	{#if limit.used !== null || limit.level === 'limited'}
		<span class="meter {limit.level}" aria-hidden="true"><i style:width="{fill}%"></i></span>
	{/if}
	<span class="body">
		<span class="title">{title}</span>
		{#if limit.overage}<span class="dim">{t('shell.limit.overage')}</span>{/if}
		{#if reset}<span class="dim">{reset}</span>{:else if limit.message}<span class="dim">{limit.message}</span>{/if}
	</span>
	{#if limit.level === 'limited' && limit.resetsAt && limit.resetsAt > now}
		{#if resumeArmed}
			<span class="dim">{t('shell.limit.resumeArmed')}</span>
			<button class="act" onclick={onCancelResume}>{t('shell.limit.cancelResume')}</button>
		{:else}
			<button class="act" onclick={onResume}>{t('shell.limit.resume')}</button>
		{/if}
	{/if}
	<button class="x" aria-label={t('common.close')} onclick={onDismiss}><XIcon size={14} /></button>
</div>

<style>
	.limit {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: calc(var(--chat-w) + 2 * var(--chat-pad));
		width: calc(100% - 2 * var(--chat-pad));
		margin: 0 auto 8px;
		padding: 7px 10px;
		border-radius: var(--r);
		background: var(--surface2);
		font-size: var(--fs-xs);
		line-height: 1.5;
	}
	.meter {
		position: relative;
		flex-shrink: 0;
		width: 44px;
		height: 4px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}
	.meter i {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: var(--warn);
	}
	.meter.limited i {
		background: var(--err);
	}
	.body {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
		min-width: 0;
	}
	.title {
		color: var(--text);
	}
	.dim {
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.act {
		flex-shrink: 0;
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.act:hover {
		background: var(--surface);
	}
	.x {
		display: inline-flex;
		flex-shrink: 0;
		padding: 2px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.x:hover {
		color: var(--text);
	}
</style>
