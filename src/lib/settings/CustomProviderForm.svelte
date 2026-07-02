<script lang="ts">
	import { X, Plus } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';

	interface ModelCfg {
		name: string;
		context_window?: number;
		max_output_tokens?: number;
		reasoning_efforts?: string[];
	}
	interface FormState {
		id: string;
		base_url: string;
		format: string;
		key: string;
		models: ModelCfg[];
	}

	let {
		form = $bindable(),
		mName = $bindable(),
		mCtx = $bindable(),
		formats,
		fmt,
		onAddModel,
		onCreate,
		onCancel
	}: {
		form: FormState;
		mName: string;
		mCtx: number | undefined;
		formats: { value: string; label: string }[];
		fmt: (n?: number) => string;
		onAddModel: () => void;
		onCreate: () => void;
		onCancel: () => void;
	} = $props();
</script>

<div class="newprov">
	<div class="np-title">{t('settings.custom.title')}</div>
	<div class="np-grid">
		<label class="np-f"><span>{t('settings.custom.providerId')}</span><TextField bind:value={form.id} placeholder={t('settings.custom.providerIdPlaceholder')} /></label>
		<label class="np-f"><span>{t('settings.custom.format')}</span><Segmented bind:value={form.format} options={formats} /></label>
	</div>
	<label class="np-f"><span>{t('settings.custom.baseUrl')}</span><TextField bind:value={form.base_url} mono placeholder="https://api.example.com/v1" /></label>
	<label class="np-f"><span>{t('settings.custom.apiKey')}</span><TextField bind:value={form.key} type="password" mono placeholder="sk-…" /></label>
	<div class="np-models">
		<span class="np-mlabel">{t('settings.custom.models')}</span>
		{#each form.models as m (m.name)}
			<span class="mchip">{m.name} · {fmt(m.context_window)}<IconButton size="xs" onclick={() => (form.models = form.models.filter((x) => x !== m))} label="remove"><X size={11} /></IconButton></span>
		{/each}
		<div class="np-addm">
			<TextField bind:value={mName} mono placeholder={t('settings.custom.modelName')} />
			<TextField bind:value={mCtx} type="number" align="right" placeholder={t('settings.custom.contextWindow')} />
			<Button size="sm" onclick={onAddModel}><Plus size={13} /></Button>
		</div>
	</div>
	<div class="np-foot">
		<Button variant="ghost" size="sm" onclick={onCancel}>{t('common.cancel')}</Button>
		<Button variant="primary" size="sm" onclick={onCreate}>{t('settings.custom.create')}</Button>
	</div>
</div>

<style>
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
</style>
