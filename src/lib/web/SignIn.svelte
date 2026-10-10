<script lang="ts">
	// Signed out: one line on what this is, one button to the JuCode sign-in.
	import { auth } from './auth.svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';

	let going = $state(false);
	function signIn() {
		going = true;
		void auth.signIn();
	}
</script>

<div class="signin">
	<div class="card">
		<div class="brand">{t('web.brand')}</div>
		<h1>{t('web.signIn.title')}</h1>
		<p>{t('web.signIn.hint')}</p>
		<Button variant="primary" full disabled={going} onclick={signIn}>{going ? t('web.signIn.working') : t('web.signIn.button')}</Button>
	</div>
</div>

<style>
	.signin {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 24px;
		background: var(--bg);
		color: var(--text);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: min(360px, 100%);
	}
	.brand {
		font-size: var(--fs-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	h1 {
		margin: 12px 0 0;
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	p {
		margin: 0 0 10px;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.6;
	}
</style>
