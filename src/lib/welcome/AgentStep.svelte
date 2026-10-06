<script lang="ts">
	// Choose an installed coding agent. Installation is on the environment step.
	import { onMount } from 'svelte';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import { checkBackend, type BackendStatus } from '$lib/protocol';
	import { NATIVE_BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import { loadBackendSettings, saveBackendSettings, versionLabel } from '$lib/backends/settings';
	import BackendIcon from '$lib/BackendIcon.svelte';

	import { deps, recheckDeps } from '$lib/deps.svelte';
	import { t } from '$lib/i18n';

	let {
		selected = $bindable(),
		ready = $bindable(false),
		onOpenSettings,
		onInstall
	}: { selected: BackendId; ready?: boolean; onOpenSettings: () => void; onInstall: () => void } = $props();

	let status = $state<Partial<Record<BackendId, BackendStatus | 'checking'>>>({});

	function check(id: BackendId) {
		status[id] = 'checking';
		checkBackend(id, loadBackendSettings().paths[id]?.trim() || undefined)
			.then((s) => (status[id] = s))
			.catch(() => (status[id] = { found: false }));
	}

	function pick(id: BackendId) {
		selected = id;
		saveBackendSettings({ ...loadBackendSettings(), default: id });
	}

	onMount(() => {
		for (const id of NATIVE_BACKEND_IDS) check(id);
		recheckDeps();
	});

	// Re-probe a backend once its install lands.
	$effect(() => {
		for (const dep of deps.list) {
			const id = dep.id as BackendId;
			const st = status[id];
			if (dep.present && st && st !== 'checking' && !st.found) check(id);
		}
	});

	$effect(() => {
		const st = status[selected];
		ready = !!st && st !== 'checking' && st.found;
	});
</script>

<div class="list" role="radiogroup" aria-label={t('setup.welcome.agent.title')}>
	{#each NATIVE_BACKEND_IDS as id (id)}
		{@const st = status[id]}
		{@const dep = deps.list.find((d) => d.id === id)}
		<div class="opt" class:on={selected === id}>
			<button class="main" role="radio" aria-checked={selected === id} onclick={() => pick(id)}>
				<span class="radio" aria-hidden="true"></span>
				<span class="tile"><BackendIcon backend={id} size={18} /></span>
				<span class="txt">
					<span class="name">{BACKEND_LABELS[id]}</span>
					<span class="desc">{t(`setup.welcome.agent.desc.${id}`)}</span>
				</span>
				<span class="state">
					{#if !st || st === 'checking'}
						<span class="dim">{t('settings.backend.checking')}</span>
					{:else if st.found}
						<span class="ok"><CheckCircleIcon size={13} /> {versionLabel(st) || t('settings.backend.found')}</span>
					{:else}
						<span class="warn"><WarningCircleIcon size={13} /> {t('settings.backend.notFound')}</span>
					{/if}
				</span>
			</button>
			{#if st && st !== 'checking' && !st.found && dep && !dep.present}
				<div class="install">
					<button class="link" onclick={onInstall}>{t('setup.welcome.agent.installFirst')}</button>
				</div>
			{/if}

		</div>
	{/each}
</div>

<p class="more">
	{t('setup.welcome.agent.more')}
	<button class="link" onclick={onOpenSettings}>{t('setup.welcome.agent.moreLink')}</button>
</p>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.opt {
		position: relative;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		transition: border-color 0.15s ease;
	}
	.opt.on {
		border-color: var(--border-strong);
		background: var(--surface2);
	}
	.main {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 14px 16px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: inherit;
	}
	.main:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.radio {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
		transition:
			border-color 0.15s ease,
			border-width 0.15s ease;
	}
	.opt.on .radio {
		border: 5px solid var(--accent);
	}
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
	}
	.txt {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.desc {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.45;
	}
	.state {
		flex-shrink: 0;
		font-size: var(--fs-xs);
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.state span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.dim {
		color: var(--dim2);
	}
	.ok {
		color: var(--ok);
	}
	.warn {
		color: var(--warn);
	}
	/* Under the text column: radio + gap + tile + gap. */
	.install {
		padding: 0 16px 12px 90px;
	}

	.more {
		margin: 16px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.55;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
