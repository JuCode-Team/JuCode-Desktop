<script lang="ts">
	// Onboarding requires an explicit, successfully confirmed model choice.
	// A configured default is deliberately not a choice made in this wizard.
	import { untrack } from 'svelte';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import { fetchJucodeModels, readConfig, writeConfig } from '$lib/protocol';
	import { refreshJucodeModels } from '$lib/jucodeModels';
	import type { BackendId } from '$lib/backends';
	import { BACKEND_LABELS } from '$lib/backends';
	import { loadProfile } from '$lib/backendProfile';
	import { modelSetup } from '$lib/modelSetupState.svelte';
	import { fmtContext } from '$lib/composer/modelRows';
	import Vendor from '$lib/Vendor.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';

	interface ModelCfg {
		name: string;
		label?: string;
		vendor?: string;
		context_window?: number;
		reasoning_efforts?: string[];
	}

	let {
		loggedIn,
		backend,
		selectedModel = $bindable(''),
		ready = $bindable(false),
		refreshToken = 0,
		onSelected,
		onLogin,
		onOpenProviders
	}: {
		loggedIn: boolean;
		backend: BackendId;
		selectedModel?: string;
		ready?: boolean;
		refreshToken?: number;
		onSelected?: (model: string, effort: string, gateway: boolean) => Promise<void> | void;
		onLogin: () => void;
		onOpenProviders: () => void;
	} = $props();

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let provider = $state('');
	let models = $state<ModelCfg[]>([]);
	let model = $state('');
	let effort = $state('');
	let loadVersion = 0;

	const gateway = $derived(loggedIn && (backend === 'claude' || backend === 'codex'));
	const efforts = $derived(models.find((m) => m.name === model)?.reasoning_efforts ?? []);
	const modelOpts = $derived(models.map((m) => ({ value: m.name, label: m.label || m.name, vendor: m.vendor || m.name, context_window: m.context_window })));
	const effortOpts = $derived(efforts.map((e) => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) })));

	function validEffort(name: string, current: string): string {
		const options = models.find((m) => m.name === name)?.reasoning_efforts ?? [];
		if (!options.length) return '';
		return options.includes(current) ? current : options.includes('high') ? 'high' : options[Math.floor(options.length / 2)];
	}

	async function load(id: BackendId, account: boolean) {
		const version = ++loadVersion;
		loading = true;
		ready = false;
		error = '';
		try {
			let list: ModelCfg[];
			let currentEffort = '';
			let configuredModel: unknown;
			if (id === 'jucode') {
				if (account) await refreshJucodeModels();
				const cfg = (await readConfig()) ?? {};
				provider = typeof cfg.provider === 'string' ? cfg.provider : '';
				list = Array.isArray(cfg.models) ? (cfg.models as ModelCfg[]).filter((m) => typeof m?.name === 'string' && !!m.name) : [];
				currentEffort = typeof cfg.reasoning_effort === 'string' ? cfg.reasoning_effort : '';
				configuredModel = cfg.model;
			} else if (account && (id === 'claude' || id === 'codex')) {
				const family = id === 'claude' ? /^claude/i : /^gpt/i;
				list = (await fetchJucodeModels()).filter((m) => family.test(m.id)).map((m) => ({
					name: m.id,
					label: m.display_name,
					context_window: m.context_window,
					reasoning_efforts: m.reasoning_efforts
				}));
				provider = 'jucode';
			} else {
				// Only offer what this native backend actually reported previously.
				// No guessed aliases or engine startup just to populate onboarding.
				const profile = loadProfile(id);
				list = (profile.catalog ?? []).filter((m) => m.listed !== false && !!m.model).map((m) => ({
					name: m.model,
					label: m.label,
					vendor: m.vendor,
					context_window: m.context_window,
					reasoning_efforts: m.reasoning_efforts
				}));
				if (!list.length) {
					// A first-run BYOK setup has no previous engine profile yet.
					const cfg = (await readConfig()) ?? {};
					const family = id === 'claude' ? /^claude/i : /^gpt/i;
					list = Array.isArray(cfg.models) ? (cfg.models as ModelCfg[]).filter((m) => typeof m?.name === 'string' && family.test(m.name)) : [];
				}
				provider = profile.provider ?? '';
				currentEffort = profile.effort ?? '';
			}
			if (version !== loadVersion) return;
			models = list;
			// Returning to the step can keep a confirmed choice, but never seed it
			// from cfg.model, a catalog's active row, or the curated menu defaults.
			if (!models.some((m) => m.name === selectedModel) || (id === 'jucode' && configuredModel !== selectedModel)) selectedModel = '';
			model = selectedModel;
			effort = validEffort(model, effort || currentEffort);
			ready = !!selectedModel;
		} catch (e) {
			if (version !== loadVersion) return;
			models = [];
			selectedModel = '';
			model = '';
			error = String(e);
		} finally {
			if (version === loadVersion) loading = false;
		}
	}

	$effect(() => {
		const id = backend;
		const account = loggedIn;
		refreshToken;
		untrack(() => { void load(id, account); });
	});

	// The menu picker rewrites cfg.models: revalidate the explicit choice.
	let pickerWasOpen = false;
	$effect(() => {
		const open = modelSetup.open;
		if (pickerWasOpen && !open) untrack(() => { void load(backend, loggedIn); });
		pickerWasOpen = open;
	});

	function setModel(name: string) {
		if (saving || !models.some((m) => m.name === name)) return;
		model = name;
		effort = validEffort(name, effort);
		selectedModel = '';
		ready = false;
		error = '';
	}
	function setEffort(value: string) {
		if (saving) return;
		effort = value;
		selectedModel = '';
		ready = false;
		error = '';
	}

	async function confirm() {
		if (loading || saving || !model || !models.some((m) => m.name === model)) return;
		// The host owns native draft selection; without it there is no save.
		if (backend !== 'jucode' && !onSelected) return;
		const version = loadVersion;
		const chosen = model;
		const chosenEffort = effort;
		const viaGateway = gateway;
		saving = true;
		ready = false;
		error = '';
		try {
			if (backend === 'jucode') await writeConfig({ model: chosen, reasoning_effort: chosenEffort });
			if (version !== loadVersion) return;
			await onSelected?.(chosen, chosenEffort, viaGateway);
			if (version !== loadVersion) return;
			selectedModel = chosen;
			ready = true;
		} catch (e) {
			if (version !== loadVersion) return;
			error = t('settings.page.saveFailed', { msg: String(e) });
			toast.error(error);
		} finally {
			saving = false;
		}
	}
