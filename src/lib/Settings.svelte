<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { X, LogIn, LogOut, Cpu, KeyRound, SlidersHorizontal, Plus, Pencil, Trash2, Zap, CircleCheck } from 'lucide-svelte';
	import { readConfig, writeConfig, readAuthProviders, setAuthKey, removeAuthKey, listProviders, sendOp } from '$lib/protocol';
	import Vendor from '$lib/Vendor.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';

	let {
		sessionId,
		initialSection = 'model',
		onClose,
		onAuthChange
	}: {
		sessionId: string;
		initialSection?: 'model' | 'account' | 'behavior';
		onClose: () => void;
		onAuthChange?: () => void;
	} = $props();

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
	const CUSTOM_KEY = 'jucode-custom-providers';
	const FORMATS = [
		{ value: 'responses', label: 'Responses' },
		{ value: 'anthropic', label: 'Anthropic' }
	];

	let cfg = $state<Record<string, any>>({});
	let keyed = $state<string[]>([]);
	let builtin = $state<{ id: string; base_url: string; protocol: string; models: ModelCfg[] }[]>([]);
	let custom = $state<Provider[]>([]);
	let saved = $state(false);
	// Capture the opening section once; the prop doesn't change during the modal's life.
	let section = $state<'model' | 'account' | 'behavior'>(untrack(() => initialSection));

	// inline editor state
	let editing = $state<string | null>(null); // provider id, or '__new__'
	let keyInput = $state('');
	let form = $state<{ id: string; base_url: string; format: string; key: string; models: ModelCfg[] }>({ id: '', base_url: '', format: 'responses', key: '', models: [] });
	let mName = $state('');
	let mCtx = $state<number | undefined>();

	const models = $derived<ModelCfg[]>(Array.isArray(cfg.models) ? cfg.models : []);
	const efforts = $derived(models.find((m) => m.name === cfg.model)?.reasoning_efforts ?? []);
	const fmt = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

	const NAV = [
		{ key: 'model', label: '模型与推理', icon: Cpu, sub: '默认模型与思考强度' },
		{ key: 'account', label: '账户与 Provider', icon: KeyRound, sub: '登录、密钥与端点' },
		{ key: 'behavior', label: '行为', icon: SlidersHorizontal, sub: '压缩、网络与项目' }
	] as const;
	const meta = $derived(NAV.find((n) => n.key === section)!);

	const allProviders = $derived<Provider[]>([
		...builtin.map((b) => ({ id: b.id, base_url: b.base_url, models: b.models, format: b.protocol, builtin: true })),
		...custom
	]);
	const modelOpts = $derived(models.map((m) => ({ value: m.name, ...m })));
	const effortOpts = $derived(efforts.map((e) => ({ value: e, label: cap(e) })));

	onMount(async () => {
		cfg = await readConfig();
		if (cfg.compaction_threshold_percent == null) cfg.compaction_threshold_percent = 75;
		keyed = await readAuthProviders();
		builtin = await listProviders().catch(() => []);
		try {
			custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
		} catch {
			custom = [];
		}
	});

	// Keep reasoning effort valid for the selected model.
	$effect(() => {
		const efs = models.find((m) => m.name === cfg.model)?.reasoning_efforts ?? [];
		if (efs.length && !efs.includes(cfg.reasoning_effort)) cfg.reasoning_effort = efs.includes('high') ? 'high' : efs[Math.floor(efs.length / 2)];
	});

	function selectProvider(p: Provider) {
		cfg.provider = p.id;
		cfg.base_url = p.base_url;
		cfg.protocol = p.format;
		cfg.models = p.models;
		const first = p.models[0];
		if (first) cfg.model = first.name;
	}

	function toggleEdit(id: string) {
		editing = editing === id ? null : id;
		keyInput = '';
	}
	function openCreate() {
		editing = '__new__';
		form = { id: '', base_url: '', format: 'responses', key: '', models: [] };
		mName = '';
		mCtx = undefined;
	}
	function persistCustom() {
		localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
	}
	async function saveKey(id: string) {
		if (!keyInput.trim()) return;
		await setAuthKey(id, keyInput.trim());
		keyed = await readAuthProviders();
		keyInput = '';
		editing = null;
		onAuthChange?.();
	}
	// Logout (jucode) / clear stored key (other providers).
	async function logout(id: string) {
		await removeAuthKey(id);
		keyed = await readAuthProviders();
		onAuthChange?.();
	}
	function addFormModel() {
		if (!mName.trim()) return;
		form.models = [...form.models, { name: mName.trim(), context_window: Number(mCtx) || 128000, max_output_tokens: 8192, reasoning_efforts: [] }];
		mName = '';
		mCtx = undefined;
	}
	async function createProvider() {
		const id = form.id.trim();
		if (!id || !form.base_url.trim() || form.models.length === 0) return;
		custom = [...custom.filter((c) => c.id !== id), { id, base_url: form.base_url.trim(), format: form.format, models: form.models, builtin: false }];
		persistCustom();
		if (form.key.trim()) {
			await setAuthKey(id, form.key.trim());
			keyed = await readAuthProviders();
			onAuthChange?.();
		}
		editing = null;
	}
	function deleteProvider(id: string) {
		custom = custom.filter((c) => c.id !== id);
		persistCustom();
		editing = null;
	}

	async function save() {
		await writeConfig({
			provider: cfg.provider,
			base_url: cfg.base_url,
			protocol: cfg.protocol ?? '',
			models: cfg.models,
			model: cfg.model,
			reasoning_effort: cfg.reasoning_effort,
			compact_model: cfg.compact_model,
			compaction_threshold_percent: Number(cfg.compaction_threshold_percent) || 75,
			retry_attempts: Number(cfg.retry_attempts) || 0,
			connect_timeout_seconds: Number(cfg.connect_timeout_seconds) || 0,
			read_timeout_seconds: Number(cfg.read_timeout_seconds) || 0,
			include_project_instructions: !!cfg.include_project_instructions
		});
		saved = true;
		setTimeout(() => (saved = false), 1500);
	}
	function login() {
		sendOp(sessionId, { op: 'command', input: '/login' });
		onClose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="sheet" role="dialog" aria-modal="true" tabindex="-1" aria-label="设置">
		<aside class="nav">
			<div class="brand">JuCode</div>
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
		</aside>

		<div class="main">
			<header class="head">
				<div>
					<h2>{meta.label}</h2>
					<p class="head-sub">{meta.sub}</p>
				</div>
				<Button variant="ghost" size="sm" onclick={onClose}><X size={18} /></Button>
			</header>

			<div class="scroll">
				{#if section === 'model'}
					<div class="group">
						<div class="glabel">默认模型</div>
						<Select bind:value={cfg.model} options={modelOpts} placeholder="选择模型">
							{#snippet item(o)}
								<span class="tile sm"><Vendor model={o.value} size={15} /></span>
								<span class="mono ell">{o.value}</span>
								{#if o.context_window}<span class="pill">{fmt(o.context_window as number)}</span>{/if}
							{/snippet}
						</Select>
						{#if models.length === 0}<p class="hint mt">未配置模型 · 先在「账户」选择或登录 Provider。</p>{/if}
					</div>

					{#if effortOpts.length}
						<div class="group">
							<div class="glabel"><Zap size={12} /> 思考强度</div>
							<Segmented bind:value={cfg.reasoning_effort} options={effortOpts} />
						</div>
					{/if}

					<div class="group">
						<div class="glabel">压缩模型</div>
						<p class="hint">上下文压缩时生成摘要使用的模型。</p>
						<Select bind:value={cfg.compact_model} options={modelOpts} placeholder="选择模型">
							{#snippet item(o)}
								<span class="tile sm"><Vendor model={o.value} size={15} /></span>
								<span class="mono ell">{o.value}</span>
							{/snippet}
						</Select>
					</div>
				{:else if section === 'account'}
					<div class="group">
						<div class="glabel">Provider</div>
						<p class="hint">点选切换当前 Provider,「编辑」管理登录或密钥。</p>
						<div class="plist">
							{#each allProviders as p (p.id)}
								<div class="prow" class:active={cfg.provider === p.id}>
									<button class="prow-main" onclick={() => selectProvider(p)}>
										<span class="tile"><Vendor model={p.models[0]?.name ?? p.id} size={18} /></span>
										<span class="prow-txt">
											<span class="prow-id">{cap(p.id)}{#if !p.builtin}<span class="tagx">自定义</span>{/if}</span>
											<span class="prow-url">{p.base_url}</span>
										</span>
										{#if p.id === 'jucode'}
											<span class="stat" class:ok={keyed.includes('jucode')}>{keyed.includes('jucode') ? '已登录' : '未登录'}</span>
										{:else}
											<span class="stat" class:ok={keyed.includes(p.id)}>{keyed.includes(p.id) ? '已配密钥' : '未配密钥'}</span>
										{/if}
										{#if cfg.provider === p.id}<CircleCheck size={17} class="curchk" />{/if}
									</button>
									<IconButton onclick={() => toggleEdit(p.id)} label="edit"><Pencil size={14} /></IconButton>
								</div>

								{#if editing === p.id}
									<div class="peditor">
										{#if p.id === 'jucode'}
											<div class="erow">
												<span class="ehint">JuCode 使用账号登录(OAuth)。</span>
												<div class="ebtns">
													{#if keyed.includes('jucode')}
														<Button variant="danger" size="sm" onclick={() => logout('jucode')}><LogOut size={14} /> 退出登录</Button>
													{/if}
													<Button variant="primary" size="sm" onclick={login}><LogIn size={14} /> {keyed.includes('jucode') ? '重新登录' : '登录'}</Button>
												</div>
											</div>
										{:else}
											<div class="ekey">
												<TextField bind:value={keyInput} type="password" placeholder={`${p.id} API key · sk-…`} mono />
												<Button variant="primary" size="sm" onclick={() => saveKey(p.id)}>保存密钥</Button>
											</div>
											<div class="erow end">
												{#if keyed.includes(p.id)}
													<Button variant="ghost" size="sm" onclick={() => logout(p.id)}><LogOut size={13} /> 清除密钥</Button>
												{/if}
												{#if !p.builtin}
													<Button variant="danger" size="sm" onclick={() => deleteProvider(p.id)}><Trash2 size={13} /> 删除</Button>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
							{/each}
						</div>

						{#if editing === '__new__'}
							<div class="newprov">
								<div class="np-title">新建自定义 Provider</div>
								<div class="np-grid">
									<label class="np-f"><span>Provider ID</span><TextField bind:value={form.id} placeholder="例如 my-llm" /></label>
									<label class="np-f"><span>端点格式</span><Segmented bind:value={form.format} options={FORMATS} /></label>
								</div>
								<label class="np-f"><span>Base URL</span><TextField bind:value={form.base_url} mono placeholder="https://api.example.com/v1" /></label>
								<label class="np-f"><span>API key</span><TextField bind:value={form.key} type="password" mono placeholder="sk-…" /></label>
								<div class="np-models">
									<span class="np-mlabel">模型列表</span>
									{#each form.models as m (m.name)}
										<span class="mchip">{m.name} · {fmt(m.context_window)}<IconButton size="xs" onclick={() => (form.models = form.models.filter((x) => x !== m))} label="remove"><X size={11} /></IconButton></span>
									{/each}
									<div class="np-addm">
										<TextField bind:value={mName} mono placeholder="模型名" />
										<TextField bind:value={mCtx} type="number" align="right" placeholder="窗口" />
										<Button size="sm" onclick={addFormModel}><Plus size={13} /></Button>
									</div>
								</div>
								<div class="np-foot">
									<Button variant="ghost" size="sm" onclick={() => (editing = null)}>取消</Button>
									<Button variant="primary" size="sm" onclick={createProvider}>创建</Button>
								</div>
							</div>
						{:else}
							<button class="addprov" onclick={openCreate}><Plus size={15} /> 添加自定义 Provider</button>
						{/if}
					</div>
				{:else}
					<div class="group">
						<div class="glabel">上下文压缩</div>
						<div class="setlist">
							<div class="set">
								<span class="set-txt"><span class="set-title">压缩阈值</span><span class="set-sub">达到上下文窗口该百分比时自动压缩(10–95)</span></span>
								<span class="pct"><span class="pctin"><TextField bind:value={cfg.compaction_threshold_percent} type="number" align="right" /></span><span class="pctsign">%</span></span>
							</div>
						</div>
					</div>
					<div class="group">
						<div class="glabel">网络</div>
						<div class="setlist">
							<div class="set"><span class="set-txt"><span class="set-title">重试次数</span></span><span class="numw"><TextField bind:value={cfg.retry_attempts} type="number" align="right" /></span></div>
							<div class="set"><span class="set-txt"><span class="set-title">连接超时</span><span class="set-sub">秒</span></span><span class="numw"><TextField bind:value={cfg.connect_timeout_seconds} type="number" align="right" /></span></div>
							<div class="set"><span class="set-txt"><span class="set-title">读取超时</span><span class="set-sub">秒</span></span><span class="numw"><TextField bind:value={cfg.read_timeout_seconds} type="number" align="right" /></span></div>
						</div>
					</div>
					<div class="group">
						<div class="glabel">项目</div>
						<div class="setlist">
							<div class="set"><span class="set-txt"><span class="set-title">包含项目说明</span><span class="set-sub">加载 AGENTS.md 等项目级指令</span></span><Switch bind:checked={cfg.include_project_instructions} label="include project instructions" /></div>
						</div>
					</div>
				{/if}
			</div>

			<div class="foot">
				<span class="foot-hint">更改保存后对新建会话生效</span>
				<Button variant="primary" onclick={save}>{#if saved}<CircleCheck size={15} /> 已保存{:else}保存更改{/if}</Button>
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
		width: min(880px, 95vw);
		height: min(660px, 90vh);
		display: flex;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		animation: pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
	}
	.nav {
		width: 220px;
		flex-shrink: 0;
		background: var(--sidebar);
		border-right: 1px solid var(--hairline);
		padding: 22px 12px 14px;
		display: flex;
		flex-direction: column;
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 17px;
		letter-spacing: -0.01em;
		padding: 2px 10px 20px;
	}
	.nav-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
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
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 8px 22px 22px;
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
		margin: 0 0 10px;
		font-size: 12px;
		color: var(--dim);
	}
	.hint.mt {
		margin-top: 8px;
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
	.tile.sm {
		width: 22px;
		height: 22px;
		border-radius: 6px;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.ell {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pill {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 2px 8px;
		flex-shrink: 0;
		margin-left: auto;
	}

	/* provider list */
	.plist {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		padding-right: 6px;
		transition: border-color 0.12s, background 0.12s;
	}
	.prow.active {
		border-color: color-mix(in oklab, var(--accent) 55%, transparent);
		background: var(--accent-soft);
	}
	.prow-main {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		min-width: 0;
	}
	.prow-txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.prow-id {
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
	.prow-url {
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
	:global(.curchk) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.peditor {
		margin: -2px 0 2px;
		padding: 12px;
		border: 1px solid var(--hairline);
		border-top: none;
		border-radius: 0 0 var(--r-md) var(--r-md);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 10px;
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
	.ebtns {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}
	.ehint {
		font-size: 12px;
		color: var(--dim);
	}
	.ekey {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.ekey :global(.tf) {
		flex: 1;
	}

	.addprov {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		width: 100%;
		margin-top: 8px;
		padding: 10px;
		border: 1px dashed var(--border);
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font-size: 13px;
		cursor: pointer;
	}
	.addprov:hover {
		background: var(--surface2);
		color: var(--text);
		border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
	}
	.newprov {
		margin-top: 8px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 11px;
	}
	.np-title {
		font-size: 13px;
		font-weight: 600;
	}
	.np-grid {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: end;
	}
	.np-f {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.np-f > span {
		font-size: 12px;
		color: var(--dim);
	}
	.np-models {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
	}
	.np-mlabel {
		font-size: 12px;
		color: var(--dim);
		width: 100%;
	}
	.mchip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 3px 5px 3px 9px;
		border-radius: 7px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
	}
	.np-addm {
		display: flex;
		gap: 7px;
		align-items: center;
		width: 100%;
	}
	.np-addm :global(.tf):first-child {
		flex: 1;
	}
	.np-addm :global(.tf) {
		width: 96px;
	}
	.np-foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* behavior */
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
		padding: 12px 14px;
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
	.numw {
		width: 110px;
		flex-shrink: 0;
	}
	.pct {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}
	.pctin {
		width: 74px;
	}
	.pctsign {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--dim);
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 22px;
		border-top: 1px solid var(--hairline);
	}
	.foot-hint {
		font-size: 12px;
		color: var(--dim2);
	}
</style>
