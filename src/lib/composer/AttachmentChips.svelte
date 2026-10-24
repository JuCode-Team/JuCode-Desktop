<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FilmIcon from '@lucide/svelte/icons/film';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import IconButton from '$lib/ui/IconButton.svelte';
	import type { WebRef } from '$lib/browser.svelte';
	import { t } from '$lib/i18n';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { fadeOut } from '$lib/ui/motion';

	let {
		attachments,
		webRefs = [],
		onRemove,
		onRemoveRef
	}: {
		attachments: { path: string; image: boolean }[];
		webRefs?: WebRef[];
		onRemove: (i: number) => void;
		onRemoveRef?: (i: number) => void;
	} = $props();

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	const isVideo = (p: string) => /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(p);
	const refLabel = (r: WebRef) => r.title || r.selector || r.url;
	/** The attached images full size, from the clicked one. */
	function view(path: string) {
		const images = attachments.filter((a) => a.image).map((a) => ({ path: a.path }));
		imageViewer.open(images, images.findIndex((i) => i.path === path));
	}
</script>

<div class="chips" out:fadeOut>
	<!-- Images as thumbnails (click: full size), other files as name chips. -->
	{#each attachments as a, i (a.path)}
		{#if a.image}
			<span class="imgcard" out:fadeOut>
				<button class="thumb-btn" onclick={() => view(a.path)} aria-label={t('common.image.open')} title={t('common.image.open')}><img src={convertFileSrc(a.path)} alt={base(a.path)} /></button>
				<button class="img-x" onclick={() => onRemove(i)} aria-label={t('common.remove')} title={t('common.remove')}><XIcon size={12} /></button>
			</span>
		{:else}
			<span class="chip" out:fadeOut>
				{#if isVideo(a.path)}<FilmIcon size={12} />{:else}<FileTextIcon size={12} />{/if}
				<span class="chip-name">{base(a.path)}</span>
				<IconButton size="xs" onclick={() => onRemove(i)} label="remove"><XIcon size={12} /></IconButton>
			</span>
		{/if}
	{/each}
	{#each webRefs as r, i (r.url + r.selector + i)}
		<span class="chip refchip" out:fadeOut title={`${r.url}\n${r.selector}`}>
			<GlobeIcon size={12} />
			<span class="chip-name">{refLabel(r)}</span>
			<span class="chip-meta">&lt;{r.tag}&gt;</span>
			<IconButton size="xs" onclick={() => onRemoveRef?.(i)} label="remove"><XIcon size={12} /></IconButton>
		</span>
	{/each}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: flex-end;
		margin-bottom: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r);
		padding: 3px 5px 3px 8px;
		max-width: 200px;
		animation: rise var(--t-med) var(--ease-out);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.chip:hover {
		border-color: color-mix(in oklab, var(--text) 12%, var(--border));
	}
	.imgcard {
		position: relative;
		width: 64px;
		height: 64px;
		flex-shrink: 0;
		animation: rise var(--t-med) var(--ease-out);
	}
	.imgcard .thumb-btn,
	.imgcard img {
		width: 100%;
		height: 100%;
	}
	.imgcard img {
		display: block;
		border-radius: var(--r);
		object-fit: cover;
		box-shadow: inset 0 0 0 1px var(--border);
	}
	/* Remove: a small button on the corner, shown on hover. */
	.img-x {
		position: absolute;
		top: -6px;
		right: -6px;
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: 50%;
		background: var(--panel);
		color: var(--dim);
		box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.imgcard:hover .img-x,
	.img-x:focus-visible {
		opacity: 1;
	}
	.img-x:hover {
		color: var(--text);
	}
	.chip.refchip {
		max-width: 260px;
		border-color: color-mix(in oklab, var(--accent) 35%, var(--border));
		color: var(--accent-bright);
	}
	.thumb-btn {
		display: inline-flex;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: var(--r);
		background: none;
		cursor: zoom-in;
	}
	.thumb-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.chip-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip-meta {
		color: var(--dim2);
		font-size: var(--fs-2xs);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
