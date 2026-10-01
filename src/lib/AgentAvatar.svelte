<script lang="ts">
	// An agent's picture: its custom icon on a tile tinted in its colour, or
	// the avatar generated from its seed (the id for agents without one).
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import { normalizeColor, parseTabIcon } from '$lib/workbench/tabChrome';
	import { avatarSvg } from '$lib/avatar';
	import type { AgentView } from '$lib/agents.svelte';

	let {
		agent,
		size = 18
	}: {
		agent: Pick<AgentView, 'id' | 'icon' | 'color' | 'avatar_seed'>;
		size?: number;
	} = $props();

	// The daemon checks only the icon's shape: sanitize before drawing it.
	const icon = $derived(parseTabIcon(agent.icon));
	const color = $derived(normalizeColor(agent.color));
	const svg = $derived(icon ? '' : avatarSvg(agent.avatar_seed || agent.id, color));
</script>

<span
	class="avatar"
	style:width="{size}px"
	style:height="{size}px"
	style:border-radius="{Math.round(size * 0.22)}px"
	style:--tint={color ?? 'var(--dim)'}
	class:custom={!!icon}
>
	{#if icon}
		<TabGlyph {icon} {color} size={Math.round(size * 0.62)} />
	{:else}
		<!-- eslint-disable-next-line svelte/no-at-html-tags — generated here, no user markup -->
		{@html svg}
	{/if}
</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: hidden;
	}
	.avatar.custom {
		background: color-mix(in oklab, var(--tint) 16%, transparent);
	}
	.avatar :global(> svg) {
		width: 100%;
		height: 100%;
	}
</style>
