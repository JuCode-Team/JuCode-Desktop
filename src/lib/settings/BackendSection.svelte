<script lang="ts">
	// Settings → 所有智能体 → 智能体: per-backend availability (check_backend), a
	// one-click install when missing, a one-click upgrade when Claude Code /
	// Codex has a newer release, a binary-path override and extra env
	// (folded away), and the default backend for new sessions. All preferences
	// persist to localStorage immediately.
	import { onMount } from 'svelte';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowCircleUpIcon from 'phosphor-svelte/lib/ArrowCircleUpIcon';
	import {
		checkBackend,
		checkAgentUpdate,
		installCliCommand,
		shellEnvStatus,
		refreshShellEnv,
		type AgentUpdate,
		type BackendStatus,
		type ShellEnvStatus
	} from '$lib/protocol';
	import { NATIVE_BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import {
		loadBackendSettings,
		saveBackendSettings,
		versionLabel,
		parseEnvLines,
		formatEnvLines,
		type BackendSettings
	} from '$lib/backends/settings';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import DepAction from '$lib/DepAction.svelte';
	import DepDetails from '$lib/DepDetails.svelte';
	import { deps, recheckDeps, upgradeDep } from '$lib/deps.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Select from '$lib/ui/Select.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let settings = $state<BackendSettings>(loadBackendSettings());
	let status = $state<Partial<Record<BackendId, BackendStatus | 'checking'>>>({});
	let updates = $state<Partial<Record<BackendId, AgentUpdate>>>({});
	let shellEnv = $state<ShellEnvStatus | null>(null);
	let refreshing = $state(false);
	let advOpen = $state<Partial<Record<BackendId, boolean>>>({});
	let envText = $state<Partial<Record<BackendId, string>>>({});
	let envInvalid = $state<Partial<Record<BackendId, string[]>>>({});

	function persist() {
		saveBackendSettings({
			default: settings.default,
			paths: Object.fromEntries(
				Object.entries(settings.paths).filter(([, v]) => typeof v === 'string' && v.trim())
			) as BackendSettings['paths'],
			env: settings.env,
			remoteAddress: settings.remoteAddress.trim()
		});
	}

	function refreshSnapshot() {
		refreshing = true;
		refreshShellEnv()
			.then((s) => (shellEnv = s))
			.catch(() => {})
			.finally(() => (refreshing = false));
	}


	function onEnvChange(id: BackendId) {
		const { env, invalid } = parseEnvLines(envText[id] ?? '');
		envInvalid[id] = invalid;
		if (Object.keys(env).length) settings.env[id] = env;
		else delete settings.env[id];
		persist();
	}

	// Overrides set under 路径与环境变量: a pinned path counts as one.
	function overrideCount(id: BackendId): number {
		return Object.keys(settings.env[id] ?? {}).length + (settings.paths[id]?.trim() ? 1 : 0);
	}

	// Claude Code and Codex can be upgraded from here; the app's jucode comes
	// with the app.
	const upgradable = (id: BackendId) => id === 'claude' || id === 'codex';

	function check(id: BackendId) {
		status[id] = 'checking';
		delete updates[id];
		const bin = settings.paths[id]?.trim() || undefined;
		checkBackend(id, bin)
			.then((s) => {
				status[id] = s;
				// No version means nothing to compare; a failed lookup (offline)
				// just shows no update.
				if (s.found && s.version && upgradable(id))
					checkAgentUpdate(id, bin)
						.then((u) => (updates[id] = u))
						.catch(() => {});
			})
			.catch(() => (status[id] = { found: false }));
	}

	// Re-probe once an upgrade from this page ends, to show the new version.
	let upgrading = $state<Partial<Record<BackendId, boolean>>>({});
	function upgrade(id: BackendId) {
		upgrading[id] = true;
		upgradeDep(id, settings.paths[id]?.trim() || undefined);
	}
	$effect(() => {
		for (const id of NATIVE_BACKEND_IDS) {
			if (upgrading[id] && !deps.installing[id]) {
				upgrading[id] = false;
				check(id);
			}
		}
	});

	// The app's own jucode (a release build's, kept in ~/.jucode/bin) can
	// become a terminal command.
	const appCli = (path?: string | null) => !!path && /[\\/]\.jucode[\\/]bin[\\/]jucode(\.exe)?$/.test(path);
	let cliCommand = $state<{ ok: boolean; text: string } | null>(null);
	function addCliCommand() {
		installCliCommand()
			.then((where) => (cliCommand = { ok: true, text: t('settings.backend.cliCommandDone', { path: where }) }))
			.catch((e) => (cliCommand = { ok: false, text: String(e) }));
	}

	function onPathChange(id: BackendId) {
		persist();
		check(id);
	}

	function setDefault(id: string) {
		settings.default = id as BackendId;
		persist();
	}

	onMount(() => {
		for (const id of NATIVE_BACKEND_IDS) {
			check(id);
			envText[id] = formatEnvLines(settings.env[id]);
		}
		shellEnvStatus()
			.then((s) => (shellEnv = s))
			.catch(() => {});
		recheckDeps();
	});

	// The install probe (deps) and the backend probe are separate: once an
	// install lands, re-probe the backend that was missing.
	$effect(() => {
		for (const dep of deps.list) {
			const id = dep.id as BackendId;
			const st = status[id];
			if (dep.present && st && st !== 'checking' && !st.found) check(id);
		}
	});

	const defaultOpts = $derived(NATIVE_BACKEND_IDS.map((id) => ({ value: id, label: BACKEND_LABELS[id] })));
</script>

<SettingsSection id="backend-list" title={t('settings.backend.groupLabel')} description={t('settings.backend.hint')}>
	<SettingsRow id="default-backend" title={t('settings.backend.defaultLabel')} description={t('settings.backend.defaultHint')}>
		<div class="selw">
			<Select value={settings.default} onChange={setDefault} options={defaultOpts}>
				{#snippet item(o)}
					<span class="opt-ico"><BackendIcon backend={o.value as BackendId} size={14} /></span>
					<span>{o.label}</span>
				{/snippet}
			</Select>
		</div>
	</SettingsRow>

	{#if shellEnv?.supported}
		<SettingsRow id="shell-env" title={t('settings.backend.shellEnvLabel')} description={t('settings.backend.shellEnvHint')}>
			{#snippet detail()}
				<span class="sestate" class:dim={!shellEnv?.captured}>
					{#if shellEnv?.captured}
						{t('settings.backend.shellEnvCaptured', {
							count: String(shellEnv.count),
							shell: shellEnv.shell?.split('/').pop() ?? ''
						})}
					{:else}
						{t('settings.backend.shellEnvNotCaptured')}
					{/if}
				</span>
			{/snippet}
			<IconButton
				onclick={refreshSnapshot}
				label="refresh shell env"
				title={t('settings.backend.shellEnvRefresh')}
			>
				<ArrowClockwiseIcon size={14} class={refreshing ? 'spin' : ''} />
			</IconButton>
		</SettingsRow>
	{/if}

	{#each NATIVE_BACKEND_IDS as id (id)}
		{@const st = status[id]}
		{@const dep = deps.list.find((d) => d.id === id)}
		<div class="brow">
			<div class="bline">
				<span class="btile"><BackendIcon backend={id} size={16} /></span>
				<div class="bmain">
					<div class="bhead">
						<span class="bname">{BACKEND_LABELS[id]}</span>
						{#if st === 'checking'}
							<span class="bstate dim">{t('settings.backend.checking')}</span>
						{:else if st?.found}
							<span class="bstate ok"><CheckCircleIcon size={12} /> {versionLabel(st) || t('settings.backend.found')}</span>
							{#if updates[id]?.available}
								<span class="bstate up">{t('settings.backend.updateAvailable', { version: updates[id]!.latest })}</span>
							{:else if id === 'jucode' && appCli(st.path)}
								<span class="bstate dim">{t('settings.backend.bundled')}</span>
							{/if}
						{:else if st}
							<span class="bstate warn"><WarningCircleIcon size={12} /> {t('settings.backend.notFound')}</span>
						{/if}
					</div>
					{#if st && st !== 'checking' && st.found && st.path}
						<span class="bpath" title={st.path}>{st.path}</span>
						{#if id === 'jucode' && appCli(st.path)}
							<div class="clicmd">
								<button class="linkbtn" onclick={addCliCommand}>{t('settings.backend.cliCommand')}</button>
								{#if cliCommand}<span class="clires" class:bad={!cliCommand.ok}>{cliCommand.text}</span>{/if}
							</div>
						{/if}
					{/if}
				</div>
				{#if st && st !== 'checking' && !st.found && dep && !dep.present}
					<DepAction {dep} />
				{:else if updates[id]?.available}
					{#if deps.installing[id]}
						<Button variant="secondary" size="sm" disabled>
							<CircleNotchIcon size={14} class="spin" /> {t('settings.backend.upgrading')}
						</Button>
					{:else}
						<Button variant="primary" size="sm" onclick={() => upgrade(id)}>
							<ArrowCircleUpIcon size={14} /> {t('settings.backend.upgrade')}
						</Button>
					{/if}
				{/if}
				<IconButton onclick={() => check(id)} label="re-check backend" title={t('settings.backend.recheck')}>
					<ArrowClockwiseIcon size={14} />
				</IconButton>
			</div>
			{#if dep}<div class="bindent"><DepDetails {dep} /></div>{/if}
			<div class="bindent">
				<button class="advhead" onclick={() => (advOpen[id] = !advOpen[id])} aria-expanded={!!advOpen[id]}>
					<span class="chev" class:open={advOpen[id]}><CaretRightIcon size={12} /></span>
					{t('settings.backend.advanced')}
					{#if overrideCount(id)}<span class="envcount">{overrideCount(id)}</span>{/if}
				</button>
				{#if advOpen[id]}
					<div class="advbox">
						<label class="field">
							<span>{t('settings.backend.pathLabel')}</span>
							<!-- persisted on change (blur / Enter), then re-probed -->
							<input
								class="tf"
								bind:value={settings.paths[id]}
								placeholder={t('settings.backend.pathPlaceholder', { bin: id })}
								onchange={() => onPathChange(id)}
							/>
						</label>
						<label class="field">
							<span>{t('settings.backend.envLabel')}</span>
							<textarea
								class="tf envta"
								rows="3"
								bind:value={envText[id]}
								placeholder={t('settings.backend.envPlaceholder')}
								onchange={() => onEnvChange(id)}
							></textarea>
						</label>
						{#if envInvalid[id]?.length}
							<span class="envwarn">{t('settings.backend.envInvalid', { lines: envInvalid[id]!.join(', ') })}</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/each}
</SettingsSection>

<style>
	.brow {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 18px;
	}
	.bline {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	/* Under the name column: tile width + gap. */
	.bindent {
		padding-left: 42px;
		min-width: 0;
	}
	.selw {
		width: 220px;
	}
	.btile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--r-sm);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.bmain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.bhead {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	.bname {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.bstate {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
	}
	.bstate.ok {
		color: var(--ok);
	}
	.bstate.warn {
		color: var(--warn);
	}
	.bstate.dim {
		color: var(--dim2);
	}
	.bstate.up {
		color: var(--accent);
	}
	.bpath {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tf {
		width: 100%;
		min-width: 0;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
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
	.sestate {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim);
	}
	.sestate.dim {
		color: var(--dim2);
	}
	.advhead {
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
	.advhead:hover {
		color: var(--text);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.envcount {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		padding: 0 5px;
		border-radius: var(--r-full);
		background: var(--surface2);
		border: 1px solid var(--hairline);
	}
	.advbox {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 460px;
		margin-top: 8px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.field > span {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.envta {
		resize: vertical;
		min-height: 56px;
		line-height: 1.5;
	}
	.envwarn {
		font-size: var(--fs-2xs);
		color: var(--warn);
	}
	.opt-ico {
		display: inline-flex;
		width: 22px;
		height: 22px;
		align-items: center;
		justify-content: center;
		border-radius: var(--r-sm);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.clicmd {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px;
		margin-top: 4px;
		font-size: var(--fs-xs);
	}
	.linkbtn {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}
	.linkbtn:hover {
		text-decoration: underline;
	}
	.clires {
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.clires.bad {
		color: var(--err);
	}
</style>
