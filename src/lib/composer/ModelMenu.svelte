<script lang="ts" module>
	/** The jucode engine's provider row: JuCode and each provider with a key. */
	export type ProviderChoice = {
		value: string;
		options: { value: string; label: string }[];
		/** The command a pick sends (as a model row's); none for the current one. */
		commandFor: (id: string) => string | undefined;
	};
	/** Older model versions folded below the list (modelRows foldLegacy). */
	export type LegacyFold = { count: number; shown: boolean; onToggle: () => void };
</script>

<script lang="ts">
	import { overBrowser } from '$lib/browser.svelte';
	import { onMount, tick } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import IconButton from '$lib/ui/IconButton.svelte';
	import SessionSwitches, { type SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import type { AcpPreset } from '$lib/protocol';
	import { agentCatalog } from '$lib/agentCatalog.svelte';
	import type { AcpAgentRef } from '$lib/types';
	import { CAPS, NATIVE_BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import type { ModelRow } from './modelRows';
	import { defaultEffort, effortLabel } from './effort';
	import EffortSlider from './EffortSlider.svelte';
	import { choiceLabel, optionLabel } from './sessionOptions';
	import GroupPicker, { type ToolProvider } from './GroupPicker.svelte';
	import PlanQuota from './PlanQuota.svelte';
	import { modelColor, isTopEffort } from '$lib/modelColor';
	import { modelSetup } from '$lib/modelSetupState.svelte';
	import { popOut } from '$lib/ui/motion';

	// The composer's model menu, opened from the model button: everything about
	// "who answers and how hard it thinks" in one place. The first page goes
	// provider (this machine, a custom provider or the gateway and its group),
	// then the current model (a row that opens the model list, the provider's
	// models only), then the thinking effort (Ultracode its top stop, fast mode
	// beside it) and, while the session can still switch, the coding agent.
	// The second page is the model list, searchable when it is long.
	let {
		chat,
		canPickModel = false,
		rows = [],
		showSearch = false,
		legacy,
		backendLocked = true,
		toolProvider,
		providerChoice,
		effortDisabled = false,
		anchor,
		query = $bindable(''),
		selIdx = $bindable(0),
		onClose,
		onSelect,
		onEffort,
		onSwitch,
		onBackend,
		onSessionOption,
		acpGateway,
		onRefreshModels
	}: {
		chat: ChatState;
		/** The engine has a model catalog (not ACP agents). */
		canPickModel?: boolean;
		rows?: ModelRow[];
		showSearch?: boolean;
		legacy?: LegacyFold;
		/** Locked sessions (restored / first user turn sent) can't change agent. */
		backendLocked?: boolean;
		/** A Claude Code / Codex session: where its model runs (`model` is the
		 *  gateway's name for it) and how to change that. */
		toolProvider?: ToolProvider & { model: string };
		/** The jucode engine: the providers it can switch to (two or more). */
		providerChoice?: ProviderChoice;
		effortDisabled?: boolean;
		anchor?: HTMLElement;
		query?: string;
		selIdx?: number;
		onClose: () => void;
		onSelect: (command: string) => void;
		onEffort: (effort: string) => void;
		onSwitch: (name: SessionSwitch, on: boolean) => void;
		onBackend?: (b: BackendId, acpAgent?: AcpAgentRef) => void | Promise<void>;
		/** ACP: sets one of the agent's session options. */
		onSessionOption?: (id: string, value: string | boolean) => void;
		/** ACP agents with a gateway mode: whether this session uses it, and the switch. */
		acpGateway?: { on: boolean; onChange: (on: boolean) => void };
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

	// Agent availability, the built-in and the registered ACP agents: as last
	// known at once, checked again in the background (agentCatalog).
	const probe = $derived(agentCatalog.native);
	const presets = $derived(agentCatalog.presets);
	const acpAgents = $derived(agentCatalog.agents);
	onMount(() => {
		if (!backendLocked) void agentCatalog.refresh();
	});
	const presetTitle = (p: AcpPreset) =>
		p.status === 'missing'
			? `${p.name} · ${t('settings.acp.notInstalled')}`
			: p.status === 'unsupported'
				? `${p.name} · ${t('settings.acp.tooOld', { min: p.min_version ?? '' })}`
				: p.version
					? `${p.name} · ${p.version}`
					: p.name;
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
	async function pickAcp(agent: AcpAgentRef) {
		if (switching || (chat.backendId === 'acp' && chat.acpAgentId === agent.id)) return;
		switching = true;
		try {
			await onBackend?.('acp', agent);
		} finally {
			switching = false;
		}
	}

	let page = $state<'main' | 'models'>('main');
	const activeRow = $derived(rows.find((r) => r.active));
	const modelName = $derived(chat.modelLabel || chat.model || BACKEND_LABELS[chat.backendId]);
	// On the first page the list's keys (arrows, Enter) open the list instead
	// of picking a row nobody can see. Capture phase, ahead of the pane.
	function onKeyCapture(e: KeyboardEvent) {
		if (page !== 'main' || !canPickModel) return;
		if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'Enter'].includes(e.key)) {
			e.preventDefault();
			e.stopPropagation();
			page = 'models';
		}
	}

	// Ultracode (Claude Code's standing Workflow orchestration) is the stop
	// past the highest effort; the engine keeps it as a switch beside the
	// effort, so leaving it for a stop turns it off.
	const efforts = $derived(chat.ultracodeAvailable || chat.ultracode ? [...chat.efforts, 'ultracode'] : chat.efforts);
	const effortNow = $derived(chat.ultracode ? 'ultracode' : chat.effort);
	function pickEffort(effort: string) {
		if (effort === 'ultracode') return onSwitch('ultracode', true);
		if (chat.ultracode) onSwitch('ultracode', false);
		if (effort !== chat.effort) onEffort(effort);
	}
	let shownEffort = $state('');
	const accent = $derived(modelColor(chat.model));
	const top = $derived(isTopEffort(shownEffort, efforts));
	const def = $derived(defaultEffort(chat.efforts, chat.effortDefault));
	// Group headers only help when the list spans more than one company.
	const grouped = $derived(new Set(rows.map((r) => r.group)).size > 1);
	// A row's second line: the model's id where the name differs, and its
	// detail (the context window; an ACP agent's provider, which its id
	// already starts with).
	function idOf(r: ModelRow) {
		return r.vendor && r.vendor !== r.label ? r.vendor : '';
	}
	function detailOf(r: ModelRow) {
		return r.detail && !idOf(r).startsWith(`${r.detail}/`) ? r.detail : '';
	}
</script>

<svelte:window onkeydowncapture={onKeyCapture} />
<button class="mm-backdrop" aria-label="close" tabindex="-1" onclick={onClose}></button>
<div use:overBrowser class="pop mm" out:popOut={{ y: 3 }} role="dialog" aria-label={t('chat.switchModel')} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px">
	{#if page === 'main'}
		<!-- Provider first: the model list below holds its models only. -->
		{#if toolProvider}
			{#key toolProvider.model}<GroupPicker model={toolProvider.model} tool={toolProvider} />{/key}
		{:else if providerChoice}
			<section class="options">
				<div class="opt provider">
					<span class="olabel">{t('chat.provider')}</span>
					<Select
						value={providerChoice.value}
						options={providerChoice.options}
						onChange={(id) => {
							const command = providerChoice.commandFor(id);
							if (command) onSelect(command);
						}}
					/>
				</div>
			</section>
		{/if}

		<section class="current">
			{#if canPickModel}
				<button class="pop-row" onclick={() => (page = 'models')} title={t('chat.pickModel')}>
					<span class="pop-ico"><Vendor model={chat.model || modelName} size={16} /></span>
					<span class="pop-txt"><span class="pop-label">{modelName}</span></span>
					{#if activeRow?.detail}<span class="ctx" title={activeRow.detail}>{activeRow.detail}</span>{/if}
					<span class="pop-ico caret"><ChevronRightIcon size={14} /></span>
				</button>
			{:else}
				<div class="pop-row static">
					<span class="pop-ico"><BackendIcon backend={chat.backendId} agent={chat.acpAgentId} size={15} /></span>
					<span class="pop-txt"><span class="pop-label">{modelName}</span></span>
				</div>
			{/if}
		</section>

		{#if chat.backendId === 'jucode' && chat.provider === 'jucode' && chat.model}
			{#key chat.model}<GroupPicker model={chat.model} />{/key}
		{/if}

		{#if chat.efforts.length}
			<section class="effort">
				<div class="ehead">
					<span class="elabel">{t('chat.effortTitle')}</span>
					{#key shownEffort}<span class="evalue" class:effort-max={top} style:--effort-accent={accent || 'var(--text)'}>{effortLabel(shownEffort)}</span>{/key}
					<span class="grow"></span>
					{#if chat.fastAvailable || chat.fast}
						<!-- Fast mode is output speed, not thinking: any effort takes it. -->
						<button
							class="fast"
							class:on={chat.fast}
							aria-pressed={chat.fast}
							title={t('chat.fastDesc')}
							onclick={() => onSwitch('fast', !chat.fast)}
						>
							<ZapIcon size={12} />{t('chat.fastLabel')}
						</button>
					{/if}
					<IconButton
						size="sm"
						label={t('chat.effortReset')}
						title={t('chat.effortReset')}
						disabled={effortDisabled || !def || shownEffort === def}
						onclick={() => pickEffort(def)}
					>
						<RotateCcwIcon size={14} />
					</IconButton>
				</div>
				<EffortSlider {efforts} effort={effortNow} disabled={effortDisabled} onEffort={pickEffort} {accent} bind:current={shownEffort} />
			</section>
		{:else}
			<SessionSwitches {chat} {onSwitch} thinking={false} />
		{/if}

		{#if chat.planUsage}<PlanQuota usage={chat.planUsage} />{/if}

		{#if chat.backendId === 'acp' && (chat.sessionOptions.length || acpGateway)}
			<!-- The agent's own options (its mode, say), as it names them. -->
			<section class="options">
				{#each chat.sessionOptions as o (o.id)}
					<div class="opt" title={o.description ?? undefined}>
						<span class="olabel">{optionLabel(o)}</span>
						{#if o.type === 'boolean'}
							<Switch checked={o.value} label={optionLabel(o)} onChange={(v) => onSessionOption?.(o.id, v)} />
						{:else if o.choices.length <= 4}
							<Segmented
								value={o.value}
								options={o.choices.map((c) => ({ value: c.value, label: choiceLabel(o, c) }))}
								onChange={(v) => onSessionOption?.(o.id, v)}
							/>
						{:else}
							<Select
								value={o.value}
								options={o.choices.map((c) => ({ value: c.value, label: choiceLabel(o, c) }))}
								onChange={(v) => onSessionOption?.(o.id, v)}
							/>
						{/if}
					</div>
				{/each}
				{#if acpGateway}
					<div class="opt">
						<span class="olabel">{t('chat.jucodeGateway')}</span>
						<Switch checked={acpGateway.on} label={t('chat.jucodeGateway')} onChange={acpGateway.onChange} />
					</div>
				{/if}
			</section>
		{/if}

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
				{#each presets as p (p.id)}
					<button
						class="agent"
						class:on={chat.backendId === 'acp' && chat.acpAgentId === p.id}
						class:miss={p.status !== 'ready'}
						disabled={switching || p.status !== 'ready'}
						title={presetTitle(p)}
						onclick={() => pickAcp({ id: p.id, name: p.name, preset: true })}
					>
						<BackendIcon backend="acp" agent={p.id} size={15} /><span>{p.name}</span>
						{#if !p.approvals}<span class="noappr">{t('chat.noApproval')}</span>{/if}
					</button>
				{/each}
				{#each acpAgents as agent (agent.id)}
					<button
						class="agent"
						class:on={chat.backendId === 'acp' && chat.acpAgentId === agent.id}
						disabled={switching}
						title={agent.name}
						onclick={() => pickAcp({ id: agent.id, name: agent.name })}
					>
						<BackendIcon backend="acp" size={15} /><span>{agent.name}</span>
					</button>
				{/each}
			</section>
		{/if}
	{:else}
		<section class="models">
			<div class="mhead">
				<IconButton size="sm" label={t('shell.remote.back')} title={t('shell.remote.back')} onclick={() => (page = 'main')}>
					<ChevronLeftIcon size={14} />
				</IconButton>
				<span class="mtitle">{t('chat.pickModel')}</span>
				{#if chat.backendId === 'jucode'}
					<!-- Which JuCode models show, and their context windows. -->
					<button
						class="manage"
						onclick={() => {
							modelSetup.open = true;
							onClose();
						}}>{t('chat.manageModels')}</button
					>
				{/if}
			</div>
			{#if showSearch}
				<label class="search">
					<SearchIcon size={16} />
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={query} placeholder={t('shell.pickerSearchPlaceholder')} autofocus />
				</label>
			{/if}
			<div class="list" role="listbox" aria-label={t('chat.switchModel')}>
				{#each rows as row, i (row.id)}
					{#if row.legacy}
						{#if legacy && !rows[i - 1]?.legacy}{@render fold(legacy)}{/if}
					{:else if grouped && (i === 0 || rows[i - 1]?.group !== row.group)}
						<div class="group">{row.group || t('shell.modelGroup.other')}</div>
					{/if}
					{@const id = idOf(row)}
					{@const detail = detailOf(row)}
					<button
						class="pop-row mrow"
						class:sel={i === selIdx}
						role="option"
						aria-selected={row.active}
						onclick={() => onSelect(row.command)}
						onmouseenter={() => (selIdx = i)}
					>
						<span class="pop-ico"><Vendor model={row.vendor ?? row.label} size={18} /></span>
						<span class="pop-txt">
							<span class="pop-label">{row.label || t('shell.empty')}</span>
							{#if id || detail}
								<span class="pop-desc" title={[id, detail].filter(Boolean).join(' · ')}
									>{#if id}<span class="mid">{id}</span>{/if}{#if id && detail}<span class="dot">·</span>{/if}{detail}</span
								>
							{/if}
						</span>
						<span class="pop-check" class:off={!row.active}><CheckIcon size={16} /></span>
					</button>
				{/each}
				{#if legacy && !legacy.shown}{@render fold(legacy)}{/if}
				{#if rows.length === 0}
					<div class="empty">{query.trim() ? t('shell.noMatch') : t('shell.noOptions')}</div>
				{/if}
			</div>
		</section>
	{/if}
</div>

{#snippet fold(l: LegacyFold)}
	<button class="fold" aria-expanded={l.shown} onclick={l.onToggle}>
		<span>{t('chat.olderModels')}</span>
		<span class="fold-n">{l.count}</span>
		<span class="fold-caret" class:open={l.shown}><ChevronDownIcon size={14} /></span>
	</button>
{/snippet}

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
		/* Taller than that (switches, providers): the menu scrolls rather than
		   running over the composer. */
		overflow-y: auto;
		overscroll-behavior: contain;
		/* It sits in the composer's bar, which keeps its own row on one line. */
		white-space: normal;
		gap: 0;
		padding: 6px;
		transform-origin: bottom right;
		animation: pop-in var(--t-med) var(--ease-out);
	}
	/* GroupPicker renders its own section, hence :global. */
	.mm > :global(section + section) {
		margin-top: 4px;
		padding-top: 5px;
		border-top: 1px solid var(--hairline);
	}
	.current .pop-row {
		font-weight: 500;
	}
	.pop-row.static {
		cursor: default;
	}
	.caret {
		width: auto;
		color: var(--dim2);
	}
	.mhead {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 2px 6px;
	}
	.mtitle {
		color: var(--dim);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.manage {
		margin-left: auto;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.manage:hover {
		background: var(--surface2);
		color: var(--text);
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
		border-radius: var(--r);
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
	.noappr {
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 8px;
	}
	.opt {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 32px;
	}
	.olabel {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	/* Provider names are short: the label keeps its width, the select its own. */
	.provider .olabel {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
	.provider :global(.select) {
		width: auto;
		min-width: 0;
	}
	.effort {
		padding: 2px 8px 4px;
	}
	.ehead {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.elabel {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.evalue {
		color: var(--text);
		font-size: var(--fs-xs);
		font-weight: 500;
		animation: rise var(--t-fast) var(--ease-out);
	}
	.grow {
		flex: 1;
	}
	/* Fast mode: a toggle beside the effort, outlined when on. */
	.fast {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-2xs);
		cursor: pointer;
		transition:
			border-color var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.fast:hover {
		color: var(--text);
	}
	.fast.on {
		border-color: var(--text);
		color: var(--text);
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
		border-radius: var(--r);
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
	/* Name and detail (the context window) share one line. WebKit
	   (the macOS app) does not wrap text inside the row button, so both
	   truncate instead of overlapping; the detail gives way before the name. */
	.mm .pop-txt {
		flex: 1 1 auto;
	}
	.mm .pop-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ctx {
		flex: 0 1000 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	/* Two lines a model: its name, then its id and context window. */
	.mrow .pop-desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.mid {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}
	.dot {
		margin: 0 5px;
	}
	/* Older versions: a quiet row that opens them below. */
	.fold {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
		padding: 8px 12px;
		border: none;
		border-top: 1px solid var(--hairline);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		text-align: left;
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
	}
	.fold-n {
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.fold-caret {
		display: inline-flex;
		margin-left: auto;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.fold-caret.open {
		transform: rotate(180deg);
	}
	/* Keep the check's column so names and context line up on every row. */
	.pop-check.off {
		visibility: hidden;
	}
	/* The check lands on a newly picked model. */
	.pop-check:not(.off) :global(svg) {
		animation: pop-in var(--t-med) var(--ease-out);
	}
	.empty {
		padding: 14px 12px;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
</style>
