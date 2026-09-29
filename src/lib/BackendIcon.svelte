<script lang="ts">
	// Engine-backend mark: monochrome vendor SVGs for codex (OpenAI) / claude
	// and a generic plug for ACP agents. The native JuCode engine has no mark —
	// the brand is a wordmark only (brand-docs/DESIGN-SPEC.md).
	import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
	import claude from '@lobehub/icons-static-svg/icons/claude.svg?raw';
	import PlugIcon from 'phosphor-svelte/lib/PlugIcon';
	import type { BackendId } from '$lib/backends';

	let { backend, size = 14 }: { backend: BackendId; size?: number } = $props();
</script>

{#if backend === 'codex'}
	<span class="mark" style:font-size="{size}px" aria-hidden="true">{@html openai}</span>
{:else if backend === 'claude'}
	<span class="mark claude" style:font-size="{size}px" aria-hidden="true">{@html claude}</span>
{:else if backend === 'acp'}
	<span class="mark acp" style:font-size="{size}px" aria-hidden="true"><PlugIcon size={size} /></span>
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
