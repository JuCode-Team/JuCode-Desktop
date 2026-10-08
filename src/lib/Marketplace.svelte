<script lang="ts">
	import { onMount } from 'svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import { fetchMarketplace, installMarketplaceSkill, type MarketSkill } from '$lib/protocol';
	import type { BackendId } from '$lib/backends';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

	let { backend, onClose }: { backend: BackendId; onClose: () => void } = $props();

	let skills = $state<MarketSkill[]>([]);
	let loading = $state(true);
	let error = $state('');
	let warnings = $state<string[]>([]);
	let installDir = $state('');
	let query = $state('');
	let tag = $state('');
	/** 'all', 'installed' or a source key (`anthropic`, `owner/repo`). */
	let source = $state('all');
	const sourceName = (s: MarketSkill) => s.sourceName || s.source;
	/** The sources the catalog has, in its order (Anthropic first). */
	const sources = $derived([...new Map(skills.map((s) => [s.source, sourceName(s)])).entries()]);
	let installing = $state<Record<string, boolean>>({});

	const tags = $derived([...new Set(skills.flatMap((s) => s.tags))].sort());
	const filtered = $derived(
		skills.filter((s) => {
			const q = query.trim().toLowerCase();
			const matchQ = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
			const matchT = !tag || s.tags.includes(tag);
			const matchSource =
				source === 'all' ||
				(source === 'installed' ? s.installed : s.source === source);
			return matchQ && matchT && matchSource;
		})
	);

	async function load() {
		loading = true;
		error = '';
		warnings = [];
		try {
			const catalog = await fetchMarketplace(backend);
			skills = catalog.skills;
			warnings = catalog.warnings;
			installDir = catalog.installDir;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function install(s: MarketSkill) {
		const key = `${s.source}:${s.id}`;
		installing[key] = true;
		error = '';
		try {
			await installMarketplaceSkill(s.source, s.id, backend);
			s.installed = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			installing[key] = false;
		}
	}
</script>

<Modal label={t('settings.marketplace.title')} width={820} padded={false} {onClose}>
	<div class="sheet">
		<div class="head">
			<div>
				<h2>{t('settings.marketplace.title')}</h2>
				<p>{t('settings.marketplace.subtitle')}</p>
			</div>
			<IconButton onclick={onClose} label="close"><XIcon size={18} /></IconButton>
		</div>

		<div class="toolbar">
			<div class="search">
				<MagnifyingGlassIcon size={15} />
				<input bind:value={query} placeholder={t('settings.marketplace.search')} />
			</div>
			<Button variant="secondary" size="icon" onclick={load} title={t('settings.usage.refresh')}><ArrowsClockwiseIcon size={14} /></Button>
		</div>

		<div class="chips sources" aria-label={t('settings.marketplace.sourceFilter')}>
			<Chip selected={source === 'all'} onclick={() => (source = 'all')}>{t('settings.marketplace.all')}</Chip>
			{#each sources as [key, name] (key)}
				<Chip selected={source === key} onclick={() => (source = key)}>{name}</Chip>
			{/each}
			<Chip selected={source === 'installed'} onclick={() => (source = 'installed')}>{t('settings.marketplace.installed')}</Chip>
		</div>

		{#if tags.length}
			<div class="chips tags">
				<Chip selected={tag === ''} onclick={() => (tag = '')}>{t('settings.marketplace.allTags')}</Chip>
				{#each tags as tg (tg)}
					<Chip selected={tag === tg} onclick={() => (tag = tg)}>{tg}</Chip>
				{/each}
			</div>
		{/if}

		<div class="body">
			{#if loading}
				<div class="state"><CircleNotchIcon size={20} class="spin" /> {t('common.loading')}</div>
			{:else}
				{#if error}<Notice>{t('settings.marketplace.loadFailed', { error })}</Notice>{/if}
				{#each warnings as warning (warning)}
					<Notice tone="warn">{warning.includes('401') || warning.toLowerCase().includes('unauth') ? t('settings.marketplace.needLogin') : warning}</Notice>
				{/each}
				<div class="license-note">{t('settings.marketplace.licenseNotice')}</div>
				{#if filtered.length === 0}
					<div class="state">{t('settings.marketplace.noMatch')}</div>
				{:else}
					<div class="grid">
						{#each filtered as s (`${s.source}:${s.id}`)}
							<div class="card">
								<div class="card-top">
									<span class="name">{s.name}</span>
									<span class="source">{sourceName(s)}</span>
									{#if s.isDefault}<span class="badge">{t('settings.account.default')}</span>{/if}
								</div>
								<p class="desc">{s.description}</p>
								{#if !s.redistributable}<p class="restricted">{t('settings.marketplace.sourceAvailable')}</p>{/if}
								<div class="card-foot">
									<div class="tagrow">
										{#each s.tags.slice(0, 3) as tg (tg)}<span class="t">{tg}</span>{/each}
									</div>
									<Button
										variant={s.installed ? 'secondary' : 'primary'}
										size="sm"
										disabled={s.installed || !s.redistributable || installing[`${s.source}:${s.id}`]}
										onclick={() => install(s)}
									>
										{#if !s.redistributable && !s.installed}{t('settings.marketplace.notOffered')}{:else if installing[`${s.source}:${s.id}`]}<CircleNotchIcon size={14} class="spin" /> {t('settings.marketplace.installing')}{:else if s.installed}<CheckIcon size={14} /> {t('settings.marketplace.installed')}{:else}<DownloadSimpleIcon size={14} /> {t('settings.marketplace.install')}{/if}
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
		{#if installDir}<div class="install-dir">{t('settings.marketplace.installDir', { path: installDir })}</div>{/if}
	</div>
</Modal>

<style>
	/* Fixed height so the sheet doesn't resize as the catalog loads/filters. */
	.sheet {
		height: min(640px, 84vh);
		display: flex;
		flex-direction: column;
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
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.head p {
		margin: 4px 0 0;
		font-size: var(--fs-sm);
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
		font-size: var(--fs-md);
		padding: 9px 0;
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px 20px;
	}
	.chips.sources {
		padding-top: 2px;
	}
	.chips.tags {
		padding-bottom: 10px;
	}
	.license-note {
		margin: 0 0 4px;
		padding: 9px 11px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
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
		font-size: var(--fs-md);
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: var(--fs-2xs);
		color: var(--accent-bright);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: var(--r-full);
		padding: 1px 8px;
	}
	.source {
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.desc {
		margin: 8px 0 10px;
		font-size: var(--fs-sm);
		line-height: 1.5;
		color: var(--dim);
		flex: 1;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.restricted {
		margin: -2px 0 10px;
		color: var(--warn);
		font-size: var(--fs-2xs);
		line-height: 1.35;
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
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		background: var(--surface2);
		border-radius: var(--r-xs);
		padding: 1px 6px;
	}
	.state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 50px 20px;
		color: var(--dim);
		font-size: var(--fs-md);
		text-align: center;
	}
	.install-dir {
		flex-shrink: 0;
		padding: 8px 20px;
		border-top: 1px solid var(--hairline);
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
