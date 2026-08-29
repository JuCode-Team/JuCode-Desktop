<script lang="ts">
	import { Search, Star } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import type { CatalogProvider } from '$lib/providers/catalog';
	import Vendor from '$lib/Vendor.svelte';
	import Button from '$lib/ui/Button.svelte';
	import TextField from '$lib/ui/TextField.svelte';

	let {
		providers,
		onSelect,
		onCustom,
		onCancel
	}: {
		providers: CatalogProvider[];
		onSelect: (provider: CatalogProvider) => void;
		onCustom: () => void;
		onCancel: () => void;
	} = $props();

	let query = $state('');
	const matches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return providers;
		return providers.filter((provider) =>
			`${provider.name} ${provider.id} ${provider.description} ${provider.models.map((model) => model.name).join(' ')}`
				.toLowerCase()
				.includes(needle)
		);
	});
	const protocolLabel = (protocol: CatalogProvider['protocol']) =>
		t(`settings.catalog.protocol.${protocol}`);
</script>

<div class="catalog">
	<div>
		<div class="catalog-title">{t('settings.catalog.title')}</div>
		<p class="catalog-hint">{t('settings.catalog.hint')}</p>
	</div>
	<label class="search">
		<Search size={14} />
		<TextField bind:value={query} placeholder={t('settings.catalog.search')} />
	</label>
	<div class="catalog-list">
		{#each matches as provider (provider.id)}
			<button class="catalog-provider" class:featured={provider.featured} onclick={() => onSelect(provider)}>
				<span class="catalog-icon"><Vendor model={provider.models[0]?.name ?? provider.id} size={19} /></span>
				<span class="catalog-copy">
					<span class="catalog-name">
						{provider.name}
						{#if provider.featured}<span class="featured-tag"><Star size={10} /> {t('settings.catalog.featured')}</span>{/if}
					</span>
					<span class="catalog-description">{provider.description}</span>
					<span class="catalog-meta">
						{protocolLabel(provider.protocol)} · {t('settings.catalog.modelCount', { count: provider.models.length })}
					</span>
				</span>
			</button>
		{/each}
		{#if matches.length === 0}<div class="empty">{t('settings.catalog.noMatch')}</div>{/if}
	</div>
	<div class="catalog-foot">
		<Button variant="ghost" size="sm" onclick={onCancel}>{t('common.cancel')}</Button>
		<Button variant="secondary" size="sm" onclick={onCustom}>{t('settings.catalog.custom')}</Button>
	</div>
</div>

<style>
	.catalog {
		margin-top: 8px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.catalog-title {
		font-size: 13px;
		font-weight: 600;
	}
	.catalog-hint {
		margin: 3px 0 0;
		font-size: 12px;
		color: var(--dim);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--dim);
	}
	.search :global(.tf) {
		flex: 1;
	}
	.catalog-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 330px;
		overflow-y: auto;
	}
	.catalog-provider {
		display: flex;
		gap: 11px;
		width: 100%;
		padding: 11px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--sidebar);
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.catalog-provider:hover {
		background: var(--surface2);
		border-color: var(--border);
	}
	.catalog-provider.featured {
		border-color: color-mix(in oklab, var(--accent) 40%, var(--hairline));
	}
	.catalog-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface2);
		flex-shrink: 0;
	}
	.catalog-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.catalog-name {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		font-weight: 600;
	}
	.featured-tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-bright);
		font-size: 10px;
		font-weight: 600;
	}
	.catalog-description {
		font-size: 12px;
		color: var(--dim);
	}
	.catalog-meta {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--dim2);
	}
	.empty {
		padding: 22px 10px;
		color: var(--dim);
		text-align: center;
		font-size: 12px;
	}
	.catalog-foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
