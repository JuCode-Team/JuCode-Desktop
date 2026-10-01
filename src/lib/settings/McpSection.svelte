<script lang="ts">
	// Settings → 扩展 → MCP 服务器: server management + read-only extensions info.
	// Changes go to the daemon, which saves them and applies them to every open
	// JuCode session; the live view (connection state, tools) comes from the
	// active session's engine when there is one.
	import { onMount } from 'svelte';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';
	import CircleDashedIcon from 'phosphor-svelte/lib/CircleDashedIcon';
	import { changeMcpServers, readConfig, type Op } from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import type { ChatState } from '$lib/chat.svelte';
	import {
		emptyMcpForm,
		entryToForm,
		formToEntry,
		mergeServers,
		parseConfigExtensions,
		parseConfigServers,
		validateMcpForm,
		type ExtensionInfo,
		type McpFormErrors,
		type McpFormValues,
		type McpRow,
		type McpServerEntry,
		type McpTransport
	} from '$lib/mcp';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { t } from '$lib/i18n';
	import { isDraft } from '$lib/backends/router';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let { sessionId, chat }: { sessionId: string; chat?: ChatState } = $props();

	// A live engine reports the servers' state; an exited one can't, and a
	// draft has none (asking would start it).
	const live = $derived(!!chat && !!sessionId && chat.engineState !== 'exited' && !isDraft(sessionId));

	// Persisted config entries (edit-form source + no-session fallback), kept in
	// sync optimistically on every mutation we send.
	let configEntries = $state<McpServerEntry[] | null>(null);
	let extensions = $state<ExtensionInfo[]>([]);
	let expanded = $state<string | null>(null);
	let editing = $state<string | null>(null); // server name, or '__new__'
	let form = $state<McpFormValues>(emptyMcpForm());
	let errors = $state<McpFormErrors>({});
	let confirmDelete = $state<string | null>(null);
	let opError = $state('');

	const rows = $derived(mergeServers(configEntries, chat?.mcpServers ?? null));
	const TRANSPORTS = [
		{ value: 'stdio', label: 'stdio' },
		{ value: 'http', label: 'http' }
	];

	onMount(() => {
		readConfig()
			.then((cfg) => {
				configEntries = parseConfigServers(cfg);
				extensions = parseConfigExtensions(cfg);
			})
			.catch(() => (configEntries = []));
		// Ask the engine for the current view; it also pushes updates after
		// every mutation/state change, which land in chat.mcpServers.
		if (live) dispatch(sessionId, { op: 'mcp_list' }, (e) => (opError = String(e)));
	});

	function send(op: Op) {
		opError = '';
		changeMcpServers(op).catch((e) => (opError = String(e)));
	}

	function upsertLocal(entry: McpServerEntry) {
		const list = configEntries ?? [];
		const i = list.findIndex((e) => e.name === entry.name);
		if (i >= 0) list[i] = entry;
		else list.push(entry);
		configEntries = [...list];
	}

	function openCreate() {
		form = emptyMcpForm();
		errors = {};
		editing = '__new__';
	}
	function openEdit(row: McpRow) {
		form = row.entry
			? entryToForm(row.entry)
			: { ...emptyMcpForm(), name: row.name, transport: row.transport };
		errors = {};
		editing = row.name;
	}
	function submit() {
		errors = validateMcpForm(form);
		if (Object.keys(errors).length) return;
		const entry = formToEntry(form);
		send({ op: 'mcp_set', server: entry });
		upsertLocal(entry);
		editing = null;
	}
	function remove(name: string) {
		send({ op: 'mcp_remove', name });
		configEntries = (configEntries ?? []).filter((e) => e.name !== name);
		confirmDelete = null;
		if (expanded === name) expanded = null;
		if (editing === name) editing = null;
	}
	function toggle(row: McpRow, enabled: boolean) {
		send({ op: 'mcp_toggle', name: row.name, enabled });
		if (row.entry) upsertLocal({ ...row.entry, enabled });
	}
	// Reconnect = resend the full entry via mcp_set (the engine reconnects on set).
	function reconnect(row: McpRow) {
		if (row.entry) send({ op: 'mcp_set', server: row.entry });
	}

	const stateOf = (row: McpRow) => row.view?.state ?? 'unknown';
</script>

