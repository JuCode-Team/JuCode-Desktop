<script lang="ts">
	// Adds or edits one of Claude Code's / Codex's custom providers: its API,
	// key, and the models sessions may pick, read from the API's model list
	// or typed. One of them is the default (new sessions, Claude Code's
	// background models).
	import { onMount, untrack } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import { toolProviderModels, type ListedModel, type ToolApiProvider } from '$lib/protocol';
	import { changeToolProviders, type ProviderTool } from '$lib/toolProviders.svelte';
	import { slugifyAgentId } from '$lib/backends/acp-agents';
	import { fmtContext } from '$lib/composer/modelRows';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { t } from '$lib/i18n';

	let {
		tool,
		provider,
		taken,
		onClose
	}: {
		tool: ProviderTool;
		/** The provider edited; none to add one. */
		provider?: ToolApiProvider;
		/** Ids already in use (a new provider's id is made from its name). */
		taken: string[];
		onClose: () => void;
	} = $props();

	const format = $derived(tool === 'claude' ? 'anthropic' : 'responses');

	// The form starts from the provider as it was when opened.
	const saved = untrack(() => provider);
	let name = $state(saved?.name ?? '');
	let baseUrl = $state(saved?.base_url ?? '');
	let key = $state('');
	// The models sessions may pick, in the order shown, and the default.
	let models = $state<string[]>(saved ? [...saved.models] : []);
	let def = $state(saved?.model ?? '');

	// The API's model list: null until read.
	let listed = $state<ListedModel[] | null>(null);
	let hidden = $state(0);
	let fetching = $state(false);
	let fetchError = $state('');
	let query = $state('');
	let typed = $state('');

	let busy = $state(false);
	let error = $state('');

	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

	function urlOk(url: string): boolean {
		try {
			const u = new URL(url);
			return /^https?:$/.test(u.protocol) && !!u.host && !/[?#@]/.test(url);
		} catch {
			return false;
		}
	}

	// The models picked when the list was read come first; picking does not
	// move rows. Then ones typed since, then the rest of the list.
	let first = $state<string[]>(saved ? [...saved.models] : []);
	const rows = $derived.by(() => {
		const known = new Map((listed ?? []).map((m) => [m.id, m]));
		const top = [...first, ...models.filter((id) => !first.includes(id) && !known.has(id))];
		return [
			...top.map((id) => known.get(id) ?? { id }),
			...(listed ?? []).filter((m) => !top.includes(m.id))
		];
	});
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? rows.filter((m) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(q)) : rows;
	});

	function toggle(id: string) {
		if (models.includes(id)) {
			models = models.filter((m) => m !== id);
			if (def === id) def = models[0] ?? '';
		} else {
			models = [...models, id];
			def ||= id;
		}
	}

	function addTyped() {
		const id = typed.trim();
		if (!id) return;
		if (!models.includes(id)) models = [...models, id];
		def ||= id;
		typed = '';
	}

	async function fetchModels() {
		const url = baseUrl.trim();
		if (!urlOk(url)) {
			fetchError = t('settings.toolProviders.badUrl');
			return;
		}
		if (!key.trim() && !provider?.has_key) {
			fetchError = t('settings.toolProviders.needKey');
			return;
		}
		fetching = true;
		fetchError = '';
		try {
			const got = await toolProviderModels(tool, {
				base_url: url,
				...(key.trim() ? { key: key.trim() } : { provider_id: provider?.id })
			});
			listed = got.models;
			hidden = got.hidden;
			first = [...models];
		} catch (e) {
			fetchError = t('settings.toolProviders.fetchFailed', { msg: message(e) });
		} finally {
			fetching = false;
		}
	}

	// Leaving the address or key fields with both filled reads the list once.
	function onFieldsLeft() {
		if (listed === null && !fetching && !fetchError && urlOk(baseUrl.trim()) && (key.trim() || provider?.has_key))
			void fetchModels();
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		addTyped();
		const url = baseUrl.trim();
		if (!urlOk(url)) return void (error = t('settings.toolProviders.badUrl'));
		if (!provider && !key.trim()) return void (error = t('settings.toolProviders.needKey'));
		if (!models.length) return void (error = t('settings.toolProviders.needModel'));
		// Unnamed: the API's host names it ("api.example.com" → "example").
		const label = name.trim() || new URL(url).hostname.split('.').slice(-2)[0] || 'provider';
		const id = provider?.id ?? slugifyAgentId(label, new Set(taken), 'provider');
		busy = true;
		error = '';
		try {
			await changeToolProviders(tool, 'tool_provider_save', {
				provider: { id, name: label, format, base_url: url, key: key.trim(), models, model: def || models[0] }
			});
			onClose();
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		// Editing: the API's current list, with the saved key.
		if (provider?.has_key && urlOk(provider.base_url)) void fetchModels();
	});
</script>

<Modal
	title={provider ? t('settings.toolProviders.editTitle', { name: provider.name }) : t('settings.toolProviders.add')}
	width={560}
	padded={false}
	dismissible={!busy}
	{onClose}
