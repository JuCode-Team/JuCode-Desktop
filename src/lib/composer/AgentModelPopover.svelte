<script lang="ts">
	import { onMount } from 'svelte';
	import { X, Check, Search } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { acpAgentsList, checkBackend, type AcpAgent } from '$lib/protocol';
	import { loadBackendSettings, versionLabel } from '$lib/backends/settings';
	import { CAPS, NATIVE_BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import type { ModelRow } from './modelRows';
	import { effortColumnIdx } from './effortColumn';

	// The composer's model popover: the coding agent lives INSIDE the session,
	// so an unlocked session shows an agent rail (native engines + registered
	// ACP agents) on the left and the current agent's models in the center.
	// A fixed-width column on the right lists the hovered/focused model's
	// reasoning-effort chips (never inserted between rows, so the list never
	// reflows); a chip picks that model AND that effort in one step.
	let {
		chat,
		title,
		rows = [],
		showSearch = false,
		backendLocked = true,
		query = $bindable(''),
		selIdx = $bindable(0),
		keyNav = $bindable(false),
		onClose,
		onSelect,
		onBackend,
		onRefreshModels
	}: {
		chat: ChatState;
		title: string;
		rows?: ModelRow[];
		showSearch?: boolean;
		/** Locked sessions (restored / first user turn sent) hide the agent rail. */
		backendLocked?: boolean;
		query?: string;
		selIdx?: number;
		/** The pane's arrow keys moved selIdx — chips follow the focused row. */
		keyNav?: boolean;
		onClose: () => void;
		onSelect: (command: string) => void;
		onBackend?: (b: BackendId, acpAgent?: { id: string; name: string }) => void | Promise<void>;
		/** Re-request the model catalog (after an agent switch). */
		onRefreshModels: () => void;
	} = $props();

	// Availability probe for the agent rail (best-effort, same as the old
	// backend picker) + the registered ACP agents.
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

	const railTitle = (id: BackendId) => {
		const p = probe[id];
		if (!p) return BACKEND_LABELS[id];
		if (!p.found) return `${BACKEND_LABELS[id]} · ${t('shell.backend.notFound')}`;
		return p.version ? `${BACKEND_LABELS[id]} · ${p.version}` : BACKEND_LABELS[id];
	};

	// An agent switch tears down and respawns the session's engine — a second
	// rail click while one is in flight would race it, so gate on a local flag.
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
			// ACP agents expose no model catalog — nothing to refresh afterwards.
			await onBackend?.('acp', { id: agent.id, name: agent.name });
		} finally {
			switching = false;
		}
	}

	// Effort highlighted on the active row (engine-reported, falling back to
	// the session's current effort).
	const activeEffort = $derived(
		chat.picker?.kind === 'model' ? chat.picker.activeEffort || chat.effort : chat.effort
	);
	// Every row with efforts gets chips: same-engine rows via `/model <name>
	// <effort>`, cross-provider rows via `@switch <provider> <model> <effort>`
	// (the restart applies the picked effort instead of the provider default).
	const chipEfforts = (row: ModelRow) => row.efforts ?? [];

	// Chips are hover-driven for the mouse (mouseenter on a row, cleared when
	// the pointer leaves the list) and follow selIdx only after the user
	// actually arrow-keyed — never on the default/active selection. With no
	// focus the column falls back to the currently active model.
	let hoverIdx = $state<number | null>(null);
	const chipIdx = $derived(effortColumnIdx(rows, hoverIdx, keyNav, selIdx));
	const chipRow = $derived(chipIdx !== null ? rows[chipIdx] : null);
	function hoverRow(i: number) {
		hoverIdx = i;
		selIdx = i;
		keyNav = false;
	}
</script>

