<script lang="ts">
	// Settings → 智能体 → Claude Code / Codex: the tool's own custom providers.
	// A list (each opens its editor) and which one new sessions start on; a
	// draft may pick another in its provider menu. The daemon stores them and
	// keeps the keys. Local desktop only: the daemon refuses these ops from
	// phones.
	import { onMount } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import type { ToolApiProvider } from '$lib/protocol';
	import { changeToolProviders, loadToolProviders, toolProviderConfigs } from '$lib/toolProviders.svelte';
	import { BACKEND_LABELS } from '$lib/backends';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { t } from '$lib/i18n';
	import ToolProviderEditor from './ToolProviderEditor.svelte';

	let { tool }: { tool: 'claude' | 'codex' } = $props();

	const toolName = $derived(BACKEND_LABELS[tool]);
	const config = $derived(toolProviderConfigs[tool]);
	const providers = $derived(config?.providers ?? []);

	// The Select's value, put back to the saved one when a change fails.
	let selected = $state('');
	let busy = $state(false);
	let listError = $state('');
	// The editor: null when closed, 'new' to add, else the provider edited.
	let editing = $state<ToolApiProvider | 'new' | null>(null);

	$effect(() => {
		selected = config?.selected ?? '';
	});

	const options = $derived([
		{ value: '', label: t('settings.toolProviders.system', { tool: toolName }) },
		...providers.map((p) => ({ value: p.id, label: p.name }))
	]);

	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
	const host = (url: string) => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};

	async function load() {
		try {
			await loadToolProviders(tool, true);
			listError = '';
		} catch (e) {
			listError = t('settings.toolProviders.loadFailed', { msg: message(e) });
		}
	}

	async function select(id: string) {
		busy = true;
		try {
			await changeToolProviders(tool, 'tool_provider_select', { provider_id: id });
			listError = '';
		} catch (e) {
			listError = message(e);
			selected = config?.selected ?? '';
		} finally {
			busy = false;
		}
	}

	async function remove(p: ToolApiProvider) {
		const ok = await confirm({
			title: t('settings.toolProviders.deleteTitle', { name: p.name }),
			message: t('settings.toolProviders.deleteMessage'),
			confirmLabel: t('settings.toolProviders.remove'),
			danger: true
		});
		if (!ok) return;
		busy = true;
		try {
			await changeToolProviders(tool, 'tool_provider_remove', { provider_id: p.id });
			listError = '';
		} catch (e) {
			listError = message(e);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<div class="tp">
	<div class="tphead">
		<span class="title">{t('settings.toolProviders.title')}</span>
		<span class="grow"></span>
		{#if config}
			<Button variant="ghost" size="sm" disabled={busy} onclick={() => (editing = 'new')}>
				<PlusIcon size={14} />
				{t('settings.toolProviders.add')}
			</Button>
		{/if}
	</div>
	<p class="hint">{t('settings.toolProviders.hint', { tool: toolName })}</p>
	{#if listError}
		<Notice onDismiss={config ? () => (listError = '') : undefined}>{listError}</Notice>
		{#if !config}
			<div><Button variant="secondary" size="sm" onclick={load}>{t('common.retry')}</Button></div>
		{/if}
	{/if}
	{#if providers.length}
		<div class="list">
			{#each providers as p (p.id)}
				<div class="prow">
					<button class="pmain" disabled={busy} onclick={() => (editing = p)} title={t('settings.toolProviders.edit')}>
						<span class="pline">
							<span class="pname">{p.name}</span>
							{#if config?.selected === p.id}<span class="ptag">{t('settings.toolProviders.isDefault')}</span>{/if}
						</span>
						<span class="pdetail" title={p.base_url}>
							{host(p.base_url)} · {t('settings.toolProviders.modelCount', { n: p.models.length })} · {p.model}
						</span>
					</button>
					<IconButton
						size="sm"
						disabled={busy}
						onclick={() => remove(p)}
						label={t('settings.toolProviders.remove')}
						title={t('settings.toolProviders.remove')}
					>
						<TrashIcon size={13} />
					</IconButton>
				</div>
			{/each}
		</div>
		<div class="defrow">
			<span class="deflabel">{t('settings.toolProviders.defaultLabel')}</span>
			<div class="selw"><Select bind:value={selected} {options} disabled={busy} onChange={select} /></div>
		</div>
	{/if}
</div>

{#if editing}
	<ToolProviderEditor
		{tool}
		provider={editing === 'new' ? undefined : editing}
		taken={providers.map((p) => p.id)}
		onClose={() => (editing = null)}
	/>
{/if}

<style>
	.tp {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		max-width: 520px;
	}
	.tphead {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 28px;
	}
	.title {
		font-size: var(--fs-xs);
		font-weight: 600;
	}
	.grow {
		flex: 1;
	}
	.hint {
		margin: 0;
		font-size: var(--fs-2xs);
		line-height: 1.5;
		color: var(--dim);
	}
	.list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		overflow: hidden;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		padding-right: 8px;
		transition: background var(--t-fast) var(--ease-out);
	}
	.prow + .prow {
		border-top: 1px solid var(--hairline);
	}
	.prow:hover {
		background: var(--surface2);
	}
	.pmain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 9px 12px;
		border: none;
		background: none;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}
	.pline {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.pname {
		font-size: var(--fs-xs);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ptag {
		flex: none;
		font-size: var(--fs-2xs);
		padding: 0 6px;
		border-radius: var(--r);
		border: 1px solid var(--border);
		color: var(--dim);
	}
	.pdetail {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.defrow {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 2px;
	}
	.deflabel {
		font-size: var(--fs-2xs);
		color: var(--dim);
		white-space: nowrap;
	}
	.selw {
		width: 300px;
		max-width: 100%;
	}
</style>
