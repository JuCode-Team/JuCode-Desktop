<script lang="ts">
	// Engine-backend mark: a generic terminal icon for the native engine (the
	// JuCode brand is a wordmark, no logo), vendor marks for codex (OpenAI) /
	// claude and a generic plug for ACP agents. `mono` inside controls.
	import { modelBrand } from '$lib/brandIcons';
	import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import type { BackendId } from '$lib/backends';

	let { backend, size = 14, mono = false }: { backend: BackendId; size?: number; mono?: boolean } = $props();
</script>

{#if backend === 'jucode'}
	<span class="mark" style:font-size="{size}px" aria-hidden="true"><SquareTerminalIcon {size} /></span>
{:else if backend === 'codex'}
	<span class="mark" style:font-size="{size}px" aria-hidden="true">{@html openai}</span>
{:else if backend === 'claude'}
	<span class="mark" style:font-size="{size}px" aria-hidden="true">{@html modelBrand('claude', mono)}</span>
{:else if backend === 'acp'}
	<span class="mark acp" style:font-size="{size}px" aria-hidden="true"><PlugIcon {size} /></span>
{/if}

<style>
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		flex-shrink: 0;
		color: currentColor;
	}
	.mark.acp {
		color: var(--dim);
	}
	.mark :global(svg) {
		width: 1em;
		height: 1em;
	}
</style>
