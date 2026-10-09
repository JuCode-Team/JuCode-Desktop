<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { t } from '$lib/i18n';
	import Vendor from '$lib/Vendor.svelte';
	import type { ChatState } from '$lib/chat.svelte';
	import type { Snippet } from 'svelte';

	type Row = {
		id: string;
		label: string;
		vendor?: string;
		detail: string;
		active: boolean;
		command: string;
		depth: number | undefined;
		group?: string;
	};

	let {
		chat,
		title,
		activeModel,
		rows,
		showSearch,
		anchored = false,
		query = $bindable(),
		selIdx = $bindable(),
		onClose,
		onSelect,
		onEffort,
		header
	}: {
		chat: ChatState;
		title: string;
		activeModel: { model: string; reasoning_efforts: string[]; active: boolean } | undefined;
		rows: Row[];
		showSearch: boolean;
		// Anchored: render as a compact popover above the caller (no dimmed overlay,
		// no focus trap) instead of a screen-centered modal.
		anchored?: boolean;
		query: string;
		selIdx: number;
		onClose: () => void;
		onSelect: (command: string) => void;
		onEffort: (effort: string) => void;
		/** Above the search box (e.g. the history picker's source tabs). */
		header?: Snippet;
	} = $props();
</script>

{#snippet body()}
	{#if anchored}
		<div class="modal-head">
			<span>{title}</span>
			<IconButton onclick={onClose} label="close"><XIcon size={15} /></IconButton>
		</div>
	{/if}
	{#if chat.picker?.kind === 'model' && activeModel}
		<div class="efforts">
			<span class="dim">effort</span>
			{#each activeModel.reasoning_efforts as ef (ef)}
				<button class="eff" class:on={ef === chat.picker.activeEffort} onclick={() => onEffort(ef)}>{ef}</button>
			{/each}
		</div>
	{/if}
	{#if header}<div class="pheader">{@render header()}</div>{/if}
	{#if showSearch}
		<div class="psearch">
			<MagnifyingGlassIcon size={14} />
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={query} placeholder={t('shell.pickerSearchPlaceholder')} autofocus />
		</div>
	{/if}
	<div class="rows">
		{#each rows as row, i (row.id)}
			{#if row.group && (i === 0 || rows[i - 1]?.group !== row.group)}
				<div class="row-group">{row.group}</div>
			{/if}
			<button class="prow" class:sel={i === selIdx} onclick={() => onSelect(row.command)} onmouseenter={() => (selIdx = i)} style:padding-left={row.depth != null ? `${11 + row.depth * 16}px` : null}>
				{#if chat.picker?.kind === 'model'}<Vendor model={row.vendor ?? row.label} size={15} />{/if}
				{#if row.depth != null && row.depth > 0}<span class="twig">↳</span>{/if}
				<span class="prow-main">{row.label || t('shell.empty')}</span>
				<span class="prow-detail">{row.detail}</span>
				{#if row.active}<CheckIcon size={14} class="prow-check" />{/if}
			</button>
		{/each}
		{#if rows.length === 0}<div class="pempty">{query.trim() ? t('shell.noMatch') : t('shell.noOptions')}</div>{/if}
	</div>
	<div class="modal-foot dim">{t('shell.pickerFoot')}</div>
{/snippet}

{#if anchored}
	<button class="pop-backdrop" aria-label="close" onclick={onClose}></button>
	<div class="modal anchored" role="dialog" aria-label={title}>
		{@render body()}
	</div>
{:else}
	<Modal {title} width={560} placement="top" padded={false} {onClose}>
		{@render body()}
	</Modal>
{/if}

<style>
	.pheader {
		padding: 4px 14px 10px;
	}
	.modal {
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		overflow: hidden;
	}
	/* Anchored popover: sits above the caller (composer's model button), not
	   centered. The caller wraps us in a position:relative container. */
	.pop-backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 20;
		cursor: default;
	}
	.modal.anchored {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 21;
		width: min(380px, 82vw);
		max-height: min(60vh, 420px);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-pop);
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-out);
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 16px;
		font-weight: 600;
		font-size: var(--fs-md);
		border-bottom: 1px solid var(--hairline);
	}
	.efforts {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--hairline);
		font-size: var(--fs-xs);
	}
	.psearch {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
	}
	.psearch input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
	}
	.psearch input::placeholder {
		color: var(--dim2);
	}
	.dim {
		color: var(--dim);
	}
	.eff {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		padding: 3px 10px;
		border-radius: var(--r-full);
		border: 1px solid var(--border);
		background: var(--surface2);
		color: var(--dim);
		cursor: pointer;
	}
	.eff.on {
		color: var(--on-accent);
		background: var(--accent);
		border-color: var(--accent);
	}
	.rows {
		overflow-y: auto;
		padding: 6px;
	}
	.row-group {
		padding: 8px 11px 4px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
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
		padding: 9px 11px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: var(--fs-sm);
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
	.twig {
		color: var(--dim2);
		font-family: var(--font-mono);
		margin-right: -4px;
		flex-shrink: 0;
	}
	.prow-detail {
		color: var(--dim);
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	:global(.prow-check) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.pempty {
		padding: 18px;
		text-align: center;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.modal-foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		text-align: center;
	}
</style>
