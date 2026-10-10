<script lang="ts">
	// The image the user clicked, over the whole window: fitted first; a click
	// on it (or the size button) shows it at its own size, scrollable; ← → go
	// through the set it came from; Escape or a click beside it closes.
	import { convertFileSrc } from '@tauri-apps/api/core';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimpleIcon';
	import ArrowsInSimpleIcon from 'phosphor-svelte/lib/ArrowsInSimpleIcon';
	import { t } from '$lib/i18n';
	import { focusTrap } from '$lib/focusTrap';
	import { imageViewer } from './imageViewer.svelte';
	import { scrim } from './motion';

	const current = $derived(imageViewer.images[imageViewer.index]);
	const count = $derived(imageViewer.images.length);

	let src = $state('');
	let failed = $state(false);
	let actual = $state(false);
	// Whether the image is larger than the window, i.e. its own size differs from the fitted one.
	let zoomable = $state(false);
	$effect(() => {
		const img = current;
		src = '';
		failed = false;
		actual = false;
		zoomable = false;
		if (!img) return;
		if (!img.load) {
			src = convertFileSrc(img.path);
			return;
		}
		img.load(img.path).then(
			(data) => current === img && (src = data),
			() => current === img && (failed = true)
		);
	});

	const name = $derived(current ? current.path.split(/[\\/]/).pop() || current.path : '');

	function measure(e: Event) {
		const el = e.currentTarget as HTMLImageElement;
		zoomable = el.naturalWidth > el.clientWidth + 1 || el.naturalHeight > el.clientHeight + 1;
	}

	function onKey(e: KeyboardEvent) {
		if (!current) return;
		if (e.key === 'Escape') imageViewer.close();
		else if (e.key === 'ArrowLeft') imageViewer.step(-1);
		else if (e.key === 'ArrowRight') imageViewer.step(1);
		else return;
		e.preventDefault();
		e.stopPropagation();
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<svelte:window onkeydowncapture={onKey} />

{#if current}
	<div class="viewer-root">
		<div
			use:portal
			use:focusTrap
			class="viewer"
			role="dialog"
			aria-modal="true"
			aria-label={t('common.image.viewer')}
			tabindex="-1"
			transition:scrim|global
		>
			<header>
				<span class="name" title={current.path}>{name}</span>
				{#if count > 1}<span class="num">{imageViewer.index + 1} / {count}</span>{/if}
				<span class="grow"></span>
				{#if zoomable || actual}
					<button
						class="ctl"
						onclick={() => (actual = !actual)}
						aria-label={actual ? t('common.image.fit') : t('common.image.actual')}
						title={actual ? t('common.image.fit') : t('common.image.actual')}
					>
						{#if actual}<ArrowsInSimpleIcon size={16} />{:else}<ArrowsOutSimpleIcon size={16} />{/if}
					</button>
				{/if}
				<button class="ctl" onclick={() => imageViewer.close()} aria-label={t('common.close')} title={t('common.close')}><XIcon size={16} /></button>
			</header>
			<!-- A click beside the image closes; on it, switches the size. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="stage" class:actual onclick={(e) => e.target === e.currentTarget && imageViewer.close()}>
				{#if failed}
					<p class="failed">{t('common.image.failed')}</p>
				{:else if src}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<img
						{src}
						alt={name}
						class:zoomable
						onload={measure}
						onerror={() => (failed = true)}
						onclick={() => (zoomable || actual) && (actual = !actual)}
					/>
				{/if}
			</div>
			{#if count > 1}
				<button class="nav prev" onclick={() => imageViewer.step(-1)} aria-label={t('common.image.prev')} title={t('common.image.prev')}><CaretLeftIcon size={18} /></button>
				<button class="nav next" onclick={() => imageViewer.step(1)} aria-label={t('common.image.next')} title={t('common.image.next')}><CaretRightIcon size={18} /></button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.viewer-root {
		display: contents;
	}
	/* Photos read best on near-black in either theme. */
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 250;
		display: flex;
		flex-direction: column;
		background: rgba(10, 10, 12, 0.95);
		-webkit-backdrop-filter: blur(6px);
		backdrop-filter: blur(6px);
		color: rgba(255, 255, 255, 0.86);
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 8px 12px 8px 20px;
		font-size: var(--fs-xs);
	}
	:global(html[data-os='macos']) header {
		padding-top: 28px;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		color: rgba(255, 255, 255, 0.7);
	}
	.num {
		flex: none;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.5);
	}
	.grow {
		flex: 1;
	}
	.ctl,
	.nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		color: rgba(255, 255, 255, 0.78);
		background: rgba(255, 255, 255, 0.08);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.ctl {
		width: 32px;
		height: 32px;
		border-radius: var(--r-md);
	}
	.ctl:hover,
	.nav:hover {
		background: rgba(255, 255, 255, 0.16);
		color: #fff;
	}
	.ctl:focus-visible,
	.nav:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.6);
		outline-offset: 2px;
	}
	.stage {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px 64px 40px;
		overflow: hidden;
	}
	.stage.actual {
		display: block;
		overflow: auto;
		padding: 0;
		text-align: center;
	}
	img {
		display: block;
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: var(--r-sm);
		user-select: none;
	}
	img.zoomable {
		cursor: zoom-in;
	}
	.stage.actual img {
		display: inline-block;
		max-width: none;
		max-height: none;
		margin: 24px;
		cursor: zoom-out;
	}
	.failed {
		margin: 0;
		font-size: var(--fs-sm);
		color: rgba(255, 255, 255, 0.6);
	}
	.nav {
		position: absolute;
		top: 50%;
		width: 40px;
		height: 40px;
		margin-top: -20px;
		border-radius: var(--r-full);
	}
	.prev {
		left: 14px;
	}
	.next {
		right: 14px;
	}
</style>
