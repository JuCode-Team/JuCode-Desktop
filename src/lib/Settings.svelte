<script lang="ts">
	import { onMount } from 'svelte';
	import { X, LogIn, Check, Cpu, KeyRound, SlidersHorizontal } from 'lucide-svelte';
	import { readConfig, writeConfig, readAuthProviders, setAuthKey, listProviders, sendOp } from '$lib/protocol';
	import Vendor from '$lib/Vendor.svelte';
	import EffortSlider from '$lib/EffortSlider.svelte';

	let { sessionId, onClose }: { sessionId: string; onClose: () => void } = $props();

	interface ModelCfg {
		name: string;
		context_window?: number;
		reasoning_efforts?: string[];
	}
	let cfg = $state<Record<string, any>>({});
	let providers = $state<string[]>([]);
	let builtinProviders = $state<{ id: string; base_url: string; models: ModelCfg[] }[]>([]);
	let newProvider = $state('');
	let newKey = $state('');
	let saved = $state(false);
	let section = $state<'model' | 'account' | 'behavior'>('model');

	const models = $derived<ModelCfg[]>(Array.isArray(cfg.models) ? cfg.models : []);
	const selModel = $derived(models.find((m) => m.name === cfg.model));
	const efforts = $derived(selModel?.reasoning_efforts ?? []);
	const fmt = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

	const NAV = [
		{ key: 'model', label: '模型与推理', icon: Cpu },
		{ key: 'account', label: '账户与密钥', icon: KeyRound },
		{ key: 'behavior', label: '行为', icon: SlidersHorizontal }
	] as const;

	onMount(async () => {
		cfg = await readConfig();
		providers = await readAuthProviders();
		builtinProviders = await listProviders().catch(() => []);
		newProvider = String(cfg.provider ?? 'jucode');
	});

	// Switching the active provider swaps in its default base_url and model table,
	// so the engine doesn't keep using the previous provider's models.
	function switchProvider(id: string) {
		const p = builtinProviders.find((x) => x.id === id);
		if (!p) return;
		cfg.provider = id;
		cfg.base_url = p.base_url;
		cfg.models = p.models;
		newProvider = id;
		const first = p.models[0];
		if (first) {
			cfg.model = first.name;
			const efs = first.reasoning_efforts ?? [];
			cfg.reasoning_effort = efs.includes('high') ? 'high' : (efs[Math.floor(efs.length / 2)] ?? '');
		}
	}

	function pickModel(name: string) {
		cfg.model = name;
		const efs = models.find((m) => m.name === name)?.reasoning_efforts ?? [];
		if (efs.length && !efs.includes(cfg.reasoning_effort))
			cfg.reasoning_effort = efs.includes('high') ? 'high' : efs[Math.floor(efs.length / 2)];
	}

	async function save() {
		await writeConfig({
			provider: cfg.provider,
			base_url: cfg.base_url,
			models: cfg.models,
			model: cfg.model,
			reasoning_effort: cfg.reasoning_effort,
			compact_model: cfg.compact_model,
			compaction_threshold_tokens: Number(cfg.compaction_threshold_tokens) || 0,
			retry_attempts: Number(cfg.retry_attempts) || 0,
			connect_timeout_seconds: Number(cfg.connect_timeout_seconds) || 0,
			read_timeout_seconds: Number(cfg.read_timeout_seconds) || 0,
			include_project_instructions: !!cfg.include_project_instructions
		});
		saved = true;
		setTimeout(() => (saved = false), 1500);
	}
	async function saveKey() {
		if (!newProvider.trim() || !newKey.trim()) return;
		await setAuthKey(newProvider.trim(), newKey.trim());
		providers = await readAuthProviders();
		newKey = '';
	}
	function login() {
		sendOp(sessionId, { op: 'command', input: '/login' });
		onClose();
	}
