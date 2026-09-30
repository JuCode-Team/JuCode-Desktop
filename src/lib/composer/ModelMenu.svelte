<script lang="ts">
	import { onMount, tick } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { acpAgentsList, checkBackend, type AcpAgent } from '$lib/protocol';
	import { loadBackendSettings, versionLabel } from '$lib/backends/settings';
	import { CAPS, NATIVE_BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import type { ModelRow } from './modelRows';
	import { defaultEffort, effortLabel } from './effort';
	import EffortSlider from './EffortSlider.svelte';
	import GroupPicker from './GroupPicker.svelte';
	import { modelColor, isTopEffort } from '$lib/modelColor';

	// The composer's model menu, opened from the model button: everything about
	// "who answers and how hard it thinks" in one place, top to bottom —
	// the coding agent (only while the session can still switch), the thinking
	// effort, and the models, searchable when the list is long.
	let {
		chat,
		rows = [],
		showSearch = false,
		backendLocked = true,
		effortDisabled = false,
		anchor,
		query = $bindable(''),
		selIdx = $bindable(0),
		onClose,
		onSelect,
		onEffort,
		onBackend,
		onRefreshModels
	}: {
		chat: ChatState;
		rows?: ModelRow[];
		showSearch?: boolean;
		/** Locked sessions (restored / first user turn sent) can't change agent. */
		backendLocked?: boolean;
		effortDisabled?: boolean;
		anchor?: HTMLElement;
		query?: string;
		selIdx?: number;
		onClose: () => void;
		onSelect: (command: string) => void;
		onEffort: (effort: string) => void;
		onBackend?: (b: BackendId, acpAgent?: { id: string; name: string }) => void | Promise<void>;
		/** Re-request the model catalog (after an agent switch). */
		onRefreshModels: () => void;
	} = $props();

	// Opens above the model button, right edges aligned (the button sits at the
	// right of the composer); below it when there is no room above.
	let popEl = $state<HTMLDivElement>();
	let popTop = $state(0);
	let popLeft = $state(0);
	function position() {
		if (!anchor || !popEl) return;
		const r = anchor.getBoundingClientRect();
		const margin = 12;
		const top = r.top - popEl.offsetHeight - 8;
		popLeft = Math.min(Math.max(r.right - popEl.offsetWidth, margin), window.innerWidth - popEl.offsetWidth - margin);
		popTop = top >= margin ? top : Math.min(r.bottom + 8, window.innerHeight - popEl.offsetHeight - margin);
	}
	onMount(() => {
		tick().then(position);
		// Rows arrive after the catalog request; keep the menu anchored as it grows.
		const ro = new ResizeObserver(position);
		if (popEl) ro.observe(popEl);
		return () => ro.disconnect();
	});

	// Agent availability (best-effort) and the registered ACP agents.
	let probe = $state<Partial<Record<BackendId, { found: boolean; version: string }>>>({});
	let acpAgents = $state<AcpAgent[]>([]);
	onMount(() => {
		if (backendLocked) return;
		const settings = loadBackendSettings();
		for (const id of NATIVE_BACKEND_IDS) {
			checkBackend(id, settings.paths[id])
				.then((s) => (probe[id] = { found: s.found, version: versionLabel(s) }))
				.catch(() => {});
		}
		acpAgentsList()
			.then((a) => (acpAgents = a))
			.catch(() => {});
	});
	const agentTitle = (id: BackendId) => {
		const p = probe[id];
		if (!p) return BACKEND_LABELS[id];
		if (!p.found) return `${BACKEND_LABELS[id]} · ${t('shell.backend.notFound')}`;
		return p.version ? `${BACKEND_LABELS[id]} · ${p.version}` : BACKEND_LABELS[id];
	};

	// An agent switch tears down and respawns the session's engine — a second
	// click while one is in flight would race it.
	let switching = $state(false);
	async function pickNative(id: BackendId) {
		if (switching || id === chat.backendId) return;
		switching = true;
		try {
			await onBackend?.(id);
			if (CAPS[id].modelPicker) onRefreshModels();
		} finally {
			switching = false;
		}
	}
	async function pickAcp(agent: AcpAgent) {
		if (switching || (chat.backendId === 'acp' && chat.acpAgentId === agent.id)) return;
		switching = true;
		try {
			await onBackend?.('acp', { id: agent.id, name: agent.name });
		} finally {
			switching = false;
		}
	}

	let shownEffort = $state('');
	const accent = $derived(modelColor(chat.model));
	const top = $derived(isTopEffort(shownEffort, chat.efforts));
	const def = $derived(defaultEffort(chat.efforts));
	// Group headers only help when the list spans more than one source.
	const grouped = $derived(new Set(rows.map((r) => r.group)).size > 1);
</script>

<button class="mm-backdrop" aria-label="close" tabindex="-1" onclick={onClose}></button>
<div class="pop mm" role="dialog" aria-label={t('chat.switchModel')} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px">
	{#if !backendLocked}
		<section class="agents" role="group" aria-label={t('chat.switchBackend')}>
			{#each NATIVE_BACKEND_IDS as id (id)}
				<button
					class="agent"
					class:on={chat.backendId === id}
					class:miss={probe[id] ? !probe[id]!.found : false}
					disabled={switching}
					title={agentTitle(id)}
					onclick={() => pickNative(id)}
				>
					<BackendIcon backend={id} size={15} /><span>{BACKEND_LABELS[id]}</span>
				</button>
			{/each}
			{#each acpAgents as agent (agent.id)}
				<button
					class="agent"
					class:on={chat.backendId === 'acp' && chat.acpAgentId === agent.id}
					disabled={switching}
					title={agent.name}
					onclick={() => pickAcp(agent)}
				>
					<BackendIcon backend="acp" size={15} /><span>{agent.name}</span>
				</button>
			{/each}
		</section>
	{/if}

	{#if chat.efforts.length}
		<section class="effort">
			<div class="ehead">
				<span class="elabel">{t('chat.effortTitle')}</span>
				{#key shownEffort}<span class="evalue" class:effort-max={top} style:--effort-accent={accent || 'var(--text)'}>{effortLabel(shownEffort)}</span>{/key}
				<span class="grow"></span>
				<IconButton
					size="sm"
					label={t('chat.effortReset')}
					title={t('chat.effortReset')}
					disabled={effortDisabled || !def || shownEffort === def}
					onclick={() => onEffort(def)}
				>
					<ArrowCounterClockwiseIcon size={14} />
				</IconButton>
			</div>
			<EffortSlider efforts={chat.efforts} effort={chat.effort} disabled={effortDisabled} {onEffort} {accent} bind:current={shownEffort} />
		</section>
	{/if}

	{#if chat.backendId === 'jucode' && chat.provider === 'jucode' && chat.model}
		{#key chat.model}<GroupPicker model={chat.model} />{/key}
	{/if}

	{#if rows.length || query || showSearch}
		<section class="models">
			{#if showSearch}
				<label class="search">
					<MagnifyingGlassIcon size={15} />
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={query} placeholder={t('shell.pickerSearchPlaceholder')} autofocus />
				</label>
			{/if}
			<div class="list" role="listbox" aria-label={t('chat.switchModel')}>
				{#each rows as row, i (row.id)}
					{#if grouped && row.group && (i === 0 || rows[i - 1]?.group !== row.group)}
						<div class="group">{row.group}</div>
					{/if}
					<button
						class="pop-row"
						class:sel={i === selIdx}
						role="option"
						aria-selected={row.active}
						onclick={() => onSelect(row.command)}
						onmouseenter={() => (selIdx = i)}
					>
						<span class="pop-ico"><Vendor model={row.vendor ?? row.label} size={16} /></span>
						<span class="pop-txt"><span class="pop-label">{row.label || t('shell.empty')}</span></span>
						{#if row.detail}<span class="ctx">{row.detail}</span>{/if}
						<span class="pop-check" class:off={!row.active}><CheckIcon size={16} /></span>
					</button>
				{/each}
				{#if rows.length === 0}
					<div class="empty">{query.trim() ? t('shell.noMatch') : t('shell.noOptions')}</div>
				{/if}
			</div>
		</section>
	{/if}
</div>

<style>
	.mm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: none;
		background: none;
		cursor: default;
	}
	/* Fixed to the viewport: tiles clip their content, so an anchored child
	   would be cut at split boundaries. */
	.mm {
		position: fixed;
		z-index: 21;
		width: min(340px, calc(100vw - 24px));
		max-height: min(72vh, 620px);
		gap: 0;
		padding: 6px;
		transform-origin: bottom right;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	/* GroupPicker renders its own section, hence :global. */
	.mm > :global(section + section) {
		margin-top: 6px;
		padding-top: 8px;
		border-top: 1px solid var(--hairline);
	}
	.agents {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 2px;
	}
	.agent {
		display: inline-flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.agent:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.agent.on {
		background: var(--surface2);
		color: var(--text);
		font-weight: 500;
	}
	.agent.miss {
		opacity: 0.45;
	}
	.agent:disabled {
		cursor: default;
	}
	.effort {
		padding: 4px 8px 6px;
	}
	.ehead {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}
	.elabel {
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
	.evalue {
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
		animation: rise var(--t-fast) var(--ease-out);
	}
	.grow {
		flex: 1;
	}
	.models {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 2px 6px;
		padding: 0 10px;
		height: 34px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
	}
	.group {
		padding: 8px 12px 4px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-weight: 500;
	}
	.ctx {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	/* Keep the check's column so names and context line up on every row. */
	.pop-check.off {
		visibility: hidden;
	}
	/* The check lands on a newly picked model. */
	.pop-check:not(.off) :global(svg) {
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.empty {
		padding: 14px 12px;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
</style>
