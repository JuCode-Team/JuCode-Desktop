<script lang="ts">
	// Welcome → 模型: the JuCode engine's default model and effort
	// (~/.jucode/config.json `model` / `reasoning_effort`, the same fields as
	// Settings → 模型), and the "models to show" picker for a JuCode account.
	import { onMount } from 'svelte';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { readConfig, writeConfig } from '$lib/protocol';
	import type { BackendId } from '$lib/backends';
	import { BACKEND_LABELS } from '$lib/backends';
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
		context_window?: number;
		reasoning_efforts?: string[];
	}

	let {
		loggedIn,
		backend,
		ready = $bindable(false),
		onLogin,
		onOpenProviders
	}: {
		loggedIn: boolean;
		backend: BackendId;
		ready?: boolean;
		onLogin: () => void;
		onOpenProviders: () => void;
	} = $props();

	let loading = $state(true);
	let provider = $state('');
	let models = $state<ModelCfg[]>([]);
	let model = $state('');
	let effort = $state('');

	const efforts = $derived(models.find((m) => m.name === model)?.reasoning_efforts ?? []);
	const modelOpts = $derived(models.map((m) => ({ value: m.name, label: m.name, context_window: m.context_window })));
	const effortOpts = $derived(efforts.map((e) => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) })));

	$effect(() => {
		ready = !!model;
	});

	async function load() {
		loading = true;
		try {
			const cfg = (await readConfig()) ?? {};
			provider = typeof cfg.provider === 'string' ? cfg.provider : '';
			models = Array.isArray(cfg.models) ? (cfg.models as ModelCfg[]).filter((m) => m?.name) : [];
			model = typeof cfg.model === 'string' ? cfg.model : '';
			effort = typeof cfg.reasoning_effort === 'string' ? cfg.reasoning_effort : '';
		} catch (e) {
			toast.error(String(e));
		} finally {
			loading = false;
		}
	}
	onMount(load);

	// The picker rewrites `models` (and `model` when it drops it): reload after.
	let pickerWasOpen = false;
	$effect(() => {
		const open = modelSetup.open;
		if (pickerWasOpen && !open) load();
		pickerWasOpen = open;
	});

	function save(patch: Record<string, unknown>) {
		writeConfig(patch).catch((e) => toast.error(t('settings.page.saveFailed', { msg: String(e) })));
	}
	function setModel(name: string) {
		model = name;
		const patch: Record<string, unknown> = { model: name };
		// Keep the effort valid for the new model (as Settings does).
		const efs = models.find((m) => m.name === name)?.reasoning_efforts ?? [];
		if (efs.length && !efs.includes(effort)) {
			effort = efs.includes('high') ? 'high' : efs[Math.floor(efs.length / 2)];
			patch.reasoning_effort = effort;
		}
		save(patch);
	}
	function setEffort(e: string) {
		effort = e;
		save({ reasoning_effort: e });
	}
</script>

{#if backend !== 'jucode'}
	<div class="note">
		<Notice tone="info">{t('setup.welcome.model.otherBackend', { name: BACKEND_LABELS[backend] })}</Notice>
	</div>
{/if}

{#if loading}
	<div class="state"><CircleNotchIcon size={20} class="spin" /></div>
{:else if !models.length}
	<div class="empty">
		<p>{loggedIn ? t('setup.welcome.model.emptyLoggedIn') : t('setup.welcome.model.empty')}</p>
		<div class="row">
			{#if loggedIn}
				<Button variant="primary" size="sm" onclick={() => (modelSetup.open = true)}><ListChecksIcon size={14} /> {t('setup.welcome.model.pick')}</Button>
			{:else}
				<Button variant="primary" size="sm" onclick={onLogin}><SignInIcon size={14} /> {t('setup.loginOauth.loginBtn')}</Button>
			{/if}
			<Button variant="ghost" size="sm" onclick={onOpenProviders}><KeyIcon size={14} /> {t('setup.welcome.model.providers')}</Button>
		</div>
	</div>
{:else}
	<div class="field">
		<span class="label">{t('settings.behavior.defaultModel')}</span>
		<span class="hint">{t('setup.welcome.model.defaultHint', { provider: provider || '-' })}</span>
		<div class="sel">
			<Select value={model} onChange={setModel} options={modelOpts} placeholder={t('settings.behavior.selectModel')}>
				{#snippet item(o)}
					<Vendor model={o.label ?? ''} size={15} />
					<span class="mono">{o.label}</span>
					{#if o.context_window}<span class="ctx">{fmtContext(o.context_window as number)}</span>{/if}
				{/snippet}
			</Select>
		</div>
	</div>

	{#if effortOpts.length}
		<div class="field">
			<span class="label">{t('settings.behavior.reasoningEffort')}</span>
			<span class="hint">{t('settings.page.reasoningEffortDesc')}</span>
			<div><Segmented value={effort} options={effortOpts} onChange={setEffort} /></div>
		</div>
	{/if}

	<div class="row actions">
		{#if loggedIn && provider === 'jucode'}
			<Button size="sm" onclick={() => (modelSetup.open = true)}><ListChecksIcon size={14} /> {t('setup.welcome.model.pick')}</Button>
		{/if}
		<Button variant="ghost" size="sm" onclick={onOpenProviders}><KeyIcon size={14} /> {t('setup.welcome.model.providers')}</Button>
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
	.actions {
		padding-top: 18px;
		border-top: 1px solid var(--hairline);
	}
</style>
