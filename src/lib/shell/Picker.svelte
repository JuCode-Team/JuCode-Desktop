<script lang="ts">
	import { X, Check, Search } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { t } from '$lib/i18n';
	import Vendor from '$lib/Vendor.svelte';
	import type { ChatState } from '$lib/chat.svelte';

	type Row = {
		id: string;
		label: string;
		vendor?: string;
		detail: string;
		active: boolean;
		command: string;
		depth: number | undefined;
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
		onEffort
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
	} = $props();
</script>

{#snippet body()}
	<div class="modal-head">
		<span>{title}</span>
		<IconButton onclick={onClose} label="close"><X size={15} /></IconButton>
	</div>
	{#if chat.picker?.kind === 'model' && activeModel}
		<div class="efforts">
			<span class="dim">effort</span>
			{#each activeModel.reasoning_efforts as ef (ef)}
				<button class="eff" class:on={ef === chat.picker.activeEffort} onclick={() => onEffort(ef)}>{ef}</button>
			{/each}
		</div>
	{/if}
	{#if showSearch}
		<div class="psearch">
			<Search size={14} />
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={query} placeholder={t('shell.pickerSearchPlaceholder')} autofocus />
		</div>
	{/if}
	<div class="rows">
		{#each rows as row, i (row.id)}
			<button class="prow" class:sel={i === selIdx} onclick={() => onSelect(row.command)} onmouseenter={() => (selIdx = i)} style:padding-left={row.depth != null ? `${11 + row.depth * 16}px` : null}>
				{#if chat.picker?.kind === 'model'}<Vendor model={row.vendor ?? row.label} size={15} />{/if}
				{#if row.depth != null && row.depth > 0}<span class="twig">↳</span>{/if}
				<span class="prow-main">{row.label || t('shell.empty')}</span>
				<span class="prow-detail">{row.detail}</span>
				{#if row.active}<Check size={14} class="prow-check" />{/if}
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
	<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1" aria-label={title} use:focusTrap>
			{@render body()}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.modal {
		width: min(560px, 92vw);
		max-height: 76vh;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-modal);
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
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		animation: rise 0.12s ease;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 16px;
		font-weight: 600;
		font-size: 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.efforts {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--hairline);
		font-size: 12px;
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
		font-size: 13.5px;
	}
	.psearch input::placeholder {
		color: var(--dim2);
	}
	.dim {
		color: var(--dim);
	}
	.eff {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 999px;
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
	.twig {
		color: var(--dim2);
		font-family: var(--font-mono);
		margin-right: -4px;
		flex-shrink: 0;
	}
	.prow-detail {
		color: var(--dim);
		font-size: 12px;
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
		font-size: 13px;
	}
	.modal-foot {
		padding: 9px 16px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		font-family: var(--font-mono);
		text-align: center;
	}
</style>
