<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw, Wallet, Package, Activity } from 'lucide-svelte';
	import {
		fetchAccountInfo,
		fetchUsage,
		fetchUsageLogs,
		type AccountInfo,
		type PlanUsage,
		type UsageLogRow
	} from '$lib/protocol';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let account = $state<AccountInfo | null>(null);
	let usage = $state<PlanUsage | null>(null);
	let logs = $state<UsageLogRow[]>([]);

	async function load() {
		loading = true;
		error = null;
		try {
			const [a, u, l] = await Promise.all([
				fetchAccountInfo(),
				fetchUsage().catch(() => null),
				fetchUsageLogs().catch(() => [])
			]);
			account = a;
			usage = u;
			logs = l;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function fmtTime(v?: string): string {
		if (!v) return '';
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
	}

	function pct(used?: string, quota?: string): string {
		const u = Number(used ?? 0);
		const q = Number(quota ?? 0);
		if (!Number.isFinite(u) || !Number.isFinite(q) || q <= 0) return '0%';
		return `${Math.min(100, Math.max(0, (u / q) * 100))}%`;
	}

	onMount(load);
</script>

{#snippet bar(label: string, used?: string, quota?: string)}
	<div class="bar">
		<div class="bar-h"><span>{label}</span><span class="bar-v">{used ?? '0'} / {quota ?? '0'}</span></div>
		<div class="bar-track"><div class="bar-fill" style:width={pct(used, quota)}></div></div>
	</div>
{/snippet}

<div class="group">
	<div class="glabel-row">
		<div class="glabel">账户用量</div>
		<button class="refresh" onclick={load} disabled={loading} aria-label="刷新">
			<RefreshCw size={13} class={loading ? 'spin' : ''} />
		</button>
	</div>

	{#if error}
		<p class="hint err">{error}</p>
	{:else if loading && !account}
		<p class="hint">加载中…</p>
	{:else if account}
		<div class="cards">
			<div class="card">
				<span class="ci"><Wallet size={15} /></span>
				<span class="cl">余额</span>
				<span class="cv">{account.balance ?? '0'} {account.currency ?? ''}</span>
			</div>
			<div class="card">
				<span class="ci"><Package size={15} /></span>
				<span class="cl">套餐</span>
				<span class="cv">{account.active_plan?.name ?? '无活跃套餐'}</span>
			</div>
		</div>

		{#if usage?.has_active_plan}
			<div class="bars">
				{@render bar('5 小时', usage.used_5h, usage.quota_5h)}
				{@render bar('本周', usage.used_weekly, usage.quota_weekly)}
				{@render bar('本月', usage.used_monthly, usage.quota_monthly)}
			</div>
		{/if}

		<div class="logs">
			<div class="logs-h"><Activity size={13} /> 最近调用</div>
			{#if logs.length === 0}
				<p class="hint">暂无调用记录</p>
			{:else}
				{#each logs.slice(0, 8) as l, i (l.created_at ?? i)}
					<div class="logrow">
						<span class="lm">{l.model ?? '-'}</span>
						<span class="lt">in {l.tokens_in ?? 0} · out {l.tokens_out ?? 0}</span>
						<span class="lc">{l.cost_final ?? '0'}</span>
						<span class="ld">{fmtTime(l.created_at)}</span>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.glabel-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.refresh {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--dim);
		cursor: pointer;
	}
	.refresh:hover {
		color: var(--text);
	}
	:global(.refresh .spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.hint.err {
		color: var(--danger, #e5534b);
	}
	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 8px;
	}
	.card {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		align-items: center;
		gap: 2px 10px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
	}
	.ci {
		grid-row: 1 / 3;
		color: var(--accent);
		display: inline-flex;
	}
	.cl {
		font-size: 12px;
		color: var(--dim);
	}
	.cv {
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}
	.bar-h {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--dim);
		margin-bottom: 4px;
	}
	.bar-v {
		font-variant-numeric: tabular-nums;
	}
	.bar-track {
		height: 6px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
	}
	.logs {
		margin-top: 14px;
	}
	.logs-h {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--dim);
		margin-bottom: 6px;
	}
	.logrow {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 10px;
		align-items: center;
		padding: 6px 0;
		border-top: 1px solid var(--border);
		font-size: 12px;
	}
	.lm {
		color: var(--text);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lt {
		color: var(--dim);
	}
	.lc {
		color: var(--accent);
	}
	.ld {
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
</style>
