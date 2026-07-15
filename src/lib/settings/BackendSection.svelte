<script lang="ts">
	// Settings → 行为 → 引擎后端: per-backend availability (check_backend), a
	// binary-path override, and the default backend for new sessions. All
	// preferences persist to localStorage immediately (independent of the
	// engine config's save button).
	import { onMount } from 'svelte';
	import { RotateCw, CircleCheck, CircleAlert, ChevronRight } from 'lucide-svelte';
	import {
		checkBackend,
		shellEnvStatus,
		refreshShellEnv,
		type BackendStatus,
		type ShellEnvStatus
	} from '$lib/protocol';
	import { BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import {
		loadBackendSettings,
		saveBackendSettings,
		versionLabel,
		parseEnvLines,
		formatEnvLines,
		type BackendSettings
	} from '$lib/backends/settings';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import Select from '$lib/ui/Select.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { t } from '$lib/i18n';

	let settings = $state<BackendSettings>(loadBackendSettings());
	let status = $state<Partial<Record<BackendId, BackendStatus | 'checking'>>>({});
	let shellEnv = $state<ShellEnvStatus | null>(null);
	let refreshing = $state(false);
	let envOpen = $state<Partial<Record<BackendId, boolean>>>({});
	let envText = $state<Partial<Record<BackendId, string>>>({});
	let envInvalid = $state<Partial<Record<BackendId, string[]>>>({});

	function persist() {
		saveBackendSettings({
			default: settings.default,
			paths: Object.fromEntries(
				Object.entries(settings.paths).filter(([, v]) => typeof v === 'string' && v.trim())
			) as BackendSettings['paths'],
			useShellEnv: settings.useShellEnv,
			env: settings.env
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

	function envCount(id: BackendId): number {
		return Object.keys(settings.env[id] ?? {}).length;
	}

	// Switch 通过 bind:checked 直接改 settings —— 变化即持久化（初始一次无害）。
	$effect(() => {
		void settings.useShellEnv;
		persist();
	});

	function check(id: BackendId) {
		status[id] = 'checking';
		checkBackend(id, settings.paths[id]?.trim() || undefined)
			.then((s) => (status[id] = s))
			.catch(() => (status[id] = { found: false }));
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
		for (const id of BACKEND_IDS) {
			check(id);
			envText[id] = formatEnvLines(settings.env[id]);
		}
		shellEnvStatus()
			.then((s) => (shellEnv = s))
			.catch(() => {});
	});

	const defaultOpts = $derived(BACKEND_IDS.map((id) => ({ value: id, label: BACKEND_LABELS[id] })));
</script>

<div class="group">
	<div class="glabel">{t('settings.backend.groupLabel')}</div>
	<p class="hint">{t('settings.backend.hint')}</p>

	{#if shellEnv?.supported}
		<div class="shellenv">
			<div class="semain">
				<span class="sename">{t('settings.backend.shellEnvLabel')}</span>
				<span class="sestate" class:dim={!shellEnv.captured}>
					{#if shellEnv.captured}
						{t('settings.backend.shellEnvCaptured', {
							count: String(shellEnv.count),
							shell: shellEnv.shell?.split('/').pop() ?? ''
						})}
					{:else}
						{t('settings.backend.shellEnvNotCaptured')}
					{/if}
				</span>
			</div>
			<IconButton
				onclick={refreshSnapshot}
				label="refresh shell env"
				title={t('settings.backend.shellEnvRefresh')}
			>
				<RotateCw size={14} class={refreshing ? 'spin' : ''} />
			</IconButton>
			<Switch bind:checked={settings.useShellEnv} label={t('settings.backend.shellEnvToggle')} />
		</div>
		<p class="hint">{t('settings.backend.shellEnvHint')}</p>
	{/if}

	<div class="blist">
		{#each BACKEND_IDS as id (id)}
			{@const st = status[id]}
			<div class="brow">
				<span class="btile"><BackendIcon backend={id} size={16} /></span>
				<div class="bmain">
					<div class="bhead">
						<span class="bname">{BACKEND_LABELS[id]}</span>
						{#if st === 'checking'}
							<span class="bstate dim">{t('settings.backend.checking')}</span>
						{:else if st?.found}
							<span class="bstate ok"><CircleCheck size={12} /> {versionLabel(st) || t('settings.backend.found')}</span>
						{:else if st}
							<span class="bstate warn"><CircleAlert size={12} /> {t('settings.backend.notFound')}</span>
						{/if}
					</div>
					{#if st && st !== 'checking' && st.found && st.path}
						<span class="bpath" title={st.path}>{st.path}</span>
					{/if}
					<div class="boverride">
						<!-- persisted on change (blur / Enter), then re-probed -->
						<input
							class="tf"
							bind:value={settings.paths[id]}
							placeholder={t('settings.backend.pathPlaceholder', { bin: id })}
							onchange={() => onPathChange(id)}
						/>
					</div>
					<button class="envhead" onclick={() => (envOpen[id] = !envOpen[id])}>
						<span class="chev" class:open={envOpen[id]}><ChevronRight size={12} /></span>
						{t('settings.backend.envLabel')}
						{#if envCount(id)}<span class="envcount">{envCount(id)}</span>{/if}
					</button>
					{#if envOpen[id]}
						<div class="envbox">
							<textarea
								class="tf envta"
								rows="3"
								bind:value={envText[id]}
								placeholder={t('settings.backend.envPlaceholder')}
								onchange={() => onEnvChange(id)}
							></textarea>
							{#if envInvalid[id]?.length}
								<span class="envwarn">{t('settings.backend.envInvalid', { lines: envInvalid[id]!.join(', ') })}</span>
							{/if}
						</div>
					{/if}
				</div>
				<IconButton onclick={() => check(id)} label="re-check backend" title={t('settings.backend.recheck')}>
					<RotateCw size={14} />
				</IconButton>
			</div>
		{/each}
	</div>
</div>

<div class="group">
	<div class="glabel">{t('settings.backend.defaultLabel')}</div>
	<p class="hint">{t('settings.backend.defaultHint')}</p>
	<Select value={settings.default} onChange={setDefault} options={defaultOpts}>
		{#snippet item(o)}
			<span class="opt-ico"><BackendIcon backend={o.value as BackendId} size={14} /></span>
			<span>{o.label}</span>
		{/snippet}
	</Select>
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
	.blist {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}
	.brow {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
	}
	.brow + .brow {
		border-top: 1px solid var(--hairline);
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
		margin-top: 2px;
	}
	.bmain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.bhead {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	.bname {
		font-size: 13px;
		font-weight: 500;
	}
	.bstate {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
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
	.bpath {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.boverride {
		max-width: 420px;
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
	.shellenv {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		margin-bottom: 8px;
	}
	.semain {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sename {
		font-size: 13px;
		font-weight: 500;
	}
	.sestate {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--dim);
	}
	.sestate.dim {
		color: var(--dim2);
	}
	.envhead {
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
	.envhead:hover {
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
		font-size: 10px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
	}
	.envbox {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 420px;
	}
	.envta {
		resize: vertical;
		min-height: 56px;
		line-height: 1.5;
	}
	.envwarn {
		font-size: 11px;
		color: var(--warn);
	}
	:global(.spin) {
		animation: benv-spin 0.8s linear infinite;
	}
	@keyframes benv-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.opt-ico {
		display: inline-flex;
		width: 22px;
		height: 22px;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		flex-shrink: 0;
	}
</style>
