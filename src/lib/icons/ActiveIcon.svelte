<script lang="ts">
	// A lucide icon that turns solid when its item is selected. Icons without a
	// filled variant in FILLED fall back to a heavier stroke.
	import type { LucideIcon, LucideProps } from '@lucide/svelte';
	import { FILLED } from './filled';

	let {
		icon: Icon,
		active = false,
		size = 16,
		color,
		...rest
	}: LucideProps & { icon: LucideIcon; active?: boolean; size?: number; color?: string } = $props();

	const uid = $props.id();
	const body = $derived(active ? FILLED.get(Icon)?.replaceAll('MASK', `fi-${uid}`) : undefined);
</script>

{#if body}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		style:color
		{...rest}
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags — static markup from filled.ts -->
		{@html body}
	</svg>
{:else}
	<Icon {size} {color} strokeWidth={active ? 2 : undefined} {...rest} />
{/if}
