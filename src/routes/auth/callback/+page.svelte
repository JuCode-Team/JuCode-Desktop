<script lang="ts">
	// Back from the consent page: the code becomes tokens, then the page the
	// sign-in started from (the chat by default).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/web/auth.svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';

	let error = $state('');

	onMount(async () => {
		try {
			const next = await auth.finish(new URLSearchParams(location.search));
			await goto(next, { replaceState: true });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	});
</script>

<svelte:head><title>JuCode</title></svelte:head>

<div class="callback">
	{#if error}
		<p class="msg">{t('web.signIn.failed', { msg: error })}</p>
		<Button variant="primary" onclick={() => auth.signIn('/chat')}>{t('web.signIn.retry')}</Button>
	{:else}
		<p class="msg"><CircleNotchIcon size={16} class="spin" /> {t('web.signIn.working')}</p>
	{/if}
</div>

<style>
	.callback {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		min-height: 100dvh;
		padding: 24px;
		background: var(--bg);
		color: var(--text);
		text-align: center;
	}
	.msg {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
</style>
