<script lang="ts">
	import { onMount } from 'svelte';
	import { X, LogIn, Check, Cpu, KeyRound, SlidersHorizontal, Plus, Zap } from 'lucide-svelte';
	import { readConfig, writeConfig, readAuthProviders, setAuthKey, listProviders, sendOp } from '$lib/protocol';
	import Vendor from '$lib/Vendor.svelte';
	import EffortSlider from '$lib/EffortSlider.svelte';

	let { sessionId, onClose }: { sessionId: string; onClose: () => void } = $props();

	interface ModelCfg {
		name: string;
		context_window?: number;
		max_output_tokens?: number;
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
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

	const NAV = [
		{ key: 'model', label: '模型与推理', icon: Cpu, sub: '默认模型与思考强度' },
		{ key: 'account', label: '账户与密钥', icon: KeyRound, sub: 'Provider、登录与密钥' },
		{ key: 'behavior', label: '行为', icon: SlidersHorizontal, sub: '压缩、网络与项目说明' }
	] as const;
	const meta = $derived(NAV.find((n) => n.key === section)!);

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
			<div class="brand"><span class="dot"></span>JuCode</div>
			<div class="nav-list">
				{#each NAV as n (n.key)}
					<button class="nav-item" class:on={section === n.key} onclick={() => (section = n.key)}>
						<span class="nav-ico"><n.icon size={16} /></span>
						<span class="nav-txt">
							<span class="nav-label">{n.label}</span>
							<span class="nav-sub">{n.sub}</span>
						</span>
					</button>
				{/each}
			</div>
			<div class="nav-foot">设置 · 更改对新会话生效</div>
		</aside>

		<div class="main">
			<header class="head">
				<div>
					<h2>{meta.label}</h2>
					<p class="head-sub">{meta.sub}</p>
				</div>
				<button class="x" onclick={onClose} aria-label="close"><X size={18} /></button>
			</header>

			<div class="scroll">
				{#if section === 'model'}
					<div class="group">
						<div class="glabel">默认模型</div>
						<div class="cards">
							{#each models as m (m.name)}
								<button class="card-row mrow" class:on={m.name === cfg.model} onclick={() => pickModel(m.name)}>
									<span class="tile"><Vendor model={m.name} size={18} /></span>
									<span class="mname">{m.name}</span>
									<span class="pills">
										{#if m.context_window}<span class="pill">{fmt(m.context_window)} ctx</span>{/if}
										{#if m.max_output_tokens}<span class="pill ghost">{fmt(m.max_output_tokens)} out</span>{/if}
									</span>
									<span class="radio" class:on={m.name === cfg.model}>{#if m.name === cfg.model}<Check size={13} />{/if}</span>
								</button>
							{/each}
							{#if models.length === 0}<div class="empty">未配置模型 · 先在「账户」选择 Provider 或登录</div>{/if}
						</div>
					</div>

					{#if efforts.length}
						<div class="group">
							<div class="glabel"><Zap size={12} /> 思考强度</div>
							<div class="card pad"><EffortSlider {efforts} current={cfg.reasoning_effort} onChange={(ef) => (cfg.reasoning_effort = ef)} /></div>
						</div>
					{/if}

					<div class="group">
						<div class="glabel">压缩模型</div>
						<p class="hint">上下文压缩时用于生成摘要的模型。</p>
						<select class="select" bind:value={cfg.compact_model}>
							{#each models as m (m.name)}<option value={m.name}>{m.name}</option>{/each}
						</select>
					</div>
				{:else if section === 'account'}
					<div class="group">
						<div class="glabel">Provider</div>
						<p class="hint">切换后默认模型会换成该 Provider 的模型,记得为它配置密钥。</p>
						<div class="cards">
							{#each builtinProviders as p (p.id)}
								<button class="card-row prov" class:on={cfg.provider === p.id} onclick={() => switchProvider(p.id)}>
									<span class="tile"><Vendor model={p.models[0]?.name ?? p.id} size={18} /></span>
									<span class="prov-txt">
										<span class="prov-id">{cap(p.id)}</span>
										<span class="prov-url">{p.base_url}</span>
									</span>
									<span class="keytag" class:has={providers.includes(p.id)}>
										{providers.includes(p.id) ? '已配密钥' : '未配密钥'}
									</span>
									<span class="radio" class:on={cfg.provider === p.id}>{#if cfg.provider === p.id}<Check size={13} />{/if}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="group">
						<div class="glabel">登录</div>
						<button class="btn primary wide" onclick={login}><LogIn size={15} /> 使用 JuCode 账号登录（OAuth）</button>
					</div>

					<div class="group">
						<div class="glabel">API 密钥</div>
						{#if providers.length}
							<div class="chips">
								{#each providers as p (p)}<span class="chip"><KeyRound size={12} />{p}</span>{/each}
							</div>
						{/if}
						<div class="card keyform">
							<input class="kin" bind:value={newProvider} placeholder="provider（如 deepseek）" />
							<input class="kin" type="password" bind:value={newKey} placeholder="API key · sk-…" />
							<button class="btn" onclick={saveKey} disabled={!newProvider.trim() || !newKey.trim()}><Plus size={14} /> 保存</button>
						</div>
					</div>
				{:else}
					<div class="group">
						<div class="glabel">上下文压缩</div>
						<div class="setlist">
							<label class="set">
								<span class="set-txt"><span class="set-title">压缩阈值（tokens）</span><span class="set-sub">0 表示按模型窗口的 75% 自动压缩</span></span>
								<input class="num" type="number" bind:value={cfg.compaction_threshold_tokens} />
							</label>
						</div>
					</div>
					<div class="group">
						<div class="glabel">网络</div>
						<div class="setlist">
							<label class="set">
								<span class="set-txt"><span class="set-title">重试次数</span></span>
								<input class="num" type="number" bind:value={cfg.retry_attempts} />
							</label>
							<label class="set">
								<span class="set-txt"><span class="set-title">连接超时（秒）</span></span>
								<input class="num" type="number" bind:value={cfg.connect_timeout_seconds} />
							</label>
							<label class="set">
								<span class="set-txt"><span class="set-title">读取超时（秒）</span></span>
								<input class="num" type="number" bind:value={cfg.read_timeout_seconds} />
							</label>
						</div>
					</div>
					<div class="group">
						<div class="glabel">项目</div>
						<div class="setlist">
							<div class="set">
								<span class="set-txt"><span class="set-title">包含项目说明</span><span class="set-sub">加载 AGENTS.md 等项目级指令</span></span>
								<button class="switch" class:on={cfg.include_project_instructions} role="switch" aria-checked={!!cfg.include_project_instructions} aria-label="include project instructions" onclick={() => (cfg.include_project_instructions = !cfg.include_project_instructions)}><span class="knob"></span></button>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<div class="foot">
				<span class="foot-hint">更改保存后对新建会话生效</span>
				<button class="btn primary" onclick={save}>{#if saved}<Check size={15} /> 已保存{:else}保存更改{/if}</button>
			</div>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
		animation: fade 0.14s ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.sheet {
		width: min(860px, 95vw);
		height: min(640px, 90vh);
		display: flex;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		animation: pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
	}

	/* ---------- nav ---------- */
	.nav {
		width: 218px;
		flex-shrink: 0;
		background: var(--sidebar);
		border-right: 1px solid var(--hairline);
		padding: 20px 12px 14px;
		display: flex;
		flex-direction: column;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 17px;
		letter-spacing: -0.01em;
		padding: 2px 10px 18px;
	}
	.brand .dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: linear-gradient(145deg, var(--accent-bright), var(--accent));
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.nav-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 9px 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		text-align: left;
		position: relative;
	}
	.nav-item:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.nav-item.on {
		background: var(--accent-soft);
		color: var(--text);
	}
	.nav-item.on::before {
		content: '';
		position: absolute;
		left: -12px;
		top: 9px;
		bottom: 9px;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: var(--accent-bright);
	}
	.nav-ico {
		display: inline-flex;
		color: inherit;
		opacity: 0.9;
		flex-shrink: 0;
	}
	.nav-item.on .nav-ico {
		color: var(--accent-bright);
	}
	.nav-txt {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.nav-label {
		font-size: 13px;
		font-weight: 500;
	}
	.nav-sub {
		font-size: 11px;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.nav-foot {
		font-size: 11px;
		color: var(--dim2);
		padding: 10px 10px 2px;
		border-top: 1px solid var(--hairline);
		margin-top: 10px;
	}

	/* ---------- main ---------- */
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 20px 22px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.head-sub {
		margin: 3px 0 0;
		font-size: 12.5px;
		color: var(--dim);
	}
	.x {
		display: inline-flex;
		padding: 6px;
		margin: -4px -4px 0 0;
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		border-radius: var(--r-sm);
	}
	.x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 8px 22px 20px;
	}

	.group {
		margin-top: 22px;
	}
	.glabel {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--dim2);
		margin-bottom: 10px;
	}
	.hint {
		margin: -4px 0 10px;
		font-size: 12px;
		color: var(--dim);
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.card-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.12s, background 0.12s;
	}
	.card-row:hover {
		background: var(--surface2);
		border-color: var(--border);
	}
	.card-row.on {
		border-color: color-mix(in oklab, var(--accent) 55%, transparent);
		background: var(--accent-soft);
	}
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 9px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.mname {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pills {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.pill {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 2px 8px;
	}
	.pill.ghost {
		color: var(--dim);
		background: var(--surface2);
	}
	.radio {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid var(--border);
		color: var(--on-accent);
		flex-shrink: 0;
	}
	.radio.on {
		background: var(--accent);
		border-color: var(--accent);
	}

	.prov-txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.prov-id {
		font-size: 13px;
		font-weight: 600;
	}
	.prov-url {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.keytag {
		font-size: 11px;
		color: var(--dim2);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		padding: 2px 9px;
		flex-shrink: 0;
	}
	.keytag.has {
		color: var(--ok);
		border-color: color-mix(in oklab, var(--ok) 35%, transparent);
		background: color-mix(in oklab, var(--ok) 12%, transparent);
	}

	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.card.pad {
		padding: 5px;
	}
	.select {
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 10px 11px;
		font-size: 13px;
		font-family: var(--font-mono);
		outline: none;
	}
	.select:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin-bottom: 10px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		color: var(--text);
	}
	.keyform {
		display: flex;
		gap: 8px;
		padding: 10px;
		align-items: center;
	}
	.kin {
		flex: 1;
		min-width: 0;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 9px 11px;
		font-size: 13px;
		font-family: var(--font-mono);
		outline: none;
	}
	.kin:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}

	.setlist {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}
	.set {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 13px 14px;
	}
	.set + .set {
		border-top: 1px solid var(--hairline);
	}
	.set-txt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.set-title {
		font-size: 13px;
	}
	.set-sub {
		font-size: 11.5px;
		color: var(--dim);
	}
	.num {
		width: 120px;
		flex-shrink: 0;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 8px 10px;
		font-size: 13px;
		font-family: var(--font-mono);
		outline: none;
		text-align: right;
	}
	.num:focus {
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
		flex-shrink: 0;
	}
	.btn:hover:not(:disabled) {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.btn.primary {
		background: linear-gradient(145deg, var(--accent-bright), var(--accent));
		border-color: transparent;
		color: var(--on-accent);
		font-weight: 600;
		box-shadow: 0 4px 14px var(--accent-soft);
	}
	.btn.wide {
		width: 100%;
		justify-content: center;
	}

	.switch {
		width: 42px;
		height: 24px;
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
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	.switch.on .knob {
		transform: translateX(18px);
	}
	.empty {
		padding: 18px;
		font-size: 13px;
		color: var(--dim2);
		text-align: center;
		border: 1px dashed var(--border);
		border-radius: var(--r-md);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 22px;
		border-top: 1px solid var(--hairline);
		background: var(--panel);
	}
	.foot-hint {
		font-size: 12px;
		color: var(--dim2);
	}
</style>
