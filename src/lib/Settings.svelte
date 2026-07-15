<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { X, LogIn, LogOut, KeyRound, SlidersHorizontal, Plus, Trash2, Zap, CircleCheck, ChevronDown, Wallet, LayoutDashboard, Mic, Puzzle } from 'lucide-svelte';
	import { readConfig, writeConfig, readAuthProviders, setAuthKey, removeAuthKey, listProviders, fetchAccountInfo, fetchDeepseekBalance, type AccountInfo, type DeepseekBalance } from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import { caps } from '$lib/backends';
	import { prefs, vibrancySupported } from '$lib/prefs.svelte';
	import BackendSection from '$lib/settings/BackendSection.svelte';
	import type { ChatState } from '$lib/chat.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import OverviewPanel from '$lib/OverviewPanel.svelte';
	import ProviderAccountCard from '$lib/settings/ProviderAccountCard.svelte';
	import CustomProviderForm from '$lib/settings/CustomProviderForm.svelte';
	import McpSection from '$lib/settings/McpSection.svelte';
	import UpdateCard from '$lib/settings/UpdateCard.svelte';
	import Button from '$lib/ui/Button.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { t, setLocale, getLocale, LOCALES, LOCALE_LABELS } from '$lib/i18n';

	let {
		sessionId,
		chat,
		initialSection = 'overview',
		onClose,
		onAuthChange
	}: {
		sessionId: string;
		/** The active session's ChatState — source of the live `mcp_servers` view.
		 *  The engine's MCP config is global, so any live session's engine works. */
		chat?: ChatState;
		initialSection?: 'overview' | 'account' | 'behavior' | 'extensions';
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
	let section = $state<'overview' | 'account' | 'behavior' | 'extensions'>(untrack(() => initialSection));

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
		{ key: 'overview', labelKey: 'settings.nav.overview', icon: LayoutDashboard, subKey: 'settings.nav.overviewSub' },
		{ key: 'account', labelKey: 'settings.nav.account', icon: KeyRound, subKey: 'settings.nav.accountSub' },
		{ key: 'behavior', labelKey: 'settings.nav.behavior', icon: SlidersHorizontal, subKey: 'settings.nav.behaviorSub' },
		{ key: 'extensions', labelKey: 'settings.nav.extensions', icon: Puzzle, subKey: 'settings.nav.extensionsSub' }
	] as const;
	const meta = $derived(NAV.find((n) => n.key === section)!);

	const allProviders = $derived<Provider[]>([
		...builtin.map((b) => ({ id: b.id, base_url: b.base_url, models: b.models, format: b.protocol, builtin: true })),
		...custom
	]);
	const modelOpts = $derived(models.map((m) => ({ value: m.name, label: m.name, ...m })));
	const effortOpts = $derived(efforts.map((e) => ({ value: e, label: cap(e) })));
	// All providers' models in one list (provider-qualified), so the default-model
	// picker isn't limited to whichever provider is currently the default.
	const allModelOpts = $derived(
		allProviders.flatMap((p) =>
			p.models.map((m) => ({
				value: `${p.id}::${m.name}`,
				label: m.name,
				provider: p.id,
				context_window: m.context_window,
				authed: keyed.includes(p.id)
			}))
		)
	);
	// Bridge the composite picker value (provider::model) to cfg.provider + cfg.model.
	let modelKey = $state('');
	$effect(() => {
		modelKey = `${cfg.provider ?? ''}::${cfg.model ?? ''}`;
	});
	function applyModel(key: string) {
		const i = key.indexOf('::');
		if (i < 0) return;
		const p = allProviders.find((x) => x.id === key.slice(0, i));
		if (!p) return;
		selectProvider(p);
		cfg.model = key.slice(i + 2);
	}

	onMount(async () => {
		cfg = await readConfig();
		if (cfg.compaction_threshold_percent == null) cfg.compaction_threshold_percent = 75;
		keyed = await readAuthProviders();
		loadBalances();
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
		loadBalances();
		keyInput = '';
		editing = null;
		onAuthChange?.();
	}
	// Logout (jucode) / clear stored key (other providers).
	async function logout(id: string) {
		await removeAuthKey(id);
		keyed = await readAuthProviders();
		loadBalances();
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
	let loggingIn = $state(false);
	function login() {
		dispatch(sessionId, { op: 'command', input: '/login' });
		loggingIn = true;
	}
	// While a login is in flight, poll auth state so the modal flips to
	// 已登录 (and reveals the account panel) the moment the browser flow
	// completes — without making the user close and reopen Settings.
	$effect(() => {
		if (!loggingIn) return;
		if (keyed.includes('jucode')) {
			loggingIn = false;
			return;
		}
		const t = setInterval(async () => {
			keyed = await readAuthProviders();
			if (keyed.includes('jucode')) {
				loggingIn = false;
				loadBalances();
				onAuthChange?.();
			}
		}, 2000);
		return () => clearInterval(t);
	});

	// Per-provider balances shown on the cards — independent of which provider is
	// the default, so several can be logged in and show balances at once.
	let jucodeBal = $state<AccountInfo | null>(null);
	let deepseekBal = $state<DeepseekBalance | null>(null);
	const deepseekTotal = $derived(deepseekBal?.balance_infos?.[0] ?? null);
	function loadBalances() {
		if (keyed.includes('jucode')) fetchAccountInfo().then((a) => (jucodeBal = a)).catch(() => (jucodeBal = null));
		else jucodeBal = null;
		if (keyed.includes('deepseek')) fetchDeepseekBalance().then((b) => (deepseekBal = b)).catch(() => (deepseekBal = null));
		else deepseekBal = null;
	}

	// Card click: not-logged-in jucode kicks off OAuth directly (no expand); other
	// (key-based) providers expand to reveal the key input. Logged-in cards expand
	// to show details.
	// MiMo ASR key for composer voice input (stored as providers.mimo — a plain
	// keyed provider from auth.json's perspective, but not a chat provider, so
	// it gets its own group instead of a provider card).
	let mimoKey = $state('');
	async function saveMimoKey() {
		if (!mimoKey.trim()) return;
		await setAuthKey('mimo', mimoKey.trim());
		keyed = await readAuthProviders();
		mimoKey = '';
	}

	function cardClick(p: Provider, authed: boolean) {
		if (p.id === 'jucode' && !authed) {
			if (!loggingIn) login();
			return;
		}
		toggleEdit(p.id);
	}
	function setDefault(p: Provider) {
		selectProvider(p);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />
<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
	<div class="sheet" role="dialog" aria-modal="true" tabindex="-1" aria-label={t('settings.title')} use:focusTrap>
		<aside class="nav">
			<div class="brand">JuCode</div>
			<div class="nav-list">
				{#each NAV as n (n.key)}
					<button class="nav-item" class:on={section === n.key} onclick={() => (section = n.key)}>
						<span class="nav-ico"><n.icon size={16} /></span>
						<span class="nav-txt">
							<span class="nav-label">{t(n.labelKey)}</span>
							<span class="nav-sub">{t(n.subKey)}</span>
						</span>
					</button>
				{/each}
			</div>
		</aside>

		<div class="main">
			<header class="head">
				<div>
					<h2>{t(meta.labelKey)}</h2>
					<p class="head-sub">{t(meta.subKey)}</p>
				</div>
				<Button variant="ghost" size="sm" onclick={onClose}><X size={18} /></Button>
			</header>

			<div class="scroll">
				{#if section === 'overview'}
					<UpdateCard />
					<OverviewPanel />
				{:else if section === 'account'}
					<div class="group">
						<div class="glabel">{t('settings.account.groupLabel')}</div>
						<p class="hint">{t('settings.account.hint')}</p>
						<div class="plist">
							{#each allProviders as p (p.id)}
								<ProviderAccountCard
									provider={p}
									authed={keyed.includes(p.id)}
									isDefault={cfg.provider === p.id}
									open={editing === p.id}
									{loggingIn}
									{jucodeBal}
									{deepseekBal}
									{deepseekTotal}
									bind:keyInput
									{cap}
									onCardClick={cardClick}
									onLogin={login}
									onLogout={logout}
									onSaveKey={saveKey}
									onSetDefault={setDefault}
									onDelete={deleteProvider}
								/>
							{/each}
						</div>

						{#if editing === '__new__'}
							<CustomProviderForm
								bind:form
								bind:mName
								bind:mCtx
								formats={FORMATS}
								{fmt}
								onAddModel={addFormModel}
								onCreate={createProvider}
								onCancel={() => (editing = null)}
							/>
						{:else}
							<button class="addprov" onclick={openCreate}><Plus size={15} /> {t('settings.custom.add')}</button>
						{/if}
					</div>

					<div class="group">
						<div class="glabel"><Mic size={12} /> {t('settings.voice.groupLabel')}</div>
						<p class="hint">{t('settings.voice.hint')}</p>
						<div class="voicekey">
							<TextField bind:value={mimoKey} type="password" placeholder={t('settings.voice.keyPlaceholder')} />
							<Button variant="primary" size="sm" disabled={!mimoKey.trim()} onclick={saveMimoKey}>{t('settings.account.saveKey')}</Button>
							{#if keyed.includes('mimo')}
								<Button variant="ghost" size="sm" onclick={() => logout('mimo')}>{t('settings.account.clearKey')}</Button>
							{/if}
						</div>
						{#if keyed.includes('mimo')}<p class="hint mt keyok"><CircleCheck size={13} /> {t('settings.account.keyed')}</p>{/if}
					</div>
				{:else if section === 'extensions'}
					{#if caps(chat).mcpManage}
						<McpSection {sessionId} {chat} />
					{:else if chat?.mcpServers?.length}
						<!-- Read-only: claude configures MCP in its own settings; we can
						     only list what the engine reports at startup. -->
						<div class="group">
							<p class="hint">{t('settings.mcp.readonlyHint')}</p>
							<div class="mcp-ro">
								{#each chat.mcpServers as s (s.name)}
									<div class="mcp-ro-row">
										<span class="mcp-ro-dot" class:ok={s.state === 'connected'} class:bad={s.state === 'failed'}></span>
										<span class="mcp-ro-name">{s.name}</span>
										<span class="mcp-ro-state">{s.state}</span>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<div class="group">
							<p class="hint">{t('settings.backend.mcpUnsupported')}</p>
						</div>
					{/if}
				{:else}
					<div class="group">
						<div class="glabel">{t('settings.language')}</div>
						<Segmented value={getLocale()} options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} onChange={(v) => setLocale(v as (typeof LOCALES)[number])} />
					</div>

					<div class="group">
						<div class="glabel">{t('settings.behavior.htmlOpen')}</div>
						<Segmented
							value={prefs.htmlOpenInBrowser ? 'browser' : 'editor'}
							options={[
								{ value: 'browser', label: t('settings.behavior.htmlOpenBrowser') },
								{ value: 'editor', label: t('settings.behavior.htmlOpenEditor') }
							]}
							onChange={(v) => prefs.setHtmlOpenInBrowser(v === 'browser')}
						/>
						<p class="hint mt">{t('settings.behavior.htmlOpenHint')}</p>
					</div>

					{#if vibrancySupported()}
						<div class="group">
							<div class="glabel">{t('settings.behavior.vibrancy')}</div>
							<Segmented
								value={prefs.sidebarVibrancy ? 'on' : 'off'}
								options={[
									{ value: 'on', label: t('settings.behavior.vibrancyOn') },
									{ value: 'off', label: t('settings.behavior.vibrancyOff') }
								]}
								onChange={(v) => prefs.setSidebarVibrancy(v === 'on')}
							/>
							<p class="hint mt">{t('settings.behavior.vibrancyHint')}</p>
						</div>
					{/if}

					<BackendSection />

					<div class="group">
						<div class="glabel">{t('settings.behavior.defaultModel')}</div>
						<Select bind:value={modelKey} onChange={applyModel} options={allModelOpts} placeholder={t('settings.behavior.selectModel')}>
							{#snippet item(o)}
								<span class="tile sm"><Vendor model={o.label ?? ''} size={15} /></span>
								<span class="mono ell">{o.label}</span>
								<span class="optprov">{o.provider as string}</span>
								{#if o.context_window}<span class="pill">{fmt(o.context_window as number)}</span>{/if}
								{#if !o.authed}<span class="optlock">{t('settings.behavior.notConfigured')}</span>{/if}
							{/snippet}
						</Select>
						{#if allModelOpts.length === 0}<p class="hint mt">{t('settings.behavior.noModels')}</p>{/if}
					</div>

					{#if effortOpts.length}
						<div class="group">
							<div class="glabel"><Zap size={12} /> {t('settings.behavior.reasoningEffort')}</div>
							<Segmented bind:value={cfg.reasoning_effort} options={effortOpts} />
						</div>
					{/if}

					<div class="group">
						<div class="glabel">{t('settings.behavior.compaction')}</div>
						<div class="setlist">
							<div class="set">
								<span class="set-txt"><span class="set-title">{t('settings.behavior.compactionThreshold')}</span><span class="set-sub">{t('settings.behavior.compactionThresholdSub')}</span></span>
								<span class="pct"><span class="pctin"><TextField bind:value={cfg.compaction_threshold_percent} type="number" align="right" /></span><span class="pctsign">%</span></span>
							</div>
						</div>
					</div>
					<div class="group">
						<div class="glabel">{t('settings.behavior.compactModel')}</div>
						<p class="hint">{t('settings.behavior.compactModelHint')}</p>
						<Select bind:value={cfg.compact_model} options={modelOpts} placeholder={t('settings.behavior.selectModel')}>
							{#snippet item(o)}
								<span class="tile sm"><Vendor model={o.label ?? ''} size={15} /></span>
								<span class="mono ell">{o.label}</span>
							{/snippet}
						</Select>
					</div>
					<div class="group">
						<div class="glabel">{t('settings.behavior.network')}</div>
						<div class="setlist">
							<div class="set"><span class="set-txt"><span class="set-title">{t('settings.behavior.retryAttempts')}</span></span><span class="numw"><TextField bind:value={cfg.retry_attempts} type="number" align="right" /></span></div>
							<div class="set"><span class="set-txt"><span class="set-title">{t('settings.behavior.connectTimeout')}</span><span class="set-sub">{t('settings.behavior.seconds')}</span></span><span class="numw"><TextField bind:value={cfg.connect_timeout_seconds} type="number" align="right" /></span></div>
							<div class="set"><span class="set-txt"><span class="set-title">{t('settings.behavior.readTimeout')}</span><span class="set-sub">{t('settings.behavior.seconds')}</span></span><span class="numw"><TextField bind:value={cfg.read_timeout_seconds} type="number" align="right" /></span></div>
						</div>
					</div>
					<div class="group">
						<div class="glabel">{t('settings.behavior.project')}</div>
						<div class="setlist">
							<div class="set"><span class="set-txt"><span class="set-title">{t('settings.behavior.includeProjectInstructions')}</span><span class="set-sub">{t('settings.behavior.includeProjectInstructionsSub')}</span></span><Switch bind:checked={cfg.include_project_instructions} label="include project instructions" /></div>
						</div>
					</div>
				{/if}
			</div>

			{#if section !== 'overview' && section !== 'extensions'}
				<div class="foot">
					<span class="foot-hint">{t('settings.footHint')}</span>
					<Button variant="primary" onclick={save}>{#if saved}<CircleCheck size={15} /> {t('settings.saved')}{:else}{t('settings.saveChanges')}{/if}</Button>
				</div>
			{/if}
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
	.mcp-ro {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mcp-ro-row {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--sidebar);
	}
	.mcp-ro-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.mcp-ro-dot.ok {
		background: var(--ok);
	}
	.mcp-ro-dot.bad {
		background: var(--err);
	}
	.mcp-ro-name {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 12.5px;
		color: var(--text);
	}
	.mcp-ro-state {
		font-size: 11px;
		color: var(--dim);
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

	.optprov {
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.optlock {
		font-size: 10px;
		color: var(--warn);
		border: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
		border-radius: 4px;
		padding: 0 5px;
		flex-shrink: 0;
	}
	/* provider list */
	.plist {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	:global(.pcard .chev) {
		color: var(--dim2);
		transition: transform 0.15s;
	}
	:global(.pcard .chev.up) {
		transform: rotate(180deg);
	}
	:global(.pcard .dimx) {
		color: var(--dim2);
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.voicekey {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.keyok {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--ok);
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
