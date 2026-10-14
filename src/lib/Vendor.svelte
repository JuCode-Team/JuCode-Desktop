<script lang="ts">
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import ServerIcon from '@lucide/svelte/icons/server';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import { modelBrand, providerBrand } from '$lib/brandIcons';

	// Brand mark for a model (by name) or a provider (by id), from brandIcons;
	// `mono` inside controls. A model with no known brand shows a sparkle, a
	// provider a server; JuCode the same terminal icon as its engine (the brand
	// is a wordmark, no logo).
	let { model, provider, size = 14, mono = false }: { model?: string; provider?: string; size?: number; mono?: boolean } = $props();

	const svg = $derived(provider ? providerBrand(provider, mono) : model ? modelBrand(model, mono) : undefined);
</script>

{#if svg}
	<span class="vendor" style:font-size="{size}px" aria-hidden="true">{@html svg}</span>
{:else if provider === 'jucode'}
	<SquareTerminalIcon {size} />
{:else if provider}
	<ServerIcon {size} />
{:else}
	<SparklesIcon {size} />
{/if}

<style>
	.vendor {
		display: inline-flex;
		align-items: center;
		line-height: 0;
		flex-shrink: 0;
	}
	.vendor :global(svg) {
		width: 1em;
		height: 1em;
	}
</style>
