<script lang="ts">
    import { onMount } from 'svelte';
    import { toolProviders, type ToolApiProvider, type ToolProviderConfig } from '$lib/protocol';
    import Button from '$lib/ui/Button.svelte';
    import Select from '$lib/ui/Select.svelte';
    import TextField from '$lib/ui/TextField.svelte';
    import { t } from '$lib/i18n';

    let { tool }: { tool: 'claude' | 'codex' } = $props();
    let config = $state<ToolProviderConfig>({ selected: '', providers: [] });
    let loaded = $state(false);
    let busy = $state(false);
    let error = $state('');
    let editing = $state(false);
    let existing = $state(false);
    const empty = () => ({ id: '', name: '', base_url: '', format: tool === 'claude' ? 'anthropic' as const : 'responses' as const, model: '', key: '' });
    let form = $state(empty());
    const options = $derived([
        { value: '', label: t('settings.toolProviders.system') },
        ...config.providers.map(p => ({ value: p.id, label: p.name }))
    ]);
    async function run(action = 'tool_providers', fields: Record<string, unknown> = {}) {
        busy = true;
        error = '';
        try { config = await toolProviders(tool, action, fields); loaded = true; return true; }
        catch (e) { error = String(e); return false; }
        finally { busy = false; }
    }
    onMount(() => { void run(); });
    function edit(provider?: ToolApiProvider) {
        form = provider ? { ...provider, key: '' } : empty();
        existing = !!provider;
        editing = true;
        error = '';
    }
    async function save() {
        if (await run('tool_provider_save', { provider: form })) { editing = false; form = empty(); }
    }
</script>

<div class="providers">
    <div class="heading">
        <span>{t('settings.toolProviders.title')}</span>
        <Button size="sm" disabled={!loaded || busy} onclick={() => edit()}>{t('settings.custom.add')}</Button>
    </div>
    <p>{t('settings.toolProviders.hint')}</p>
    {#if loaded}
        <label class="field"><span>{t('settings.toolProviders.default')}</span>
            <Select value={config.selected} {options} disabled={busy} onChange={(id) => { void run('tool_provider_select', { provider_id: id }); }} />
        </label>
        {#each config.providers as provider (provider.id)}
            <div class="provider">
                <div class="details"><strong>{provider.name}</strong><span>{provider.model} · {provider.format === 'anthropic' ? 'Anthropic Messages' : 'OpenAI Responses'}</span><span class="url">{provider.base_url}</span></div>
                <Button size="sm" disabled={busy} onclick={() => edit(provider)}>{t('common.edit')}</Button>
                <Button size="sm" disabled={busy} onclick={() => { void run('tool_provider_remove', { provider_id: provider.id }); }}>{t('common.delete')}</Button>
            </div>
        {/each}
    {/if}
    {#if editing}
        <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
            <div class="grid">
                <label class="field"><span>{t('settings.custom.providerId')}</span><TextField bind:value={form.id} disabled={existing || busy} placeholder="my-provider" /></label>
                <label class="field"><span>{t('settings.toolProviders.name')}</span><TextField bind:value={form.name} disabled={busy} /></label>
            </div>
            <label class="field"><span>{t('settings.custom.format')}</span><Select value={form.format} disabled options={[{value: form.format, label: tool === 'claude' ? 'Anthropic Messages' : 'OpenAI Responses'}]} /></label>
            <label class="field"><span>{t('settings.custom.baseUrl')}</span><TextField bind:value={form.base_url} disabled={busy} mono placeholder="https://api.example.com/v1" /></label>
            <label class="field"><span>{t('settings.custom.apiKey')}</span><TextField bind:value={form.key} disabled={busy} type="password" mono placeholder={existing ? t('settings.toolProviders.keepKey') : 'sk-…'} /></label>
            <label class="field"><span>{t('settings.custom.modelName')}</span><TextField bind:value={form.model} disabled={busy} mono /></label>
            <div class="actions"><Button size="sm" disabled={busy} onclick={() => { editing = false; form = empty(); }}>{t('common.cancel')}</Button><Button variant="primary" size="sm" disabled={busy || !form.id.trim() || !form.base_url.trim() || !form.model.trim() || (!existing && !form.key.trim())} onclick={save}>{t('common.save')}</Button></div>
        </form>
    {/if}
    {#if error}<p role="alert" class="error">{error}</p>{/if}
</div>

<style>
    .providers { display: flex; flex-direction: column; gap: 10px; padding: 14px 0; border-top: 1px solid var(--hairline); }
    .heading, .provider, .actions { display: flex; align-items: center; gap: 8px; }
    .heading { justify-content: space-between; font-size: var(--fs-sm); font-weight: 600; }
    p { margin: 0; color: var(--dim); font-size: var(--fs-xs); line-height: 1.6; }
    .field, .details { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field > span, .details > span { font-size: var(--fs-xs); color: var(--dim); }
    .details { flex: 1; }
    strong { font-size: var(--fs-sm); font-weight: 500; }
    .url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    form { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--surface2); border-radius: var(--r); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .actions { justify-content: flex-end; }
    .error { color: var(--danger); }
    @media (max-width: 540px) { .grid { grid-template-columns: 1fr; } .provider { flex-wrap: wrap; } .details { flex-basis: 100%; } }
</style>
