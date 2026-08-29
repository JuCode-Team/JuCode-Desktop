<script lang="ts">
	// Settings → 行为 → ACP agents: manage the registry of Agent Client
	// Protocol agents the desktop may launch (id, name, command, args, env).
	// The registry itself is owned and validated by the Rust side
	// (acp_registry.rs) — this UI only reads it and submits whole entries.
	import { onMount } from 'svelte';
	import { Plus, Trash2, RotateCw, CircleCheck, CircleAlert, ChevronRight } from 'lucide-svelte';
	import {
		acpAgentCheck,
		acpAgentRemove,
		acpAgentUpsert,
		acpAgentsList,
		type AcpAgent,
		type BackendStatus
	} from '$lib/protocol';
	import { formatArgs, slugifyAgentId, tokenizeArgs } from '$lib/backends/acp-agents';
	import { formatEnvLines, parseEnvLines, versionLabel } from '$lib/backends/settings';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';

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
		const id = slugifyAgentId(name, new Set(agents.map((a) => a.id)));
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

	onMount(load);
</script>

<div class="group">
	<div class="glabel">{t('settings.acp.groupLabel')}</div>
	<p class="hint">{t('settings.acp.hint')}</p>
	{#if listError}
		<p class="err">{listError}</p>
	{/if}

	<div class="alist">
		{#each agents as agent (agent.id)}
			{@const st = status[agent.id]}
			<div class="arow">
				<span class="atile"><BackendIcon backend="acp" size={16} /></span>
				<div class="amain">
					<div class="ahead">
						<span class="aname">{agent.name}</span>
						{#if st === 'checking'}
							<span class="astate dim">{t('settings.acp.checking')}</span>
						{:else if st && st !== 'checking' && st.found}
							<span class="astate ok"><CircleCheck size={12} /> {versionLabel(st) || t('settings.acp.found')}</span>
						{:else if st}
							<span class="astate warn"><CircleAlert size={12} /> {t('settings.acp.notFound')}</span>
						{/if}
					</div>
					<span class="acmd" title="{agent.command} {formatArgs(agent.args)}">
						{agent.command} {formatArgs(agent.args)}
					</span>
					<button class="edithead" onclick={() => (open[agent.id] = !open[agent.id])}>
						<span class="chev" class:open={open[agent.id]}><ChevronRight size={12} /></span>
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
								<span class="err">{rowError[agent.id]}</span>
							{/if}
						</div>
					{/if}
				</div>
				<IconButton onclick={() => check(agent.id)} label="re-check agent" title={t('settings.acp.recheck')}>
					<RotateCw size={14} />
				</IconButton>
				<IconButton onclick={() => remove(agent.id)} label="remove agent" title={t('settings.acp.remove')}>
					<Trash2 size={14} />
				</IconButton>
			</div>
		{/each}
		{#if !agents.length && !listError}
			<p class="empty">{t('settings.acp.empty')}</p>
		{/if}
	</div>

	{#if adding}
		<div class="draft">
			<label class="fl">
				<span>{t('settings.acp.name')}</span>
				<input class="tf" bind:value={draft.name} placeholder={t('settings.acp.namePlaceholder')} />
			</label>
			<label class="fl">
				<span>{t('settings.acp.command')}</span>
				<input class="tf" bind:value={draft.command} placeholder={t('settings.acp.commandPlaceholder')} />
			</label>
			<label class="fl">
				<span>{t('settings.acp.args')}</span>
				<input class="tf" bind:value={draft.args} placeholder={t('settings.acp.argsPlaceholder')} />
			</label>
			<label class="fl">
				<span>{t('settings.acp.env')}</span>
				<textarea class="tf envta" rows="2" bind:value={draft.env} placeholder={t('settings.acp.envPlaceholder')}></textarea>
			</label>
			{#if draftError}
				<span class="err">{draftError}</span>
			{/if}
			<div class="draftbtns">
				<Button variant="primary" size="sm" onclick={saveDraft}>{t('settings.acp.save')}</Button>
				<Button variant="ghost" size="sm" onclick={() => { adding = false; draftError = ''; }}>{t('settings.acp.cancel')}</Button>
			</div>
		</div>
	{:else}
		<Button variant="secondary" size="sm" onclick={() => (adding = true)}>
			<Plus size={14} />
			{t('settings.acp.add')}
		</Button>
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
	.alist {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
		margin-bottom: 10px;
	}
	.arow {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
	}
	.arow + .arow {
		border-top: 1px solid var(--hairline);
	}
	.atile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--r-sm);
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
		font-size: 13px;
		font-weight: 500;
	}
	.astate {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
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
		font-size: 11px;
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
		font-size: 11px;
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
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		padding: 12px 14px;
		margin-bottom: 10px;
	}
	.fl {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.fl > span {
		font-size: 11px;
		color: var(--dim);
	}
	.tf {
		width: 100%;
		min-width: 0;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 8px 10px;
		font-size: 12px;
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
	.err {
		font-size: 11px;
		color: var(--warn);
	}
	.empty {
		margin: 0;
		padding: 12px 14px;
		font-size: 12px;
		color: var(--dim2);
	}
	.draftbtns {
		display: flex;
		gap: 8px;
	}
</style>
