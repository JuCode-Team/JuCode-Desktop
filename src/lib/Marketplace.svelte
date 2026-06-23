<script lang="ts">
	import { onMount } from 'svelte';
	import { X, Search, Download, LoaderCircle, RefreshCw } from 'lucide-svelte';
	import { fetchMarketplace, sendOp, type MarketSkill } from '$lib/protocol';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';

	let { sessionId, onClose }: { sessionId: string; onClose: () => void } = $props();

	let skills = $state<MarketSkill[]>([]);
	let loading = $state(true);
	let error = $state('');
	let query = $state('');
	let tag = $state('');
	let installing = $state<Record<string, boolean>>({});

	const tags = $derived([...new Set(skills.flatMap((s) => s.tags))].sort());
	const filtered = $derived(
		skills.filter((s) => {
			const q = query.trim().toLowerCase();
			const matchQ = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
			const matchT = !tag || s.tags.includes(tag);
			return matchQ && matchT;
		})
	);

	async function load() {
		loading = true;
		error = '';
		try {
			skills = await fetchMarketplace();
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function install(s: MarketSkill) {
		installing[s.id] = true;
		sendOp(sessionId, { op: 'command', input: `/skills install ${s.id}` });
		setTimeout(() => (installing[s.id] = false), 2500);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="sheet" role="dialog" aria-modal="true" tabindex="-1" aria-label="扩展市场">
		<div class="head">
			<div>
				<h2>扩展市场</h2>
				<p>为 JuCode 安装技能扩展。</p>
			</div>
			<IconButton onclick={onClose} label="close"><X size={18} /></IconButton>
		</div>

		<div class="toolbar">
			<div class="search">
				<Search size={15} />
				<input bind:value={query} placeholder="搜索扩展…" />
			</div>
			<Button variant="secondary" size="icon" onclick={load} title="刷新"><RefreshCw size={14} /></Button>
		</div>

		{#if tags.length}
			<div class="chips">
				<Chip selected={tag === ''} onclick={() => (tag = '')}>全部</Chip>
				{#each tags as t (t)}
					<Chip selected={tag === t} onclick={() => (tag = t)}>{t}</Chip>
				{/each}
			</div>
		{/if}

		<div class="body">
			{#if loading}
				<div class="state"><LoaderCircle size={20} class="spin" /> 加载中…</div>
			{:else if error}
				<div class="state err">{error.includes('401') || error.toLowerCase().includes('unauth') ? '需要登录 JuCode 账号后才能浏览市场（设置 → 登录）。' : `加载失败：${error}`}</div>
			{:else if filtered.length === 0}
				<div class="state">没有匹配的扩展</div>
			{:else}
				<div class="grid">
					{#each filtered as s (s.id)}
						<div class="card">
							<div class="card-top">
								<span class="name">{s.name}</span>
								{#if s.isDefault}<span class="badge">默认</span>{/if}
							</div>
							<p class="desc">{s.description}</p>
							<div class="card-foot">
								<div class="tagrow">
									{#each s.tags.slice(0, 3) as t (t)}<span class="t">{t}</span>{/each}
								</div>
								<Button variant="primary" size="sm" disabled={installing[s.id]} onclick={() => install(s)}>
									{#if installing[s.id]}<LoaderCircle size={14} class="spin" /> 安装中{:else}<Download size={14} /> 安装{/if}
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
	}
	.sheet {
		width: min(820px, 94vw);
		height: min(640px, 88vh);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 18px 20px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 800;
	}
	.head p {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--dim);
	}
	.toolbar {
		display: flex;
		gap: 8px;
		padding: 14px 20px 8px;
	}
	.search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--dim);
	}
	.search input {
		flex: 1;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 14px;
		padding: 9px 0;
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px 20px 10px;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 6px 20px 20px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 12px;
	}
	.card {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		padding: 14px;
	}
	.card-top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.name {
		font-weight: 600;
		font-size: 14px;
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: 10px;
		color: var(--accent-bright);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: 999px;
		padding: 1px 8px;
	}
	.desc {
		margin: 8px 0 12px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--dim);
		flex: 1;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.card-foot {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.tagrow {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		overflow: hidden;
	}
	.t {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 4px;
		padding: 1px 6px;
	}
	.state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 50px 20px;
		color: var(--dim);
		font-size: 14px;
		text-align: center;
	}
	.state.err {
		color: var(--err);
	}
</style>
