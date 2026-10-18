<script lang="ts">
	// Settings → 编程智能体 → ACP: the built-in agents the daemon starts by
	// id (read-only: whether each is installed), then the registry of Agent
	// Client Protocol agents the desktop may launch (id, name, command, args,
	// env). The registry itself is owned and validated by the Rust side
	// (acp_registry.rs) — this UI only reads it and submits whole entries.
	import { onMount } from 'svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import {
		acpPresets,
		acpAgentCheck,
		acpAgentRemove,
		acpAgentUpsert,
		acpAgentsList,
		type AcpAgent,
		type AcpPreset,
		type BackendStatus
	} from '$lib/protocol';
	import { formatArgs, slugifyAgentId, tokenizeArgs } from '$lib/backends/acp-agents';
	import { formatEnvLines, parseEnvLines, versionLabel } from '$lib/backends/settings';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';

	let presets = $state<AcpPreset[]>([]);
	let presetsError = $state('');
	let copied = $state('');
	let agents = $state<AcpAgent[]>([]);
	let status = $state<Record<string, BackendStatus | 'checking'>>({});
	let open = $state<Record<string, boolean>>({});
	// Editable projections of each agent's args / env (parsed on change).
	let argsText = $state<Record<string, string>>({});
	let envText = $state<Record<string, string>>({});
	let rowError = $state<Record<string, string>>({});
	let listError = $state('');

	// Add-agent draft form.
	let adding = $state(false);
	let draft = $state({ name: '', command: '', args: '', env: '' });
	let draftError = $state('');

	function syncTexts() {
		for (const a of agents) {
			argsText[a.id] = formatArgs(a.args);
			envText[a.id] = formatEnvLines(a.env);
		}
	}

	function loadPresets() {
		acpPresets()
			.then((list) => {
				presets = list;
				presetsError = '';
			})
			.catch((e) => (presetsError = String(e)));
	}

	async function copyInstall(p: AcpPreset) {
		await navigator.clipboard.writeText(p.install);
		copied = p.id;
		setTimeout(() => (copied = ''), 1500);
	}

	function load() {
		acpAgentsList()
			.then((list) => {
				agents = list;
				listError = '';
				syncTexts();
				for (const a of list) check(a.id);
			})
			.catch((e) => (listError = String(e)));
	}

	function check(id: string) {
		status[id] = 'checking';
		acpAgentCheck(id)
			.then((s) => (status[id] = s))
			.catch(() => (status[id] = { found: false }));
	}

	function persist(agent: AcpAgent) {
		acpAgentUpsert(agent)
			.then((list) => {
				agents = list;
				rowError[agent.id] = '';
				syncTexts();
				check(agent.id);
			})
			.catch((e) => (rowError[agent.id] = String(e)));
	}

	function onFieldChange(agent: AcpAgent) {
		const { env, invalid } = parseEnvLines(envText[agent.id] ?? '');
		if (invalid.length) {
			rowError[agent.id] = t('settings.acp.envInvalid', { lines: invalid.join(', ') });
			return;
		}
		persist({ ...agent, args: tokenizeArgs(argsText[agent.id] ?? ''), env });
	}

	function remove(id: string) {
		acpAgentRemove(id)
			.then((list) => {
				agents = list;
				listError = '';
				syncTexts();
			})
			.catch((e) => (listError = String(e)));
	}

	function saveDraft() {
		const name = draft.name.trim();
		const command = draft.command.trim();
		if (!name || !command) {
			draftError = t('settings.acp.needNameCommand');
			return;
		}
		const { env, invalid } = parseEnvLines(draft.env);
		if (invalid.length) {
			draftError = t('settings.acp.envInvalid', { lines: invalid.join(', ') });
			return;
		}
		// A built-in agent's id is taken too: a session names its agent by id.
		const id = slugifyAgentId(name, new Set([...agents, ...presets].map((a) => a.id)));
		acpAgentUpsert({ id, name, command, args: tokenizeArgs(draft.args), env })
			.then((list) => {
				agents = list;
				draftError = '';
				adding = false;
				draft = { name: '', command: '', args: '', env: '' };
				syncTexts();
				check(id);
			})
			.catch((e) => (draftError = String(e)));
	}

	onMount(() => {
		loadPresets();
		load();
	});
