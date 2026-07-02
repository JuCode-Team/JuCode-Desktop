<script lang="ts">
	import { t } from '$lib/i18n';
	import type { DeepseekBalance } from '$lib/protocol';

	let { balance }: { balance: DeepseekBalance | null } = $props();
</script>

<div class="dsbal">
	{#if balance?.balance_infos?.length}
		{#each balance.balance_infos as b (b.currency)}
			<div class="dsrow"><span>{t('settings.account.totalBalance')}</span><b>{b.total_balance} {b.currency}</b></div>
			<div class="dsrow sub"><span>{t('settings.account.grantedBalance')}</span><span>{b.granted_balance}</span></div>
			<div class="dsrow sub"><span>{t('settings.account.toppedUpBalance')}</span><span>{b.topped_up_balance}</span></div>
		{/each}
	{:else}
		<p class="hint">{t('settings.account.noBalance')}</p>
	{/if}
</div>

<style>
	.dsbal {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: 10px;
		background: var(--surface2);
	}
	.dsrow {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
	}
	.dsrow b {
		font-variant-numeric: tabular-nums;
	}
	.dsrow.sub {
		font-size: 12px;
		color: var(--dim);
	}
	.hint {
		margin: 0 0 10px;
		font-size: 12px;
		color: var(--dim);
	}
</style>
