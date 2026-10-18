<script lang="ts">
	// Settings → 智能体 → Claude Code / Codex: the tool's own custom providers
	// (folded away like 路径与环境变量). The daemon stores them and keeps the
	// keys; the default applies to sessions on this machine started or reopened
	// afterwards. Local desktop only: the daemon refuses these ops from phones.
	import { onMount, tick } from 'svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { toolProviders, type ToolApiProvider, type ToolProviderConfig, type ToolProviderOp } from '$lib/protocol';
	import { BACKEND_LABELS } from '$lib/backends';
	import { slugifyAgentId } from '$lib/backends/acp-agents';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { t } from '$lib/i18n';

	let { tool }: { tool: 'claude' | 'codex' } = $props();

	const toolName = $derived(BACKEND_LABELS[tool]);
	const format = $derived(tool === 'claude' ? 'anthropic' : 'responses');

	let config = $state<ToolProviderConfig>({ selected: '', providers: [] });
	// The Select's value, put back to the saved one when a change fails.
	let selected = $state('');
	let loaded = $state(false);
	let busy = $state(false);
	let open = $state(false);
	let listError = $state('');

	// The form: null when closed, '' for a new provider, else the id edited.
	let editing = $state<string | null>(null);
	let form = $state({ name: '', base_url: '', model: '', key: '' });
	let formError = $state('');

	const current = $derived(config.providers.find((p) => p.id === config.selected));
	const options = $derived([
		{ value: '', label: t('settings.toolProviders.system', { tool: toolName }) },
		...config.providers.map((p) => ({ value: p.id, label: p.name }))
	]);

	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

	async function run(op: ToolProviderOp, fields: Record<string, unknown> = {}): Promise<boolean> {
		busy = true;
		try {
			config = await toolProviders(tool, op, fields);
			loaded = true;
			return true;
		} finally {
			selected = config.selected;
			busy = false;
		}
	}

	async function load() {
		try {
			await run('tool_providers');
			listError = '';
		} catch (e) {
			listError = t('settings.toolProviders.loadFailed', { msg: message(e) });
		}
	}

	async function select(id: string) {
		try {
			await run('tool_provider_select', { provider_id: id });
			listError = '';
		} catch (e) {
			listError = message(e);
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
		try {
			await run('tool_provider_remove', { provider_id: p.id });
			listError = '';
			if (editing === p.id) editing = null;
		} catch (e) {
			listError = message(e);
		}
	}

	function edit(p?: ToolApiProvider) {
		form = p ? { name: p.name, base_url: p.base_url, model: p.model, key: '' } : { name: '', base_url: '', model: '', key: '' };
		editing = p?.id ?? '';
		formError = '';
	}

	// The daemon's own checks, so a mistake reads in the app's language.
	function invalid(): string {
		if (!form.name.trim()) return t('settings.toolProviders.needName');
		const url = form.base_url.trim();
		let parsed: URL | null = null;
		try {
			parsed = new URL(url);
		} catch {
			/* reported below */
		}
		if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.host || /[?#@]/.test(url))
			return t('settings.toolProviders.badUrl');
		if (!form.model.trim()) return t('settings.toolProviders.needModel');
		if (!editing && !form.key.trim()) return t('settings.toolProviders.needKey');
		return '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		formError = invalid();
		if (formError) return;
		const name = form.name.trim();
		const id = editing || slugifyAgentId(name, new Set(config.providers.map((p) => p.id)), 'provider');
		try {
			await run('tool_provider_save', {
				provider: { id, name, format, base_url: form.base_url.trim(), model: form.model.trim(), key: form.key.trim() }
			});
			editing = null;
		} catch (e) {
			formError = message(e);
		}
	}

	function focusFirst(node: HTMLElement) {
		void tick().then(() => node.querySelector('input')?.focus());
	}

	onMount(() => {
		void load();
	});
</script>

<div class="tp">
	<button class="tphead" onclick={() => (open = !open)} aria-expanded={open}>
		<span class="chev" class:open><ChevronRightIcon size={12} /></span>
		{t('settings.toolProviders.title')}
		{#if config.providers.length}<span class="count">{config.providers.length}</span>{/if}
		{#if current}<span class="cur">{t('settings.toolProviders.defaultCurrent', { name: current.name })}</span>{/if}
	</button>
	{#if open}
		<div class="tpbox">
			<p class="hint">{t('settings.toolProviders.hint', { tool: toolName })}</p>
			{#if listError}
				<Notice onDismiss={loaded ? () => (listError = '') : undefined}>{listError}</Notice>
				{#if !loaded}
					<div><Button variant="secondary" size="sm" disabled={busy} onclick={load}>{t('common.retry')}</Button></div>
				{/if}
			{/if}
			{#if loaded}
				{#if config.providers.length}
					<label class="field">
						<span>{t('settings.toolProviders.defaultLabel')}</span>
						<div class="selw"><Select bind:value={selected} {options} disabled={busy} onChange={select} /></div>
					</label>
					<div class="list">
						{#each config.providers as p (p.id)}
							<div class="prow">
								<div class="pmain">
									<span class="pname">{p.name}</span>
									<span class="pdetail" title="{p.model} · {p.base_url}">{p.model} · {p.base_url}</span>
								</div>
								<IconButton
									size="sm"
									disabled={busy}
									onclick={() => edit(p)}
									label={t('settings.toolProviders.edit')}
									title={t('settings.toolProviders.edit')}
								>
									<PencilIcon size={13} />
								</IconButton>
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
				{/if}
				{#if editing !== null}
					{@const name = config.providers.find((p) => p.id === editing)?.name ?? ''}
					<form class="form" onsubmit={save} use:focusFirst>
						<div class="ftitle">
							{editing ? t('settings.toolProviders.editTitle', { name }) : t('settings.toolProviders.add')}
						</div>
						<label class="field">
							<span>{t('settings.toolProviders.name')}</span>
							<TextField bind:value={form.name} disabled={busy} placeholder={t('settings.toolProviders.namePlaceholder')} />
						</label>
						<div class="field">
							<span>{t('settings.custom.format')}</span>
							<span class="fixed">{t(`settings.catalog.protocol.${format}`)}</span>
						</div>
						<label class="field">
							<span>{t('settings.custom.baseUrl')}</span>
							<TextField bind:value={form.base_url} disabled={busy} mono placeholder="https://api.example.com/v1" />
						</label>
						<label class="field">
							<span>{t('settings.custom.apiKey')}</span>
							<TextField
								bind:value={form.key}
								disabled={busy}
								type="password"
								mono
								placeholder={editing ? t('settings.toolProviders.keepKey') : 'sk-…'}
							/>
						</label>
						<label class="field">
							<span>{t('settings.toolProviders.model')}</span>
							<TextField bind:value={form.model} disabled={busy} mono placeholder={t('settings.toolProviders.modelPlaceholder')} />
						</label>
						{#if formError}<Notice>{formError}</Notice>{/if}
						<div class="actions">
							<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={() => (editing = null)}>{t('common.cancel')}</Button>
							<Button type="submit" variant="primary" size="sm" disabled={busy}>{t('common.save')}</Button>
						</div>
					</form>
				{:else}
					<div>
						<Button variant="secondary" size="sm" disabled={busy} onclick={() => edit()}>
							<PlusIcon size={14} />
							{t('settings.toolProviders.add')}
						</Button>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.tp {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.tphead {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		align-self: flex-start;
		max-width: 100%;
		min-width: 0;
		background: none;
		border: none;
		padding: 2px 0;
		font-size: var(--fs-2xs);
		color: var(--dim);
		cursor: pointer;
	}
	.tphead:hover {
		color: var(--text);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		padding: 0 5px;
		border-radius: var(--r);
		background: var(--surface2);
		border: 1px solid var(--hairline);
	}
	.cur {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
	}
	.tpbox {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 460px;
		margin-top: 8px;
	}
	.hint {
		margin: 0;
		font-size: var(--fs-2xs);
		line-height: 1.5;
		color: var(--dim);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.field > span {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.field > .fixed {
		font-size: var(--fs-xs);
		color: var(--text);
	}
	.selw {
		width: 220px;
		max-width: 100%;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		padding: 4px 0;
	}
	.pmain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.pname {
		font-size: var(--fs-xs);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pdetail {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
	}
	.ftitle {
		font-size: var(--fs-xs);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