</script>

<SettingsSection id="acp-presets" title={t('settings.acp.presets')} description={t('settings.acp.presetsHint')}>
	{#snippet action()}
		<IconButton onclick={loadPresets} label="re-check agents" title={t('settings.acp.recheck')}>
			<RotateCwIcon size={14} />
		</IconButton>
	{/snippet}
	{#if presetsError}
		<div class="pad"><Notice>{presetsError}</Notice></div>
	{/if}
	{#each presets as p (p.id)}
		<div class="arow">
			<span class="atile"><BackendIcon backend="acp" agent={p.id} size={16} /></span>
			<div class="amain">
				<div class="ahead">
					<span class="aname">{p.name}</span>
					{#if p.status === 'ready'}
						<span class="astate ok"><CircleCheckIcon size={12} /> {p.version || t('settings.acp.found')}</span>
					{:else if p.status === 'unsupported'}
						<span class="astate warn"><CircleAlertIcon size={12} /> {t('settings.acp.tooOld', { min: p.min_version ?? '' })}</span>
					{:else}
						<span class="astate dim">{t('settings.acp.notInstalled')}</span>
					{/if}
					{#if !p.approvals}<span class="astate dim">{t('chat.noApproval')}</span>{/if}
				</div>
				{#if p.status === 'ready' && p.path}
					<span class="acmd" title={p.path}>{p.path}</span>
				{/if}
				{#if p.id === 'opencode'}
					<span class="anote">{t('settings.acp.ownModels')}</span>
				{/if}
				{#if p.status !== 'ready'}
					<div class="install">
						<span class="anote">{t('settings.acp.installWith')}</span>
						<code class="acmd" title={p.install}>{p.install}</code>
						<IconButton size="sm" onclick={() => copyInstall(p)} label={t('common.copy')} title={copied === p.id ? t('common.copied') : t('common.copy')}>
							{#if copied === p.id}<CheckIcon size={13} />{:else}<CopyIcon size={13} />{/if}
						</IconButton>
					</div>
				{/if}
			</div>
		</div>
	{/each}
</SettingsSection>

<SettingsSection id="acp-agents" title={t('settings.acp.groupLabel')} description={t('settings.acp.hint')}>
	{#if listError}
		<div class="pad"><Notice>{listError}</Notice></div>
	{/if}
	{#each agents as agent (agent.id)}
		{@const st = status[agent.id]}
		<div class="arow">
			<span class="atile"><BackendIcon backend="acp" size={16} /></span>
			<div class="amain">
				<div class="ahead">
					<span class="aname">{agent.name}</span>
					{#if st === 'checking'}
						<span class="astate dim">{t('settings.acp.checking')}</span>
					{:else if st && st.found}
						<span class="astate ok"><CircleCheckIcon size={12} /> {versionLabel(st) || t('settings.acp.found')}</span>
					{:else if st}
						<span class="astate warn"><CircleAlertIcon size={12} /> {t('settings.acp.notFound')}</span>
					{/if}
				</div>
				<span class="acmd" title="{agent.command} {formatArgs(agent.args)}">
					{agent.command} {formatArgs(agent.args)}
				</span>
				<button class="edithead" onclick={() => (open[agent.id] = !open[agent.id])}>
					<span class="chev" class:open={open[agent.id]}><ChevronRightIcon size={12} /></span>
					{t('settings.acp.edit')}
				</button>
				{#if open[agent.id]}
					<div class="editbox">
						<label class="fl">
							<span>{t('settings.acp.command')}</span>
							<input class="tf" bind:value={agent.command} onchange={() => onFieldChange(agent)} placeholder={t('settings.acp.commandPlaceholder')} />
						</label>
						<label class="fl">
							<span>{t('settings.acp.args')}</span>
							<input class="tf" bind:value={argsText[agent.id]} onchange={() => onFieldChange(agent)} placeholder={t('settings.acp.argsPlaceholder')} />
						</label>
						<label class="fl">
							<span>{t('settings.acp.env')}</span>
							<textarea class="tf envta" rows="2" bind:value={envText[agent.id]} onchange={() => onFieldChange(agent)} placeholder={t('settings.acp.envPlaceholder')}></textarea>
						</label>
						{#if rowError[agent.id]}
							<Notice>{rowError[agent.id]}</Notice>
						{/if}
					</div>
				{/if}
			</div>
			<IconButton onclick={() => check(agent.id)} label="re-check agent" title={t('settings.acp.recheck')}>
				<RotateCwIcon size={14} />
			</IconButton>
			<IconButton onclick={() => remove(agent.id)} label="remove agent" title={t('settings.acp.remove')}>
				<TrashIcon size={14} />
			</IconButton>
		</div>
	{/each}
	{#if !agents.length && !listError}
		<p class="empty">{t('settings.acp.empty')}</p>
	{/if}

	{#if adding}
		<div class="draft">
			<label class="fl">
				<span>{t('settings.acp.name')}</span>
				<TextField mono bind:value={draft.name} placeholder={t('settings.acp.namePlaceholder')} />
			</label>
			<label class="fl">
				<span>{t('settings.acp.command')}</span>
				<TextField mono bind:value={draft.command} placeholder={t('settings.acp.commandPlaceholder')} />
			</label>
			<label class="fl">
				<span>{t('settings.acp.args')}</span>
				<TextField mono bind:value={draft.args} placeholder={t('settings.acp.argsPlaceholder')} />
			</label>
			<label class="fl">
				<span>{t('settings.acp.env')}</span>
				<textarea class="tf envta" rows="2" bind:value={draft.env} placeholder={t('settings.acp.envPlaceholder')}></textarea>
			</label>
			{#if draftError}
				<Notice>{draftError}</Notice>
			{/if}
			<div class="draftbtns">
				<Button variant="primary" size="sm" onclick={saveDraft}>{t('settings.acp.save')}</Button>
				<Button variant="ghost" size="sm" onclick={() => { adding = false; draftError = ''; }}>{t('settings.acp.cancel')}</Button>
			</div>
		</div>
	{:else}
		<div class="pad">
			<Button variant="secondary" size="sm" onclick={() => (adding = true)}>
				<PlusIcon size={14} />
				{t('settings.acp.add')}
			</Button>
		</div>
	{/if}
</SettingsSection>

<style>
	.arow {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px 18px;
	}
	.pad {
		padding: 14px 18px;
	}
	.atile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--r);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
		margin-top: 2px;
	}
	.amain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.ahead {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	.aname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.astate {
		flex-shrink: 0;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
	}
	.astate.ok {
		color: var(--ok);
	}
	.astate.warn {
		color: var(--warn);
	}
	.astate.dim {
		color: var(--dim2);
	}
	.acmd {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.edithead {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		align-self: flex-start;
		background: none;
		border: none;
		padding: 2px 0;
		font-size: var(--fs-2xs);
		color: var(--dim);
		cursor: pointer;
	}
	.edithead:hover {
		color: var(--text);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.editbox,
	.draft {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 420px;
	}
	.draft {
		padding: 14px 18px;
	}
	.fl {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.fl > span {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.tf {
		width: 100%;
		min-width: 0;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r);
		color: var(--text);
		padding: 8px 10px;
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.tf::placeholder {
		color: var(--dim2);
		font-family: var(--font-sans);
	}
	.tf:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.envta {
		resize: vertical;
		min-height: 44px;
		line-height: 1.5;
	}
	.anote {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.install {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.install .acmd {
		flex: 1;
		min-width: 0;
	}
	.empty {
		margin: 0;
		padding: 14px 18px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.draftbtns {
		display: flex;
		gap: 8px;
	}
</style>
