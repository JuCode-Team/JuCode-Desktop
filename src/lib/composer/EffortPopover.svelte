<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { RotateCcw } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import { defaultEffort, effortLabel, stepStop, stopAt } from './effort';

	// Reasoning-effort popover: current effort as the title, the model below it
	// (opens the model picker), a reset button and a segmented slider with one
	// stop per effort the model offers. A pick is committed on release so a
	// drag sends one /model command, not one per stop crossed.
	let {
		anchor,
		efforts,
		effort,
		model,
		disabled = false,
		onEffort,
		onModel
	}: {
		anchor?: HTMLElement;
		efforts: string[];
		effort: string;
		model: string;
		disabled?: boolean;
		onEffort: (effort: string) => void;
		/** Open the model picker; omitted when the backend has none. */
		onModel?: () => void;
	} = $props();

	let popEl = $state<HTMLDivElement>();
	let railEl = $state<HTMLDivElement>();
	let sliderEl = $state<HTMLDivElement>();
	let popTop = $state(0);
	let popLeft = $state(0);
	function position() {
		if (!anchor || !popEl) return;
		const trigger = anchor.getBoundingClientRect();
		const margin = 12;
		const top = trigger.top - popEl.offsetHeight - 8;
		popLeft = Math.min(Math.max(trigger.left, margin), window.innerWidth - popEl.offsetWidth - margin);
		popTop = top >= margin ? top : Math.min(trigger.bottom + 8, window.innerHeight - popEl.offsetHeight - margin);
	}
	onMount(() => {
		tick().then(() => {
			position();
			sliderEl?.focus();
		});
	});

	// Optimistic value between the commit and the engine's model_status ack.
	let pending = $state('');
	$effect(() => {
		effort;
		untrack(() => (pending = ''));
	});
	let drag = $state<number | null>(null);

	const current = $derived(pending || effort);
	const idx = $derived(Math.max(0, efforts.indexOf(current)));
	const shown = $derived(drag ?? idx);
	const last = $derived(Math.max(1, efforts.length - 1));
	const pct = (i: number) => (efforts.length > 1 ? (i / last) * 100 : 0);
	const def = $derived(defaultEffort(efforts));

	function commit(i: number) {
		const e = efforts[i];
		if (disabled || !e || e === current) return;
		pending = e;
		onEffort(e);
	}
	function stopFor(e: PointerEvent) {
		const r = railEl!.getBoundingClientRect();
		return stopAt(e.clientX, r.left, r.width, efforts.length);
	}
	function onDown(e: PointerEvent) {
		if (disabled || e.button !== 0 || !railEl) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = stopFor(e);
	}
	function onMove(e: PointerEvent) {
		if (drag !== null) drag = stopFor(e);
	}
	function onUp() {
		if (drag === null) return;
		const i = drag;
		drag = null;
		commit(i);
	}
	function onKey(e: KeyboardEvent) {
		if (disabled) return;
		const next = stepStop(e.key, idx, efforts.length);
		if (next === null) return;
		e.preventDefault();
		commit(next);
	}
</script>

<svelte:window onresize={position} />

<div class="effort-pop" role="dialog" aria-label={t('chat.effortTitle')} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px">
	<div class="head">
		<div class="titles">
			<span class="title">{effortLabel(current) || t('chat.effortTitle')}</span>
			{#if onModel}
				<button class="model" onclick={onModel} title={t('chat.switchModel')}>{model}</button>
			{:else}
				<span class="model static">{model}</span>
			{/if}
		</div>
		<IconButton
			size="sm"
			label={t('chat.effortReset')}
			title={t('chat.effortReset')}
			disabled={disabled || !def || current === def}
			onclick={() => commit(efforts.indexOf(def))}
		>
			<RotateCcw size={14} strokeWidth={1.5} />
		</IconButton>
	</div>
	<div
		class="slider"
		class:disabled
		class:dragging={drag !== null}
		bind:this={sliderEl}
		role="slider"
		tabindex="0"
		aria-label={t('chat.effortTitle')}
		aria-valuemin={0}
		aria-valuemax={efforts.length - 1}
		aria-valuenow={shown}
		aria-valuetext={effortLabel(efforts[shown] ?? '')}
		aria-disabled={disabled}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointercancel={() => (drag = null)}
		onkeydown={onKey}
	>
		<div class="rail" bind:this={railEl}>
			<div class="track"></div>
			<div class="fill" style:width="calc({pct(shown)}% + 30px)"></div>
			{#each efforts as e, i (e)}
				<span class="stop" class:passed={i <= shown} style:left="{pct(i)}%"></span>
			{/each}
			<span class="thumb" style:left="{pct(shown)}%"></span>
		</div>
	</div>
	<div class="ticks">
		{#each efforts as e, i (e)}
			<span class="tick" class:on={i === shown} style:left="{pct(i)}%">{effortLabel(e)}</span>
		{/each}
	</div>
</div>

<style>
	.effort-pop {
		position: fixed;
		z-index: 21;
		width: 288px;
		max-width: calc(100vw - 24px);
		padding: 12px 14px 12px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-pop);
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
	}
	.titles {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
	}
	.title {
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
	}
	.model {
		max-width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.model:hover:not(.static) {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.model.static {
		cursor: default;
	}
	/* The slider: padded hit area around a rail; the thumb is centred on a stop. */
	/* A 30px pill: stops sit on an inner line inset by the thumb's radius, so
	   the thumb stays inside the pill at both ends. */
	.slider {
		margin-top: 16px;
		padding: 0 15px;
		border-radius: var(--r-sm);
		cursor: pointer;
		touch-action: none;
		outline: none;
	}
	.slider:focus-visible {
		box-shadow: 0 0 0 2px var(--border);
	}
	.slider.disabled {
		opacity: 0.5;
		cursor: default;
	}
	.rail {
		position: relative;
		height: 30px;
	}
	.track,
	.fill {
		position: absolute;
		top: 0;
		left: -15px;
		height: 30px;
		border-radius: var(--r-full);
	}
	.track {
		right: -15px;
		background: var(--surface2);
	}
	.fill {
		background: color-mix(in oklab, var(--text) 16%, transparent);
		transition: width var(--t-fast) var(--ease-out);
	}
	.stop {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 4px;
		border-radius: var(--r-full);
		background: var(--dim2);
		transform: translate(-50%, -50%);
	}
	.stop.passed {
		background: color-mix(in oklab, var(--text) 55%, transparent);
	}
	.thumb {
		position: absolute;
		top: 50%;
		width: 26px;
		height: 26px;
		border-radius: var(--r-full);
		background: var(--text);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-pop);
		transform: translate(-50%, -50%);
		transition: left var(--t-fast) var(--ease-out);
	}
	:global([data-theme='light']) .thumb {
		background: var(--panel);
	}
	.slider.dragging .thumb,
	.slider.dragging .fill {
		transition: none;
	}
	.ticks {
		position: relative;
		height: 14px;
		margin: 2px 9px 0;
	}
	.tick {
		position: absolute;
		transform: translateX(-50%);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
	}
	.tick:first-child {
		transform: none;
		margin-left: -4px;
	}
	.tick:last-child {
		transform: translateX(-100%);
		margin-left: 4px;
	}
	.tick.on {
		color: var(--text);
	}
</style>
