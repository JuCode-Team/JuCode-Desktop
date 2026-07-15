<script lang="ts">
	import { X, FileText, Film, Globe } from 'lucide-svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import IconButton from '$lib/ui/IconButton.svelte';
	import type { WebRef } from '$lib/browser.svelte';
	import { t } from '$lib/i18n';

	let {
		attachments,
		videos = [],
		webRefs = [],
		onRemove,
		onRemoveVideo,
		onRemoveRef
	}: {
		attachments: { path: string; image: boolean }[];
		videos?: { path: string; frames: string[]; duration: number }[];
		webRefs?: WebRef[];
		onRemove: (i: number) => void;
		onRemoveVideo?: (i: number) => void;
		onRemoveRef?: (i: number) => void;
	} = $props();

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	const refLabel = (r: WebRef) => r.title || r.selector || r.url;
</script>

<div class="chips">
	{#each attachments as a, i (a.path)}
		<span class="chip" class:imgchip={a.image}>
			{#if a.image}<img class="chip-thumb" src={convertFileSrc(a.path)} alt="" />{:else}<FileText size={12} />{/if}
			<span class="chip-name">{base(a.path)}</span>
			<IconButton size="xs" onclick={() => onRemove(i)} label="remove"><X size={12} /></IconButton>
		</span>
	{/each}
	{#each videos as v, i (v.path)}
		<span class="chip videochip">
			{#if v.frames.length}<img class="chip-thumb" src={convertFileSrc(v.frames[0])} alt="" />{:else}<Film size={12} />{/if}
			<span class="chip-name">{base(v.path)}</span>
			<span class="chip-meta">{t('chat.videoMeta', { s: v.duration.toFixed(0), n: v.frames.length })}</span>
			<IconButton size="xs" onclick={() => onRemoveVideo?.(i)} label="remove"><X size={12} /></IconButton>
		</span>
	{/each}
	{#each webRefs as r, i (r.url + r.selector + i)}
		<span class="chip refchip" title={`${r.url}\n${r.selector}`}>
			<Globe size={12} />
			<span class="chip-name">{refLabel(r)}</span>
			<span class="chip-meta">&lt;{r.tag}&gt;</span>
			<IconButton size="xs" onclick={() => onRemoveRef?.(i)} label="remove"><X size={12} /></IconButton>
		</span>
	{/each}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-family: var(--font-mono);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 3px 5px 3px 8px;
		max-width: 200px;
		animation: rise var(--t-med) var(--ease-out);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.chip:hover {
		border-color: color-mix(in oklab, var(--text) 12%, var(--border));
	}
	.chip.imgchip,
	.chip.videochip {
		padding: 3px 5px 3px 3px;
	}
	.chip.refchip {
		max-width: 260px;
		border-color: color-mix(in oklab, var(--accent) 35%, var(--border));
		color: var(--accent-bright);
	}
	.chip-thumb {
		width: 26px;
		height: 26px;
		border-radius: 4px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.chip-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip-meta {
		color: var(--dim2);
		font-size: 11px;
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
