<script lang="ts">
	// The remote session's model menu, laid out like the desktop composer's
	// (composer/ModelMenu.svelte): the current model and the thinking effort
	// on the first page, the model list on the second. It opens at once from
	// the last catalog the engine sent while a fresh one is requested, and a
	// pick is shown right away (the caller marks it pending until the engine
	// confirms).
	import { onMount, tick, untrack } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import EffortSlider from '$lib/composer/EffortSlider.svelte';
	import { defaultEffort, effortLabel } from '$lib/composer/effort';
	import { fmtContext } from '$lib/composer/modelRows';
	import { modelColor, isTopEffort } from '$lib/modelColor';
	import type { ChatState } from '$lib/chat.svelte';
	import { t } from '$lib/i18n';

	let {
		chat,
		anchor,
		pendingModel = '',
		onPick,
		onEffort,
		onClose
	}: {
		chat: ChatState;
		anchor?: HTMLElement;
		/** A pick the engine has not confirmed yet. */
		pendingModel?: string;
		onPick: (model: string) => void;
		onEffort: (effort: string) => void;
		onClose: () => void;
	} = $props();

	// Above the model button, right edges aligned; below it when there is no
	// room above.
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
		// The fresh catalog arrives after opening; stay anchored as it grows.
		const ro = new ResizeObserver(position);
		if (popEl) ro.observe(popEl);
		return () => ro.disconnect();
	});

	/** The catalog the engine answered with for this opening, else the last one. */
	const fresh = $derived(chat.picker?.kind === 'model');
	const models = $derived(chat.picker?.kind === 'model' ? chat.picker.models : chat.modelCatalog);
	const current = $derived(pendingModel || models.find((m) => m.active)?.model || chat.model);
	const currentRow = $derived(models.find((m) => m.model === current));
	const modelName = $derived(currentRow?.label || chat.modelLabel || chat.model);

	// Without efforts the first page would hold a single row; open the list.
	let page = $state<'main' | 'models'>(untrack(() => (chat.efforts.length ? 'main' : 'models')));

	let shownEffort = $state('');
	const accent = $derived(modelColor(chat.model));
	const top = $derived(isTopEffort(shownEffort, chat.efforts));
	const def = $derived(defaultEffort(chat.efforts));

	// The page sits in a transformed pane on wide screens, which would make
	// `position: fixed` relative to the pane; the menu measures the window,
	// so it lives under <body>.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} onresize={position} />
<div class="mm-layer" use:portal>
<button class="mm-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div class="pop mm" role="dialog" aria-label={t('chat.switchModel')} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px">
	{#if page === 'main'}
		<section class="current">
			<button class="pop-row" onclick={() => (page = 'models')} title={t('chat.switchModel')}>
				<span class="pop-ico"><Vendor model={currentRow?.vendor ?? current} size={16} /></span>
				<span class="pop-txt"><span class="pop-label">{modelName}</span></span>
				{#if currentRow?.context_window}<span class="ctx">{fmtContext(currentRow.context_window)}</span>{/if}
				<span class="pop-ico caret"><CaretRightIcon size={14} /></span>
			</button>
		</section>
		<section class="effort">
			<div class="ehead">
				<span class="elabel">{t('chat.effortTitle')}</span>
				{#key shownEffort}<span class="evalue" class:effort-max={top} style:--effort-accent={accent || 'var(--text)'}>{effortLabel(shownEffort)}</span>{/key}
				<span class="grow"></span>
				<IconButton
					size="sm"
					label={t('chat.effortReset')}
					title={t('chat.effortReset')}
					disabled={!!pendingModel || !def || shownEffort === def}
					onclick={() => onEffort(def)}
				>
					<ArrowCounterClockwiseIcon size={14} />
				</IconButton>
			</div>
			<EffortSlider efforts={chat.efforts} effort={chat.effort} disabled={!!pendingModel} {onEffort} {accent} bind:current={shownEffort} />
		</section>
	{:else}
		<section class="models">
			{#if chat.efforts.length}
				<div class="mhead">
					<IconButton size="sm" label={t('shell.remote.back')} title={t('shell.remote.back')} onclick={() => (page = 'main')}>
						<CaretLeftIcon size={14} />
					</IconButton>
					<span class="mtitle">{t('chat.switchModel')}</span>
					{#if !fresh && models.length}<span class="refreshing"><CircleNotchIcon size={13} class="spin" /></span>{/if}
				</div>
			{:else}
				<div class="pop-head">
					{t('chat.switchModel')}
					{#if !fresh && models.length}<span class="refreshing"><CircleNotchIcon size={13} class="spin" /></span>{/if}
				</div>
			{/if}
			<div class="list" role="listbox" aria-label={t('chat.switchModel')}>
				{#each models as m (m.model)}
					<button class="pop-row" role="option" aria-selected={m.model === current} onclick={() => onPick(m.model)}>
						<span class="pop-ico"><Vendor model={m.vendor ?? m.model} size={16} /></span>
						<span class="pop-txt"><span class="pop-label">{m.label || m.model}</span></span>
						{#if m.context_window}<span class="ctx">{fmtContext(m.context_window)}</span>{/if}
						<span class="pop-check" class:off={m.model !== current}>
							{#if m.model === pendingModel}<CircleNotchIcon size={16} class="spin" />{:else}<CheckIcon size={16} />{/if}
						</span>
					</button>
				{:else}
					<div class="empty">
						{#if fresh}{t('shell.remote.noModels')}{:else}<CircleNotchIcon size={14} class="spin" /> {t('shell.remote.loadingModels')}{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
</div>

<style>
	.mm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		border: none;
		background: none;
		cursor: default;
	}
	.mm {
		position: fixed;
		z-index: 61;
		width: min(340px, calc(100vw - 24px));
		max-height: min(72vh, 620px);
		gap: 0;
		padding: 6px;
		transform-origin: bottom right;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.mm > section + section {
		margin-top: 6px;
		padding-top: 8px;
		border-top: 1px solid var(--hairline);
	}
	.current .pop-row {
		font-weight: 500;
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
	.pop-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.refreshing {
		display: inline-flex;
		margin-left: auto;
		color: var(--dim2);
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
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.list .pop-row {
		animation: fade var(--t-med) var(--ease-out);
	}
	.pop-row:active {
		background: var(--surface2);
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
	.pop-check:not(.off) :global(svg:not(.spin)) {
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.empty {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 12px;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
</style>
