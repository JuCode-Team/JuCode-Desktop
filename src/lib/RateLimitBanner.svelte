<script lang="ts">
	import { AlertTriangle, X } from 'lucide-svelte';
	import { t } from '$lib/i18n';

	let {
		rateLimit,
		onDismiss
	}: {
		rateLimit: { level: 'warning' | 'limited'; message: string; resetsAt: number | null };
		onDismiss: () => void;
	} = $props();

	// A ticking clock so the "resets in …" countdown stays live.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const remaining = $derived(rateLimit.resetsAt ? Math.max(0, rateLimit.resetsAt - now) : 0);
	const countdown = $derived.by(() => {
		if (!rateLimit.resetsAt || remaining <= 0) return '';
		const s = Math.ceil(remaining / 1000);
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
	});
</script>

<div class="rl" class:limited={rateLimit.level === 'limited'}>
	<AlertTriangle size={14} />
	<span class="rl-body">
		<b>{rateLimit.level === 'limited' ? t('shell.rlLimited') : t('shell.rlWarning')}</b>
		{#if rateLimit.message}<span class="rl-msg">{rateLimit.message}</span>{/if}
		{#if countdown}<span class="rl-reset">{t('shell.rlResetsIn', { t: countdown })}</span>{/if}
	</span>
	<button class="rl-x" aria-label={t('shell.rlDismiss')} title={t('shell.rlDismiss')} onclick={onDismiss}>
		<X size={13} />
	</button>
</div>

<style>
	.rl {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
		padding: 7px 10px;
		font-size: 12px;
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 10%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--warn) 38%, transparent);
		border-radius: var(--r-md);
	}
	.rl.limited {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 10%, var(--panel));
		border-color: color-mix(in oklab, var(--err) 40%, transparent);
	}
	.rl-body {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex: 1;
		min-width: 0;
		flex-wrap: wrap;
	}
	.rl-msg {
		color: var(--text);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rl-reset {
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.rl-x {
		display: inline-flex;
		padding: 2px;
		border: none;
		background: none;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
		flex-shrink: 0;
	}
	.rl-x:hover {
		opacity: 1;
	}
</style>