<SettingsSection id="mcp-servers" title={t('settings.mcp.groupLabel')} description={t('settings.mcp.hint')}>
	{#if !live}
		<div class="pad"><Notice tone="info">{t('settings.mcp.noSession')}</Notice></div>
	{/if}
	{#if opError}
		<div class="pad"><Notice>{opError}</Notice></div>
	{/if}

	{#if rows.length === 0 && editing !== '__new__'}
		<div class="mcp-empty">
			<p>{t('settings.mcp.empty')}</p>
			<Button variant="primary" size="sm" onclick={openCreate}>
				<PlusIcon size={14} /> {t('settings.mcp.addServer')}
			</Button>
		</div>
	{:else if rows.length > 0}
		{#each rows as row (row.name)}
			<div class="srow" class:open={expanded === row.name}>
				<div class="shead">
					<button
						class="smain"
						onclick={() => (expanded = expanded === row.name ? null : row.name)}
						aria-expanded={expanded === row.name}
					>
						<span
							class="state {stateOf(row)}"
							title={row.view?.error ?? t(`settings.mcp.state.${stateOf(row)}`)}
						>{#if stateOf(row) === 'connected'}<CheckCircleIcon size={14} />{:else if stateOf(row) === 'failed'}<XCircleIcon size={14} />{:else}<CircleDashedIcon size={14} />{/if}</span>
						<span class="sname">{row.name}</span>
						<span class="tchip">{row.transport}</span>
						<span class="scount">
							{#if row.view}
								{row.view.tools.length
									? t('settings.mcp.tools', { n: row.view.tools.length })
									: t(`settings.mcp.state.${stateOf(row)}`)}
							{:else}
								{t('settings.mcp.state.unknown')}
							{/if}
						</span>
						<span class="chev" class:up={expanded === row.name}><CaretDownIcon size={14} /></span>
					</button>
					<span class="sacts">
						{#if live && stateOf(row) === 'failed' && row.entry}
							<IconButton size="sm" title={t('settings.mcp.reconnect')} onclick={() => reconnect(row)}>
								<ArrowClockwiseIcon size={14} />
							</IconButton>
						{/if}
						<span class="swwrap">
							<Switch bind:checked={() => row.enabled, (v) => toggle(row, v)} label={row.name} />
						</span>
						<IconButton size="sm" title={t('settings.mcp.edit')} onclick={() => openEdit(row)}>
							<PencilSimpleIcon size={14} />
						</IconButton>
						<IconButton
							size="sm"
							title={t('common.delete')}
							onclick={() => (confirmDelete = confirmDelete === row.name ? null : row.name)}
						>
							<TrashIcon size={14} />
						</IconButton>
					</span>
				</div>
				{#if confirmDelete === row.name}
					<div class="sconfirm">
						<span>{t('settings.mcp.deleteConfirm', { name: row.name })}</span>
						<Button variant="danger" size="sm" onclick={() => remove(row.name)}>{t('common.delete')}</Button>
						<Button variant="ghost" size="sm" onclick={() => (confirmDelete = null)}>{t('common.cancel')}</Button>
					</div>
				{/if}
				{#if expanded === row.name}
					<div class="sdetail">
						{#if row.view?.error}
							<div class="serr"><Notice mono>{row.view.error}</Notice></div>
						{/if}
						{#if row.view?.tools.length}
							<ul class="tlist">
								{#each row.view.tools as tool (tool.name)}
									<li>
										<span class="tname">{tool.name}</span>
										{#if tool.description}<span class="tdesc">{tool.description}</span>{/if}
									</li>
								{/each}
							</ul>
						{:else if !row.view?.error}
							<p class="tdesc">
								{row.view ? t('settings.mcp.noTools') : t('settings.mcp.state.unknown')}
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	{/if}

	{#if editing !== null}
		<div class="newsrv">
			<div class="ns-title">
				{t(editing === '__new__' ? 'settings.mcp.form.addTitle' : 'settings.mcp.form.editTitle')}
			</div>
			<div class="ns-grid">
				<label class="ns-f">
					<span>{t('settings.mcp.form.name')}</span>
					<TextField bind:value={form.name} mono placeholder={t('settings.mcp.form.namePlaceholder')} disabled={editing !== '__new__'} />
					{#if errors.name}<span class="ferr">{t(`settings.mcp.err.${errors.name}`)}</span>{/if}
				</label>
				<div class="ns-f">
					<span>{t('settings.mcp.form.transport')}</span>
					<Segmented value={form.transport} options={TRANSPORTS} onChange={(v) => (form.transport = v as McpTransport)} />
				</div>
			</div>
			{#if form.transport === 'stdio'}
				<label class="ns-f">
					<span>{t('settings.mcp.form.command')}</span>
					<TextField bind:value={form.command} mono placeholder={t('settings.mcp.form.commandPlaceholder')} />
					{#if errors.command}<span class="ferr">{t(`settings.mcp.err.${errors.command}`)}</span>{/if}
				</label>
				<label class="ns-f">
					<span>{t('settings.mcp.form.args')}</span>
					<textarea class="ta" rows="2" bind:value={form.argsText} placeholder={t('settings.mcp.form.argsPlaceholder')}></textarea>
				</label>
				<label class="ns-f">
					<span>{t('settings.mcp.form.env')}</span>
					<textarea class="ta" rows="2" bind:value={form.envText} placeholder={t('settings.mcp.form.envPlaceholder')}></textarea>
					{#if errors.env}<span class="ferr">{t(`settings.mcp.err.${errors.env}`)}</span>{/if}
				</label>
			{:else}
				<label class="ns-f">
					<span>{t('settings.mcp.form.url')}</span>
					<TextField bind:value={form.url} mono placeholder={t('settings.mcp.form.urlPlaceholder')} />
					{#if errors.url}<span class="ferr">{t(`settings.mcp.err.${errors.url}`)}</span>{/if}
				</label>
				<label class="ns-f">
					<span>{t('settings.mcp.form.bearer')}</span>
					<TextField bind:value={form.bearerToken} type="password" mono placeholder="token…" />
					<span class="fhint">{t('settings.mcp.form.bearerHint')}</span>
				</label>
				<label class="ns-f">
					<span>{t('settings.mcp.form.headers')}</span>
					<textarea class="ta" rows="2" bind:value={form.headersText} placeholder={t('settings.mcp.form.headersPlaceholder')}></textarea>
					{#if errors.headers}<span class="ferr">{t(`settings.mcp.err.${errors.headers}`)}</span>{/if}
				</label>
			{/if}
			<div class="ns-grid">
				<label class="ns-f">
					<span>{t('settings.mcp.form.timeout')}</span>
					<TextField bind:value={form.timeoutText} align="right" placeholder={t('settings.mcp.form.timeoutPlaceholder')} />
					{#if errors.timeout}<span class="ferr">{t(`settings.mcp.err.${errors.timeout}`)}</span>{/if}
				</label>
				<div class="ns-f">
					<span>{t('settings.mcp.form.enabledLabel')}</span>
					<span class="ns-sw"><Switch bind:checked={form.enabled} label={t('settings.mcp.form.enabledLabel')} /></span>
				</div>
			</div>
			<div class="ns-foot">
				<Button variant="ghost" size="sm" onclick={() => (editing = null)}>{t('common.cancel')}</Button>
				<Button variant="primary" size="sm" onclick={submit}>{t('settings.mcp.form.save')}</Button>
			</div>
		</div>
	{:else if rows.length > 0}
		<button class="addsrv" onclick={openCreate}>
			<PlusIcon size={15} /> {t('settings.mcp.addServer')}
		</button>
	{/if}
</SettingsSection>

<SettingsSection id="mcp-extensions" title={t('settings.ext.groupLabel')} description={t('settings.ext.hint')}>
	{#if extensions.length === 0}
		<SettingsRow description={t('settings.ext.empty')} />
	{:else}
		{#each extensions as ext (ext.name)}
			<div class="erow">
				<span class="ename">{ext.name}</span>
				<span class="ecmd">{ext.command}</span>
				{#if ext.lazy}<span class="tchip">{t('settings.ext.lazy')}</span>{/if}
			</div>
		{/each}
	{/if}
</SettingsSection>

<style>

	.pad {
		padding: 14px 18px;
	}
	.mcp-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 26px 18px;
		text-align: center;
	}
	.mcp-empty p {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim);
	}

	.shead {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px 6px 0;
	}
	.smain {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 12px 10px 18px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.state {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	.state.failed {
		color: var(--err);
	}
	.sname {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tchip {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-full);
		padding: 1px 8px;
		flex-shrink: 0;
	}
	.scount {
		font-size: var(--fs-xs);
		color: var(--dim2);
		white-space: nowrap;
		margin-left: auto;
	}
	.chev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-spring);
		flex-shrink: 0;
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.sacts {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.swwrap {
		display: inline-flex;
		margin: 0 3px;
	}
	.sconfirm {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 8px 12px;
		font-size: var(--fs-xs);
		color: var(--dim);
		background: color-mix(in oklab, var(--err) 7%, transparent);
		border-top: 1px solid var(--hairline);
	}
	.sconfirm span {
		margin-right: auto;
	}
	.sdetail {
		padding: 4px 18px 12px 41px;
		border-top: 1px dashed var(--hairline);
	}
	.serr {
		margin: 8px 0 4px;
	}
	.tlist {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tlist li {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	.tname {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		flex-shrink: 0;
	}
	.tdesc {
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.addsrv {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		padding: 14px 18px;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.addsrv:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.addsrv:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* add/edit form (mirrors the custom-provider form) */
	.newsrv {
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 11px;
	}
	.ns-title {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.ns-grid {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: start;
	}
	.ns-f {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.ns-f > span:first-child {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.ns-sw {
		display: inline-flex;
		padding: 6px 0;
	}
	.ta {
		width: 100%;
		min-width: 0;
		resize: vertical;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 9px 11px;
		font-size: var(--fs-sm);
		font-family: var(--font-mono);
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.ta::placeholder {
		color: var(--dim2);
		font-family: var(--font-sans);
	}
	.ta:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.ferr {
		font-size: var(--fs-xs);
		color: var(--err);
	}
	.fhint {
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.ns-foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* extensions (read-only) */
	.erow {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 18px;
		min-width: 0;
	}
	.ename {
		font-size: var(--fs-sm);
		flex-shrink: 0;
	}
	.ecmd {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
