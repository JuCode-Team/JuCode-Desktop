<script lang="ts">
	// Renders ui/notices.svelte.ts in the bottom-right corner, left of the
	// built-in browser when it covers that corner: the browser is a native
	// window above the page, so a notice under it could not be seen.
	import XIcon from '@lucide/svelte/icons/x';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { T_FAST, T_MED, motionMs } from './motion';
	import { notices } from './notices.svelte';
	import { browser } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { t } from '$lib/i18n';

	const EDGE = 16;
	/** The corner a notice stack takes, to test against the browser. */
	const AREA_W = 360;
	const AREA_H = 160;

	let vw = $state(0);
	let vh = $state(0);

	const right = $derived.by(() => {
		const r = browser.shown;
		if (!r) return EDGE;
		const z = prefs.zoom || 1;
		const left = r.x / z;
		const bottom = (r.y + r.h) / z;
		const covers = left + r.w / z > vw - AREA_W && bottom > vh - AREA_H;
		return covers ? Math.max(EDGE, vw - left + EDGE) : EDGE;
	});
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<!-- Not under an {#if}: the first notice's entrance and the last one's exit
     would not play (transitions are local to their block). -->
<div class="notices" style:right="{right}px" role="region" aria-live="polite">
	{#each notices.items as n (n.id)}
		<div
			class="notice"
			role="status"
			onpointerenter={() => notices.hold(n.id)}
			onpointerleave={() => notices.resume(n.id)}
			animate:flip={{ duration: motionMs(T_MED), easing: cubicOut }}
			in:fly={{ y: 8, duration: motionMs(T_MED), easing: cubicOut }}
			out:fly={{ x: 12, duration: motionMs(T_FAST), easing: cubicOut }}
		>
			<div class="body">
				<div class="title">{n.title}</div>
				{#if n.detail}<div class="detail selectable">{n.detail}</div>{/if}
			</div>
			{#if n.action}
				<button
					class="act"
					onclick={() => {
						n.action?.run();
						notices.dismiss(n.id);
					}}>{n.action.label}</button
				>
			{/if}
			<button class="close" aria-label={t('common.close')} onclick={() => notices.dismiss(n.id)}><XIcon size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.notices {
		position: fixed;
		bottom: 16px;
		z-index: 190;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		max-width: calc(100vw - 32px);
		transition: right var(--t-med) var(--ease-out);
	}
	.notice {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 340px;
		max-width: 100%;
		padding: 10px 8px 10px 14px;
		border-radius: var(--r);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		line-height: 1.4;
	}
	.detail {
		margin-top: 2px;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.act {
		flex-shrink: 0;
		padding: 4px 10px;
		border: none;
		border-radius: var(--r);
		background: color-mix(in oklab, var(--text) 10%, transparent);
		color: inherit;
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.act:hover {
		background: color-mix(in oklab, var(--text) 16%, transparent);
	}
	.close {
		display: inline-flex;
		flex-shrink: 0;
		padding: 4px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.close:hover {
		color: var(--text);
		background: color-mix(in oklab, var(--text) 8%, transparent);
	}
</style>
