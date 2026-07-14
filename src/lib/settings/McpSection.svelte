<script lang="ts">
	// Settings → 扩展: MCP server management + read-only extensions info.
	// List/mutations go through the active session's engine (the MCP config is
	// global, so any live engine is authoritative); with no live session the
	// config.json entries render read-only.
	import { onMount } from 'svelte';
	import { Plus, Pencil, Trash2, RotateCw, ChevronDown, Server, Blocks } from 'lucide-svelte';
	import { readConfig, sendOp, type Op } from '$lib/protocol';
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
	import Segmented from '$lib/ui/Segmented.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { t } from '$lib/i18n';

	let { sessionId, chat }: { sessionId: string; chat?: ChatState } = $props();

	// A live engine is required for MCP ops; an exited one can't answer.
	const live = $derived(!!chat && !!sessionId && chat.engineState !== 'exited');

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
		if (live) send({ op: 'mcp_list' });
	});

	function send(op: Op) {
		opError = '';
		sendOp(sessionId, op).catch((e) => (opError = String(e)));
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

<div class="group">
	<div class="glabel"><Server size={12} /> {t('settings.mcp.groupLabel')}</div>
	<p class="hint">{t('settings.mcp.hint')}</p>
	{#if !live}
		<div class="notice">{t('settings.mcp.noSession')}</div>
	{/if}
	{#if opError}
		<div class="notice bad">{opError}</div>
	{/if}

	{#if rows.length === 0 && editing !== '__new__'}
		<div class="mcp-empty">
			<p>{t('settings.mcp.empty')}</p>
			<Button variant="primary" size="sm" disabled={!live} onclick={openCreate}>
				<Plus size={14} /> {t('settings.mcp.addServer')}
			</Button>
		</div>
	{:else if rows.length > 0}
		<div class="slist">
			{#each rows as row (row.name)}
				<div class="srow" class:open={expanded === row.name}>
					<div class="shead">
						<button
							class="smain"
							onclick={() => (expanded = expanded === row.name ? null : row.name)}
							aria-expanded={expanded === row.name}
						>
							<span
								class="dot {stateOf(row)}"
								title={row.view?.error ?? t(`settings.mcp.state.${stateOf(row)}`)}
							></span>
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
							<span class="chev" class:up={expanded === row.name}><ChevronDown size={14} /></span>
						</button>
						<span class="sacts">
							{#if live && stateOf(row) === 'failed' && row.entry}
								<IconButton size="sm" title={t('settings.mcp.reconnect')} onclick={() => reconnect(row)}>
									<RotateCw size={14} />
								</IconButton>
							{/if}
							<span class="swwrap" class:off={!live}>
								<Switch bind:checked={() => row.enabled, (v) => toggle(row, v)} label={row.name} />
							</span>
							<IconButton size="sm" title={t('settings.mcp.edit')} disabled={!live} onclick={() => openEdit(row)}>
								<Pencil size={14} />
							</IconButton>
							<IconButton
								size="sm"
								title={t('common.delete')}
								disabled={!live}
								onclick={() => (confirmDelete = confirmDelete === row.name ? null : row.name)}
							>
								<Trash2 size={14} />
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
								<p class="serr">{row.view.error}</p>
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
		</div>
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
		<button class="addsrv" disabled={!live} onclick={openCreate}>
			<Plus size={15} /> {t('settings.mcp.addServer')}
		</button>
	{/if}
</div>

<div class="group">
	<div class="glabel"><Blocks size={12} /> {t('settings.ext.groupLabel')}</div>
	<p class="hint">{t('settings.ext.hint')}</p>
	{#if extensions.length === 0}
		<p class="hint">{t('settings.ext.empty')}</p>
	{:else}
		<div class="elist">
			{#each extensions as ext (ext.name)}
				<div class="erow">
					<span class="ename">{ext.name}</span>
					<span class="ecmd">{ext.command}</span>
					{#if ext.lazy}<span class="tchip">{t('settings.ext.lazy')}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.group {
		margin-top: 22px;
	}
	.glabel {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--dim2);
		margin-bottom: 10px;
	}
	.hint {
		margin: 0 0 10px;
		font-size: 12px;
		color: var(--dim);
	}
	.notice {
		margin: 0 0 10px;
		padding: 9px 12px;
		font-size: 12px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
	}
	.notice.bad {
		color: var(--err);
		border-color: color-mix(in oklab, var(--err) 35%, transparent);
	}

	.mcp-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 26px 16px;
		border: 1px dashed var(--border);
		border-radius: var(--r-md);
		text-align: center;
	}
	.mcp-empty p {
		margin: 0;
		font-size: 12.5px;
		color: var(--dim);
	}

	.slist {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}
	.srow + .srow {
		border-top: 1px solid var(--hairline);
	}
	.shead {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 10px 4px 0;
	}
	.smain {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot.connected {
		background: var(--ok);
	}
	.dot.failed {
		background: var(--err);
	}
	.dot.disabled,
	.dot.unknown {
		background: var(--dim2);
	}
	.dot.connecting {
		background: var(--warn);
		animation: mcp-pulse 1.2s ease-in-out infinite;
	}
	@keyframes mcp-pulse {
		50% {
			opacity: 0.35;
		}
	}
	.sname {
		font-family: var(--font-mono);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tchip {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		padding: 1px 8px;
		flex-shrink: 0;
	}
	.scount {
		font-size: 11.5px;
		color: var(--dim2);
		white-space: nowrap;
		margin-left: auto;
	}
	.chev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform 0.15s;
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
	.swwrap.off {
		pointer-events: none;
		opacity: 0.45;
	}
	.sconfirm {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--dim);
		background: color-mix(in oklab, var(--err) 7%, transparent);
		border-top: 1px solid var(--hairline);
	}
	.sconfirm span {
		margin-right: auto;
	}
	.sdetail {
		padding: 4px 14px 12px 29px;
		border-top: 1px dashed var(--hairline);
	}
	.serr {
		margin: 8px 0 4px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--err);
		word-break: break-all;
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
		font-size: 12px;
		flex-shrink: 0;
	}
	.tdesc {
		font-size: 11.5px;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.addsrv {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		width: 100%;
		margin-top: 8px;
		padding: 10px;
		border: 1px dashed var(--border);
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font-size: 13px;
		cursor: pointer;
	}
	.addsrv:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
		border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
	}
	.addsrv:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* add/edit form (mirrors the custom-provider form card) */
	.newsrv {
		margin-top: 8px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		display: flex;
		flex-direction: column;
		gap: 11px;
	}
	.ns-title {
		font-size: 13px;
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
		font-size: 12px;
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
		font-size: 12.5px;
		font-family: var(--font-mono);
		outline: none;
		transition: border-color 0.12s;
	}
	.ta::placeholder {
		color: var(--dim2);
		font-family: var(--font-sans);
	}
	.ta:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.ferr {
		font-size: 11.5px;
		color: var(--err);
	}
	.fhint {
		font-size: 11px;
		color: var(--dim2);
	}
	.ns-foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* extensions (read-only) */
	.elist {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}
	.erow {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		min-width: 0;
	}
	.erow + .erow {
		border-top: 1px solid var(--hairline);
	}
	.ename {
		font-size: 13px;
		flex-shrink: 0;
	}
	.ecmd {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
