<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { fetchAccountInfo, fetchUsage, type AccountInfo, type PlanUsage } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import { fmtBalance } from '$lib/money';

	// The rail's account card: who is signed in, balance, and the active coding
	// plan's quota windows. Floats beside the account button (fixed, so the
	// sidebar can't clip it); the rail owns open / close.
	let {
		loggedIn,
		left,
		bottom,
		onEnter,
		onLeave,
		onManage
	}: {
		loggedIn: boolean;
		left: number;
		bottom: number;
		onEnter: () => void;
		onLeave: () => void;
		/** Open Settings → Account (sign in / manage). */
		onManage: () => void;
	} = $props();

	let account = $state<AccountInfo | null>(null);
	let usage = $state<PlanUsage | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);

	// Refetch on every open: balance moves with each call.
	$effect(() => {
		if (!loggedIn) return;
		loading = true;
		Promise.all([fetchAccountInfo(), fetchUsage().catch(() => null)])
			.then(([a, u]) => {
				account = a;
				usage = u;
				error = null;
			})
			.catch((e) => (error = e instanceof Error ? e.message : String(e)))
			.finally(() => (loading = false));
	});

	function pct(used?: string, quota?: string): string {
		const u = Number(used ?? 0);
		const q = Number(quota ?? 0);
		if (!Number.isFinite(u) || !Number.isFinite(q) || q <= 0) return '0%';
		return `${Math.min(100, Math.max(0, (u / q) * 100))}%`;
	}
	function day(v?: string): string {
		const d = v ? new Date(v) : null;
		return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : '';
	}
</script>

{#snippet bar(label: string, used?: string, quota?: string)}
	<div class="bar">
		<div class="bar-h"><span>{label}</span><span class="num">{used ?? '0'} / {quota ?? '0'}</span></div>
		<div class="bar-track"><div class="bar-fill" style:width={pct(used, quota)}></div></div>
	</div>
{/snippet}

<div
	class="pop acct-card"
	role="dialog"
	aria-label={t('shell.account.title')}
	tabindex="-1"
	style:left="{left}px"
	style:bottom="{bottom}px"
	onmouseenter={onEnter}
	onmouseleave={onLeave}
>
	{#if !loggedIn}
		<div class="sec">
			<div class="name">{t('shell.notLoggedIn')}</div>
			<div class="sub">{t('shell.account.signInHint')}</div>
		</div>
		<button class="pop-row manage" onclick={onManage}>{t('shell.account.signIn')}<CaretRightIcon size={14} /></button>
	{:else if !account}
		<div class="sec"><div class="sub">{error ?? t('common.loading')}</div></div>
		<button class="pop-row manage" onclick={onManage}>{t('shell.account.manage')}<CaretRightIcon size={14} /></button>
	{:else}
		<div class="sec">
			<div class="name">{account.nickname || account.email || 'JuCode'}</div>
			{#if account.nickname && account.email}<div class="sub">{account.email}</div>{/if}
		</div>
		<div class="sec rows">
			<div class="kv">
				<span>{t('settings.usage.balance')}</span>
				<span class="num">{fmtBalance(account.balance)} {account.currency ?? ''}</span>
			</div>
			<div class="kv">
				<span>{t('settings.usage.plan')}</span>
				<span class:dim={!account.active_plan}>{account.active_plan?.name ?? t('settings.usage.noActivePlan')}</span>
			</div>
			{#if account.active_plan?.expire_at && day(account.active_plan.expire_at)}
				<div class="kv">
					<span></span>
					<span class="dim">{t('shell.account.expires', { date: day(account.active_plan.expire_at) })}</span>
				</div>
			{/if}
		</div>
		{#if usage?.has_active_plan}
			<div class="sec bars" class:stale={loading}>
				{@render bar(t('settings.usage.window5h'), usage.used_5h, usage.quota_5h)}
				{@render bar(t('settings.usage.weekly'), usage.used_weekly, usage.quota_weekly)}
				{@render bar(t('settings.usage.monthly'), usage.used_monthly, usage.quota_monthly)}
			</div>
		{/if}
		<button class="pop-row manage" onclick={onManage}>{t('shell.account.manage')}<CaretRightIcon size={14} /></button>
	{/if}
</div>

<style>
	.acct-card {
		position: fixed;
		z-index: 90;
		width: 280px;
		gap: 0;
		padding: 6px;
		user-select: text;
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.sec {
		padding: 10px 12px;
	}
	.sec + .sec {
		border-top: 1px solid var(--border);
	}
	.name {
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		margin-top: 2px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		overflow-wrap: anywhere;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.kv {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.kv span:last-child {
		color: var(--text);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kv span.dim,
	.kv .dim {
		color: var(--dim2);
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 10px;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.bars.stale {
		opacity: 0.6;
	}
	.bar-h {
		display: flex;
		justify-content: space-between;
		margin-bottom: 4px;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.bar-track {
		height: 4px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
	.manage {
		justify-content: space-between;
		margin-top: 2px;
		min-height: 34px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.manage:hover {
		color: var(--text);
	}
	.kv span:first-child {
		flex-shrink: 0;
		white-space: nowrap;
	}
</style>
