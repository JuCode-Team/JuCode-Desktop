<script lang="ts">
	// Rate-limit warning above the composer, with a live reset countdown.
	import { t } from '$lib/i18n';
	import Notice from '$lib/ui/Notice.svelte';

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

<div class="rl">
	<Notice tone={rateLimit.level === 'limited' ? 'error' : 'warn'} {onDismiss}>
		<span class="rl-body">
			<b>{rateLimit.level === 'limited' ? t('shell.rlLimited') : t('shell.rlWarning')}</b>
			{#if rateLimit.message}<span class="rl-msg">{rateLimit.message}</span>{/if}
			{#if countdown}<span class="rl-reset">{t('shell.rlResetsIn', { t: countdown })}</span>{/if}
		</span>
	</Notice>
</div>

<style>
	.rl {
		margin: 0 0 8px;
	}
	.rl-body {
		display: flex;
		align-items: baseline;
		gap: 8px;
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
</style>
