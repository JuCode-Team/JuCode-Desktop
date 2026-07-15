<script lang="ts">
	import { LogIn, LogOut, Trash2, CircleCheck, ChevronDown, Wallet } from 'lucide-svelte';
	import { t } from '$lib/i18n';
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
		base_url: string;
		format: string;
		models: ModelCfg[];
		builtin: boolean;
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
</script>

<div class="pcard" class:def={isDefault}>
	<button class="pcard-main" onclick={() => onCardClick(provider, authed)}>
		<span class="tile"><Vendor model={provider.models[0]?.name ?? provider.id} size={18} /></span>
		<span class="pcard-txt">
			<span class="pcard-id">{cap(provider.id)}
				{#if isDefault}<span class="defbadge"><CircleCheck size={11} /> {t('settings.account.default')}</span>{/if}
				{#if !provider.builtin}<span class="tagx">{t('settings.account.custom')}</span>{/if}
			</span>
			<span class="pcard-url">{provider.base_url}</span>
		</span>
		<span class="pcard-right">
			{#if provider.id === 'jucode' && loggingIn && !authed}
				<span class="bal wait"><span class="spin"></span> {t('settings.account.authorizing')}</span>
			{:else if authed && provider.id === 'jucode' && jucodeBal}
				<span class="bal"><Wallet size={12} /> {jucodeBal.balance ?? '0'} {jucodeBal.currency ?? ''}</span>
			{:else if authed && provider.id === 'deepseek' && deepseekTotal}
				<span class="bal"><Wallet size={12} /> {deepseekTotal.total_balance} {deepseekTotal.currency}</span>
			{:else if authed}
				<span class="stat ok">{provider.id === 'jucode' ? t('settings.account.loggedIn') : t('settings.account.keyed')}</span>
			{:else}
				<span class="stat">{provider.id === 'jucode' ? t('settings.account.notLoggedIn') : t('settings.account.notKeyed')}</span>
			{/if}
			{#if provider.id === 'jucode' && !authed}
				<LogIn size={15} class="dimx" />
			{:else}
				<ChevronDown size={16} class="chev {open ? 'up' : ''}" />
			{/if}
		</span>
	</button>

	{#if open}
		<div class="pcard-body">
			{#if provider.id === 'jucode'}
				<AccountPanel />
				<div class="cardact">
					{#if !isDefault}<Button variant="secondary" size="sm" onclick={() => onSetDefault(provider)}>{t('settings.account.setDefault')}</Button>{/if}
					<Button variant="primary" size="sm" onclick={onLogin}><LogIn size={13} /> {t('settings.account.relogin')}</Button>
					<Button variant="danger" size="sm" onclick={() => onLogout('jucode')}><LogOut size={13} /> {t('settings.account.logout')}</Button>
				</div>
			{:else}
				{#if provider.id === 'deepseek' && authed}
					<ProviderBalance balance={deepseekBal} />
				{/if}
				<div class="ekey">
					<TextField bind:value={keyInput} type="password" placeholder={t('settings.account.keyPlaceholder', { id: provider.id })} mono />
					<Button variant="primary" size="sm" onclick={() => onSaveKey(provider.id)}>{authed ? t('settings.account.updateKey') : t('settings.account.saveKey')}</Button>
				</div>
				<div class="erow end">
					{#if authed && !isDefault}<Button variant="secondary" size="sm" onclick={() => onSetDefault(provider)}>{t('settings.account.setDefault')}</Button>{/if}
					{#if authed}<Button variant="ghost" size="sm" onclick={() => onLogout(provider.id)}><LogOut size={13} /> {t('settings.account.clearKey')}</Button>{/if}
					{#if !provider.builtin}<Button variant="danger" size="sm" onclick={() => onDelete(provider.id)}><Trash2 size={13} /> {t('common.delete')}</Button>{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.pcard {
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
		transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
	}
	.pcard.def {
		border-color: color-mix(in oklab, var(--accent) 45%, transparent);
	}
	.pcard-main {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		min-width: 0;
	}
	.pcard-main:hover {
		background: var(--surface2);
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
		font-size: 13px;
		font-weight: 600;
	}
	.tagx {
		font-size: 10px;
		font-weight: 500;
		color: var(--dim2);
		border: 1px solid var(--hairline);
		border-radius: 4px;
		padding: 0 5px;
	}
	.pcard-url {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.stat {
		font-size: 11px;
		color: var(--dim2);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 999px;
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
		font-size: 12px;
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
		font-size: 10px;
		font-weight: 600;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: 999px;
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
		padding: 12px;
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
		animation: spin 0.8s linear infinite;
		flex: none;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.ekey {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.ekey :global(.tf) {
		flex: 1;
	}
</style>
