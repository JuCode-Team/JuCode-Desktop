<script lang="ts">
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import type { Project } from '$lib/types';
	import { badgeColor, initials } from './projectBadge';

	let { project, size = 16 }: { project: Project; size?: number } = $props();
	const color = $derived(badgeColor(project.name, project.color));
</script>

{#if project.icon}
	<TabGlyph icon={project.icon} {color} {size} />
{:else}
	<span class="badge" style:--c={color} style:width="{size}px" style:height="{size}px" aria-hidden="true">{initials(project.name)}</span>
{/if}

<style>
	.badge {
		display: inline-grid;
		place-items: center;
		flex: none;
		border-radius: 25%;
		background: color-mix(in srgb, var(--c) 18%, transparent);
		color: color-mix(in srgb, var(--c) 70%, var(--text));
		font-family: var(--font-mono);
		font-size: 8.5px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1;
	}
</style>