</script>

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="sheet" role="dialog" tabindex="-1" aria-label="Settings">
		<aside class="nav">
			<div class="nav-title">设置</div>
			{#each NAV as n (n.key)}
				<button class="nav-item" class:on={section === n.key} onclick={() => (section = n.key)}>
					<n.icon size={16} /><span>{n.label}</span>
				</button>
			{/each}
		</aside>

		<div class="main">
			<button class="x" onclick={onClose} aria-label="close"><X size={17} /></button>

			<div class="scroll">
				{#if section === 'model'}
					<h3>默认模型</h3>
					<p class="hint">新建会话使用的模型,当前会话可在顶部即时切换。</p>
					<div class="models">
						{#each models as m (m.name)}
							<button class="mrow" class:on={m.name === cfg.model} onclick={() => pickModel(m.name)}>
								<Vendor model={m.name} size={18} />
								<span class="mname">{m.name}</span>
								{#if m.context_window}<span class="mctx">{fmt(m.context_window)}</span>{/if}
								{#if m.name === cfg.model}<Check size={15} class="mcheck" />{/if}
							</button>
						{/each}
						{#if models.length === 0}<div class="empty">未配置模型,请先登录。</div>{/if}
					</div>

					{#if efforts.length}
						<h3 class="mt">思考强度</h3>
						<div class="card pad">
							<EffortSlider {efforts} current={cfg.reasoning_effort} onChange={(ef) => (cfg.reasoning_effort = ef)} />
						</div>
					{/if}

					<h3 class="mt">压缩模型</h3>
					<p class="hint">上下文压缩时使用的模型。</p>
					<select class="select" bind:value={cfg.compact_model}>
						{#each models as m (m.name)}<option value={m.name}>{m.name}</option>{/each}
					</select>
				{:else if section === 'account'}
					<h3>Provider</h3>
					<p class="hint">切换后下方"默认模型"会变成该 provider 的模型；记得为它配置 API key。</p>
					<div class="prov-grid">
						{#each builtinProviders as p (p.id)}
							<button class="prov" class:on={cfg.provider === p.id} onclick={() => switchProvider(p.id)}>
								<Vendor model={p.models[0]?.name ?? p.id} size={18} />
								<span class="prov-id">{p.id}</span>
								<span class="prov-url">{p.base_url}</span>
								{#if cfg.provider === p.id}<Check size={15} class="mcheck" />{/if}
							</button>
						{/each}
					</div>

					<h3 class="mt">账户</h3>
					<button class="btn primary wide" onclick={login}><LogIn size={15} /> 登录 JuCode（OAuth）</button>
					<div class="providers">
						<span class="plabel">已保存密钥</span>
						{#if providers.length}
							{#each providers as p (p)}<span class="ptag"><KeyRound size={12} />{p}</span>{/each}
						{:else}
							<span class="pnone">无</span>
						{/if}
					</div>

					<h3 class="mt">手动添加密钥</h3>
					<div class="card pad form">
						<label class="field"><span>Provider</span><input bind:value={newProvider} placeholder="jucode / openai" /></label>
						<label class="field"><span>API key</span><input type="password" bind:value={newKey} placeholder="sk-…" /></label>
						<button class="btn" onclick={saveKey} disabled={!newProvider.trim() || !newKey.trim()}>保存密钥</button>
					</div>
				{:else}
					<h3>行为</h3>
					<div class="grid">
						<label class="field col"><span>压缩阈值（tokens）</span><input type="number" bind:value={cfg.compaction_threshold_tokens} /></label>
						<label class="field col"><span>重试次数</span><input type="number" bind:value={cfg.retry_attempts} /></label>
						<label class="field col"><span>连接超时（秒）</span><input type="number" bind:value={cfg.connect_timeout_seconds} /></label>
						<label class="field col"><span>读取超时（秒）</span><input type="number" bind:value={cfg.read_timeout_seconds} /></label>
					</div>
					<div class="card pad toggle-row">
						<div>
							<div class="trow-title">包含项目说明</div>
							<div class="trow-sub">加载 AGENTS.md 等项目级指令。</div>
						</div>
						<button
							class="switch"
							class:on={cfg.include_project_instructions}
							role="switch"
							aria-checked={!!cfg.include_project_instructions}
							aria-label="include project instructions"
							onclick={() => (cfg.include_project_instructions = !cfg.include_project_instructions)}
						><span class="knob"></span></button>
					</div>
				{/if}
			</div>

			<div class="foot">
				<span class="hint">更改对新会话生效。</span>
				<button class="btn primary" onclick={save}>{#if saved}<Check size={15} /> 已保存{:else}保存{/if}</button>
			</div>
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
		width: min(760px, 94vw);
		height: min(560px, 86vh);
		display: flex;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	.nav {
		width: 188px;
		flex-shrink: 0;
		background: var(--sidebar);
		border-right: 1px solid var(--hairline);
		padding: 18px 12px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.nav-title {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 17px;
		padding: 4px 10px 14px;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
	}
	.nav-item:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.nav-item.on {
		background: var(--surface2);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		position: relative;
	}
	.x {
		position: absolute;
		top: 14px;
		right: 16px;
		display: inline-flex;
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		z-index: 2;
	}
	.x:hover {
		color: var(--text);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 22px 22px 18px;
	}
	h3 {
		margin: 0 0 4px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	h3.mt {
		margin-top: 26px;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--dim);
	}
	.models {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.prov-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 4px;
	}
	.prov {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 9px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.prov:hover {
		background: var(--surface2);
	}
	.prov.on {
		border-color: color-mix(in oklab, var(--accent) 50%, transparent);
		background: var(--accent-soft);
	}
	.prov-id {
		font-weight: 600;
		text-transform: capitalize;
	}
	.prov-url {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: right;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 9px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.mrow:hover {
		background: var(--surface2);
	}
	.mrow.on {
		border-color: color-mix(in oklab, var(--accent) 50%, transparent);
		background: var(--accent-soft);
	}
	.mname {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mctx {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
	}
	:global(.mcheck) {
		color: var(--accent-bright);
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.card.pad {
		padding: 4px;
	}
	.select {
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 9px 11px;
		font-size: 13px;
		font-family: var(--font-mono);
		outline: none;
	}
	.select:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		padding: 9px 14px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
	}
	.btn:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
	.btn.wide {
		width: 100%;
		justify-content: center;
	}
	.providers {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 14px;
	}
	.plabel {
		font-size: 12px;
		color: var(--dim);
	}
	.ptag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
	}
	.pnone {
		font-size: 12px;
		color: var(--dim2);
	}
	.form {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 11px;
		align-items: flex-start;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13px;
		width: 100%;
	}
	.field > span {
		flex: 1;
		color: var(--text);
	}
	.field input {
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 8px 10px;
		font-size: 13px;
		font-family: var(--font-mono);
		min-width: 220px;
		outline: none;
	}
	.field input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-bottom: 16px;
	}
	.field.col {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.field.col > span {
		flex: none;
		font-size: 12px;
		color: var(--dim);
	}
	.field.col input {
		width: 100%;
		min-width: 0;
	}
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 14px;
	}
	.trow-title {
		font-size: 13px;
	}
	.trow-sub {
		font-size: 12px;
		color: var(--dim);
		margin-top: 2px;
	}
	.switch {
		width: 40px;
		height: 23px;
		border-radius: 999px;
		border: none;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		padding: 0;
		position: relative;
		flex-shrink: 0;
		transition: background 0.15s;
	}
	.switch.on {
		background: var(--accent);
		box-shadow: none;
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 17px;
		height: 17px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
	}
	.switch.on .knob {
		transform: translateX(17px);
	}
	.empty {
		padding: 14px;
		font-size: 13px;
		color: var(--dim2);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 22px;
		border-top: 1px solid var(--hairline);
	}
</style>