>
	<form class="ed" id="tool-provider-form" onsubmit={save}>
		<div class="fields" onfocusout={onFieldsLeft}>
			<label class="f">
				<span>{t('settings.toolProviders.baseUrl')}</span>
				<TextField bind:value={baseUrl} disabled={busy} mono placeholder="https://api.example.com/v1" />
				<span class="sub">{t('settings.toolProviders.formatHint', { format: t(`settings.catalog.protocol.${format}`) })}</span>
			</label>
			<label class="f">
				<span>{t('settings.custom.apiKey')}</span>
				<TextField
					bind:value={key}
					disabled={busy}
					type="password"
					mono
					placeholder={provider ? t('settings.toolProviders.keepKey') : 'sk-…'}
				/>
			</label>
			<label class="f">
				<span>{t('settings.toolProviders.name')}</span>
				<TextField bind:value={name} disabled={busy} placeholder={t('settings.toolProviders.namePlaceholder')} />
			</label>
		</div>

		<div class="models">
			<div class="mhead">
				<span class="mtitle">{t('settings.toolProviders.models')}</span>
				{#if models.length}
					<span class="mcount">{t('settings.toolProviders.picked', { n: models.length })}</span>
				{/if}
				<span class="grow"></span>
				<Button type="button" variant="ghost" size="sm" disabled={fetching || busy} onclick={fetchModels}>
					{#if fetching}<LoaderCircleIcon size={14} class="spin" />{:else}<RotateCwIcon size={14} />{/if}
					{listed === null ? t('settings.toolProviders.fetch') : t('settings.toolProviders.refetch')}
				</Button>
			</div>
			{#if fetchError}<Notice onDismiss={() => (fetchError = '')}>{fetchError}</Notice>{/if}
			{#if rows.length > 8}
				<TextField bind:value={query} placeholder={t('settings.toolProviders.search')} />
			{/if}
			{#if rows.length}
				<div class="mlist" role="listbox" aria-multiselectable="true" aria-label={t('settings.toolProviders.models')}>
					{#each shown as m (m.id)}
						{@const on = models.includes(m.id)}
						{@const win = fmtContext(m.context_window ?? undefined)}
						<div class="mrow" class:on>
							<button
								type="button"
								class="mpick"
								role="option"
								aria-selected={on}
								disabled={busy}
								onclick={() => toggle(m.id)}
							>
								<span class="box" class:on>{#if on}<CheckIcon size={12} strokeWidth={3} />{/if}</span>
								<span class="mid">{m.id}</span>
								{#if m.name || win}
									<span class="mmeta">{[m.name, win].filter(Boolean).join(' · ')}</span>
								{/if}
							</button>
							{#if on && def === m.id}
								<span class="deftag">{t('settings.toolProviders.default')}</span>
							{:else if on}
								<button type="button" class="setdef" disabled={busy} onclick={() => (def = m.id)}>
									{t('settings.toolProviders.setDefault')}
								</button>
							{/if}
						</div>
					{:else}
						<div class="mempty">{t('settings.toolProviders.noMatch')}</div>
					{/each}
				</div>
			{:else if !fetching}
				<p class="mhint">{t('settings.toolProviders.modelsHint')}</p>
			{/if}
			{#if hidden}
				<p class="mhint">{t('settings.toolProviders.hidden', { n: hidden, format: t(`settings.catalog.protocol.${format}`) })}</p>
			{/if}
			<div class="madd">
				<TextField bind:value={typed} disabled={busy} mono placeholder={t('settings.toolProviders.typeModel')} />
				<Button type="button" size="sm" disabled={busy || !typed.trim()} onclick={addTyped}>
					<PlusIcon size={14} />
					{t('settings.toolProviders.addModel')}
				</Button>
			</div>
		</div>

		{#if error}<Notice>{error}</Notice>{/if}
	</form>
	{#snippet footer()}
		<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={onClose}>{t('common.cancel')}</Button>
		<Button type="submit" form="tool-provider-form" variant="primary" size="sm" disabled={busy}>{t('common.save')}</Button>
	{/snippet}
</Modal>

<style>
	.ed {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 18px 20px 16px;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.f {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.f > span:first-child {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.sub {
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.models {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.mhead {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 28px;
	}
	.mtitle {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.mcount {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.grow {
		flex: 1;
	}
	.mlist {
		display: flex;
		flex-direction: column;
		max-height: 264px;
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding-right: 6px;
		border-radius: calc(var(--r) - 3px);
		transition: background var(--t-fast) var(--ease-out);
	}
	.mrow:hover {
		background: var(--surface2);
	}
	.mpick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 6px 8px;
		border: none;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--dim);
		cursor: pointer;
	}
	.mrow.on .mpick {
		color: var(--text);
	}
	.box {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		border-radius: 4px;
		border: 1px solid var(--border);
		color: var(--bg);
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.box.on {
		background: var(--text);
		border-color: var(--text);
	}
	.mid {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mmeta {
		flex: none;
		max-width: 45%;
		font-size: var(--fs-2xs);
		color: var(--dim2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.deftag,
	.setdef {
		flex: none;
		font-size: var(--fs-2xs);
		padding: 1px 7px;
		border-radius: var(--r);
		white-space: nowrap;
	}
	.deftag {
		color: var(--text);
		border: 1px solid var(--border);
	}
	.setdef {
		border: 1px solid transparent;
		background: none;
		font-family: inherit;
		color: var(--dim2);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.mrow:hover .setdef,
	.setdef:focus-visible {
		opacity: 1;
	}
	.setdef:hover {
		color: var(--text);
		border-color: var(--hairline);
	}
	.mempty,
	.mhint {
		margin: 0;
		font-size: var(--fs-2xs);
		line-height: 1.5;
		color: var(--dim2);
	}
	.mempty {
		padding: 8px;
	}
	.madd {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.madd :global(.tf) {
		flex: 1;
	}
</style>
