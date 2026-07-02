<script lang="ts">
	import { X, FileText } from 'lucide-svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import IconButton from '$lib/ui/IconButton.svelte';

	let {
		attachments,
		onRemove
	}: {
		attachments: { path: string; image: boolean }[];
		onRemove: (i: number) => void;
	} = $props();

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
</script>

<div class="chips">
	{#each attachments as a, i (a.path)}
		<span class="chip" class:imgchip={a.image}>
			{#if a.image}<img class="chip-thumb" src={convertFileSrc(a.path)} alt="" />{:else}<FileText size={12} />{/if}
			<span class="chip-name">{base(a.path)}</span>
			<IconButton size="xs" onclick={() => onRemove(i)} label="remove"><X size={12} /></IconButton>
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
		border-radius: 7px;
		padding: 3px 5px 3px 8px;
		max-width: 200px;
	}
	.chip.imgchip {
		padding: 3px 5px 3px 3px;
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
</style>