</script>

{#if backend !== 'jucode'}
	<div class="note">
		<Notice tone="info">{t('setup.welcome.model.nativeHint', { name: BACKEND_LABELS[backend] })}</Notice>
	</div>
{/if}

{#if error}
	<div class="note"><Notice tone="error">{error}</Notice></div>
{/if}
{#if loading}
	<div class="state"><CircleNotchIcon size={20} class="spin" /></div>
{:else if !models.length}
	<div class="empty">
		<p>{backend !== 'jucode' && !loggedIn ? t('setup.welcome.model.nativeHint', { name: BACKEND_LABELS[backend] }) : loggedIn ? t('setup.welcome.model.emptyLoggedIn') : t('setup.welcome.model.empty')}</p>
		<div class="row">
			{#if loggedIn && backend === 'jucode'}
				<Button variant="primary" size="sm" onclick={() => (modelSetup.open = true)}><ListChecksIcon size={14} /> {t('setup.welcome.model.pick')}</Button>
			{:else if !loggedIn}
				<Button variant="primary" size="sm" onclick={onLogin}><SignInIcon size={14} /> {t('setup.loginOauth.loginBtn')}</Button>
			{/if}
			<Button variant="ghost" size="sm" onclick={onOpenProviders}><KeyIcon size={14} /> {t('setup.welcome.model.providers')}</Button>
			<Button size="sm" onclick={() => load(backend, loggedIn)}>{t('common.retry')}</Button>
		</div>
	</div>
{:else}
	<div class="field">
		<span class="label">{t('settings.behavior.defaultModel')}</span>
		<span class="hint">{t('setup.welcome.model.chooseRequired')}</span>
		{#if backend === 'jucode'}<span class="hint">{t('setup.welcome.model.defaultHint', { provider: provider || '-' })}</span>{/if}
		<div class="sel">
			<Select value={model} onChange={setModel} options={modelOpts} disabled={saving} placeholder={t('settings.behavior.selectModel')}>
				{#snippet item(o)}
					<Vendor model={String(o.vendor ?? o.value)} size={15} />
					<span class="mono">{o.label}</span>
					{#if o.context_window}<span class="ctx">{fmtContext(o.context_window as number)}</span>{/if}
				{/snippet}
			</Select>
		</div>
	</div>

	{#if effortOpts.length && !saving}
		<div class="field">
			<span class="label">{t('settings.behavior.reasoningEffort')}</span>
			<span class="hint">{t('settings.page.reasoningEffortDesc')}</span>
			<div><Segmented value={effort} options={effortOpts} onChange={setEffort} /></div>
		</div>
	{/if}

	<div class="row confirmation">
		<Button variant="primary" size="sm" disabled={!model || saving || ready || (backend !== 'jucode' && !onSelected)} onclick={confirm}>
			{#if saving}<CircleNotchIcon size={14} class="spin" />{/if}
			{saving ? t('setup.welcome.model.saving') : t('setup.welcome.model.confirm')}
		</Button>
		{#if ready}<span class="confirmed"><CheckCircleIcon size={14} /> {t('setup.welcome.model.confirmed')}</span>{/if}
	</div>
	<div class="row actions">
		{#if loggedIn && backend === 'jucode' && provider === 'jucode'}
			<Button size="sm" disabled={saving} onclick={() => (modelSetup.open = true)}><ListChecksIcon size={14} /> {t('setup.welcome.model.pick')}</Button>
		{/if}
		<Button variant="ghost" size="sm" disabled={saving} onclick={onOpenProviders}><KeyIcon size={14} /> {t('setup.welcome.model.providers')}</Button>
	</div>
{/if}

<style>
	.note {
		margin-bottom: 16px;
	}
	.state {
		display: flex;
		justify-content: center;
		padding: 32px 0;
		color: var(--dim);
	}
	.empty {
		padding: 18px;
		border: 1px dashed var(--border-strong);
		border-radius: var(--r-md);
	}
	.empty p {
		margin: 0 0 14px;
		font-size: var(--fs-sm);
		line-height: 1.6;
		color: var(--dim);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 22px;
	}
	.label {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.5;
		margin-bottom: 6px;
	}
	.sel {
		max-width: 360px;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ctx {
		margin-left: auto;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	.confirmation {
		align-items: center;
		margin-bottom: 18px;
	}
	.confirmed {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.actions {
		padding-top: 18px;
		border-top: 1px solid var(--hairline);
	}
</style>
