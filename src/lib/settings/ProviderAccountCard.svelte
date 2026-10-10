<script lang="ts">
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import WalletIcon from 'phosphor-svelte/lib/WalletIcon';
	import { t } from '$lib/i18n';
	import { fmtBalance } from '$lib/money';
	import Vendor from '$lib/Vendor.svelte';
	import AccountPanel from '$lib/AccountPanel.svelte';
	import ProviderBalance from '$lib/settings/ProviderBalance.svelte';
	import Button from '$lib/ui/Button.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import type { AccountInfo, DeepseekBalance } from '$lib/protocol';

	interface ModelCfg {
		name: string;
		context_window?: number;
		max_output_tokens?: number;
		reasoning_efforts?: string[];
	}
	interface Provider {
		id: string;
		name?: string;
		base_url: string;
		format: string;
		models: ModelCfg[];
		builtin: boolean;
		source?: 'catalog' | 'custom';
	}

	let {
		provider,
		authed,
		isDefault,
		open,
		loggingIn,
		jucodeBal,
		deepseekBal,
		deepseekTotal,
		keyInput = $bindable(),
		cap,
		onCardClick,
		onLogin,
		onLogout,
		onSaveKey,
		onSetDefault,
		onDelete
	}: {
		provider: Provider;
		authed: boolean;
		isDefault: boolean;
		open: boolean;
		loggingIn: boolean;
		jucodeBal: AccountInfo | null;
		deepseekBal: DeepseekBalance | null;
		deepseekTotal: { total_balance: string; currency: string } | null;
		keyInput: string;
		cap: (s: string) => string;
		onCardClick: (p: Provider, authed: boolean) => void;
		onLogin: () => void;
		onLogout: (id: string) => void;
		onSaveKey: (id: string) => void;
		onSetDefault: (p: Provider) => void;
		onDelete: (id: string) => void;
	} = $props();
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import { modelSetup } from '$lib/modelSetupState.svelte';
</script>

<div class="pcard">
	<button class="pcard-main" onclick={() => onCardClick(provider, authed)}>
		<span class="tile"><Vendor provider={provider.id} size={18} /></span>
		<span class="pcard-txt">
			<span class="pcard-id">{provider.name ?? cap(provider.id)}
				{#if isDefault}<span class="defbadge"><CheckCircleIcon size={11} /> {t('settings.account.default')}</span>{/if}
				{#if !provider.builtin}<span class="tagx">{provider.source === 'catalog' ? t('settings.account.byok') : t('settings.account.custom')}</span>{/if}
			</span>
			<span class="pcard-url">{#if provider.name}{provider.id} · {/if}{provider.base_url}</span>
		</span>
		<span class="pcard-right">
			{#if provider.id === 'jucode' && loggingIn && !authed}
				<span class="bal wait"><span class="spin"></span> {t('settings.account.authorizing')}</span>
			{:else if authed && provider.id === 'jucode' && jucodeBal}
				<span class="bal"><WalletIcon size={12} /> {fmtBalance(jucodeBal.balance)} {jucodeBal.currency ?? ''}</span>
			{:else if authed && provider.id === 'deepseek' && deepseekTotal}
				<span class="bal"><WalletIcon size={12} /> {fmtBalance(deepseekTotal.total_balance)} {deepseekTotal.currency}</span>
			{:else if authed}
				<span class="stat ok">{provider.id === 'jucode' ? t('settings.account.loggedIn') : t('settings.account.keyed')}</span>
			{:else}
				<span class="stat">{provider.id === 'jucode' ? t('settings.account.notLoggedIn') : t('settings.account.notKeyed')}</span>
			{/if}
			{#if provider.id === 'jucode' && !authed}
				<SignInIcon size={15} class="dimx" />
			{:else}
				<CaretDownIcon size={16} class="chev {open ? 'up' : ''}" />
			{/if}
		</span>
	</button>

	{#if open}
		<div class="pcard-body">
			{#if provider.id === 'jucode'}
				<AccountPanel />
				<div class="cardact">
					{#if !isDefault}<Button variant="secondary" size="sm" onclick={() => onSetDefault(provider)}>{t('settings.account.setDefault')}</Button>{/if}
					<Button size="sm" onclick={() => (modelSetup.open = true)}><ListChecksIcon size={13} /> {t('shell.modelSetup.manage')}</Button>
					<Button variant="primary" size="sm" onclick={onLogin}><SignInIcon size={13} /> {t('settings.account.relogin')}</Button>
					<Button variant="danger" size="sm" onclick={() => onLogout('jucode')}><SignOutIcon size={13} /> {t('settings.account.logout')}</Button>
				</div>
			{:else}
				{#if provider.id === 'deepseek' && authed}
					<ProviderBalance balance={deepseekBal} />
				{/if}
				<div class="ekey">
					<TextField bind:value={keyInput} type="password" placeholder={t('settings.account.keyPlaceholder', { id: provider.id })} mono />
					<Button variant="primary" size="sm" onclick={() => onSaveKey(provider.id)}>{authed ? t('settings.account.updateKey') : t('settings.account.saveKey')}</Button>
				</div>
				{#if authed || !provider.builtin}
				<div class="erow end">
					{#if authed && !isDefault}<Button variant="secondary" size="sm" onclick={() => onSetDefault(provider)}>{t('settings.account.setDefault')}</Button>{/if}
					{#if authed}<Button variant="ghost" size="sm" onclick={() => onLogout(provider.id)}><SignOutIcon size={13} /> {t('settings.account.clearKey')}</Button>{/if}
					{#if !provider.builtin}<Button variant="danger" size="sm" onclick={() => onDelete(provider.id)}><TrashIcon size={13} /> {t('common.delete')}</Button>{/if}
				</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* A row of the Providers card (SettingsSection draws the frame and the
	   hairlines between rows); the clip keeps the hover fill in its corners. */
	.pcard {
		overflow: hidden;
	}
	.pcard-main {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 60px;
		padding: 12px 18px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		min-width: 0;
	}
	.pcard-main:hover {
		background: var(--surface);
	}
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--r-md);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.pcard-txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.pcard-id {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.tagx {
		font-size: var(--fs-2xs);
		font-weight: 500;
		color: var(--dim2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-xs);
		padding: 0 5px;
	}
	.pcard-url {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-full);
		padding: 2px 9px;
		flex-shrink: 0;
	}
	.stat.ok {
		color: var(--ok);
		border-color: color-mix(in oklab, var(--ok) 35%, transparent);
		background: color-mix(in oklab, var(--ok) 12%, transparent);
	}
	.pcard-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.bal {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--ok);
		font-variant-numeric: tabular-nums;
	}
	.bal.wait {
		color: var(--dim);
		font-weight: 500;
	}
	.defbadge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: var(--fs-2xs);
		font-weight: 600;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: var(--r-full);
		padding: 1px 7px;
	}
	:global(.pcard .chev) {
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-spring);
	}
	:global(.pcard .chev.up) {
		transform: rotate(180deg);
	}
	:global(.pcard .dimx) {
		color: var(--dim2);
	}
	.pcard-body {
		padding: 14px 18px;
		border-top: 1px solid var(--hairline);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.cardact {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
	}
	.erow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.erow.end {
		justify-content: flex-end;
		gap: 8px;
	}
	.spin {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		flex: none;
	}
	.ekey {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.ekey :global(.tf) {
		flex: 1;
	}
	.defbadge,
	.tagx {
		flex-shrink: 0;
		white-space: nowrap;
	}
</style>