<button class="pop-backdrop" aria-label="close" onclick={onClose}></button>
<div class="pop" class:norail={backendLocked} role="dialog" aria-label={title}>
	<div class="pop-head">
		<span>{title}</span>
		<IconButton onclick={onClose} label="close"><X size={15} /></IconButton>
	</div>
	<div class="pop-body">
		{#if !backendLocked}
			<div class="rail" role="group" aria-label={t('chat.switchBackend')}>
				{#each NATIVE_BACKEND_IDS as id (id)}
					{@const p = probe[id]}
					<button
						class="railbtn"
						class:on={chat.backendId === id}
						class:miss={p ? !p.found : false}
						disabled={switching}
						onclick={() => pickNative(id)}
						title={railTitle(id)}
						aria-label={BACKEND_LABELS[id]}
					>
						<BackendIcon backend={id} size={17} />
					</button>
				{/each}
				{#if acpAgents.length}
					<div class="railsep" role="separator" aria-label={t('chat.acpAgents')}></div>
					{#each acpAgents as agent (agent.id)}
						<button
							class="railbtn"
							class:on={chat.backendId === 'acp' && chat.acpAgentId === agent.id}
							disabled={switching}
							onclick={() => pickAcp(agent)}
							title={agent.name}
							aria-label={agent.name}
						>
							<BackendIcon backend="acp" size={17} />
						</button>
					{/each}
				{/if}
			</div>
		{/if}
		<div class="main">
			{#if showSearch}
				<div class="psearch">
					<Search size={14} />
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={query} placeholder={t('shell.pickerSearchPlaceholder')} autofocus />
				</div>
			{/if}
			<div class="rows" role="presentation" onmouseleave={() => (hoverIdx = null)}>
				{#each rows as row, i (row.id)}
					{#if row.group && (i === 0 || rows[i - 1]?.group !== row.group)}
						<div class="row-group">{row.group}</div>
					{/if}
					<button
						class="prow"
						class:sel={i === selIdx}
						onclick={() => onSelect(row.command)}
						onmouseenter={() => hoverRow(i)}
					>
						<Vendor model={row.vendor ?? row.label} size={15} />
						<span class="prow-main">{row.label || t('shell.empty')}</span>
						<span class="prow-detail">{row.detail}</span>
						{#if row.active}<Check size={14} class="prow-check" />{/if}
					</button>
				{/each}
				{#if rows.length === 0}
					<div class="pempty">{query.trim() ? t('shell.noMatch') : t('shell.noOptions')}</div>
				{/if}
			</div>
			<div class="pop-foot">{t('shell.pickerFoot')}</div>
		</div>
		<!-- Reserved-width effort column: content swaps with the focused row but
		     the column itself never appears/disappears, so the popover width and
		     the model rows' heights stay put. -->
		<div class="effcol" role="group" aria-label={t('chat.effortTitle')}>
			<span class="effcap">{t('chat.effortTitle')}</span>
			{#if chipRow && chipEfforts(chipRow).length}
				{@const row = chipRow}
				<span class="effmodel" title={row.label}>{row.label}</span>
				{#each chipEfforts(row) as ef (ef)}
					<button
						class="eff"
						class:on={row.active && ef === activeEffort}
						onclick={() => onSelect(`${row.command} ${ef}`)}
					>{ef}</button>
				{/each}
			{:else}
				<span class="effempty">{t('chat.effortNone')}</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.pop-backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 20;
		cursor: default;
	}
	/* Anchored above the composer's model button (the caller wraps us in a
	   position:relative container), matching the shared popover pattern. */
	.pop {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 21;
		width: min(544px, 92vw);
		max-height: min(60vh, 440px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	/* Locked sessions drop the agent rail — two columns need less room. */
	.pop.norail {
		width: min(500px, 90vw);
	}
	.pop-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 10px 16px;
		font-weight: 600;
		font-size: 13.5px;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.pop-body {
		display: flex;
		min-height: 0;
		flex: 1;
	}
	/* Left agent rail: one icon per coding agent, current one highlighted. */
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 6px;
		border-right: 1px solid var(--hairline);
		overflow-y: auto;
		flex-shrink: 0;
	}
	.railbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
	}
	.railbtn:hover {
		background: var(--surface2);
	}
	.railbtn.on {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent);
	}
	.railbtn.miss {
		opacity: 0.45;
	}
	.railbtn:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.railsep {
		width: 20px;
		border-top: 1px solid var(--hairline);
		margin: 3px 0;
	}
	.main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.psearch {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
		flex-shrink: 0;
	}
	.psearch input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13px;
	}
	.psearch input::placeholder {
		color: var(--dim2);
	}
	.rows {
		overflow-y: auto;
		padding: 6px;
		flex: 1;
	}
	.row-group {
		padding: 8px 11px 4px;
		color: var(--dim2);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.row-group:not(:first-child) {
		margin-top: 3px;
		border-top: 1px solid var(--hairline);
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		text-align: left;
		padding: 8px 11px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.prow.sel {
		background: var(--surface2);
	}
	.prow-main {
		flex: 1;
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prow-detail {
		color: var(--dim);
		font-size: 11.5px;
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	:global(.prow-check) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	/* Fixed-width column of the focused model's thinking levels: one chip per
	   effort, chip = model+effort. Width is reserved even when empty so
	   hovering never resizes the popover or reflows the model list. */
	.effcol {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 5px;
		width: 118px;
		flex-shrink: 0;
		padding: 10px;
		border-left: 1px solid var(--hairline);
		overflow-y: auto;
	}
	.effcap {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--dim2);
	}
	.effmodel {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 2px;
	}
	.effempty {
		font-size: 11px;
		color: var(--dim2);
	}
	.eff {
		font-family: var(--font-mono);
		font-size: 11px;
		text-align: center;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--dim);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.eff:hover {
		color: var(--text);
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.eff.on {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}
	.pempty {
		padding: 18px;
		text-align: center;
		color: var(--dim);
		font-size: 13px;
	}
	.pop-foot {
		padding: 8px 14px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--dim2);
		text-align: center;
		flex-shrink: 0;
	}
</style>
