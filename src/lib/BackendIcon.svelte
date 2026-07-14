<script lang="ts">
	// Engine-backend mark: vendor SVGs for codex (OpenAI) / claude, and the
	// JuCode wordmark initial for the native engine.
	import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
	import claude from '@lobehub/icons-static-svg/icons/claude.svg?raw';
	import type { BackendId } from '$lib/backends';

	let { backend, size = 14 }: { backend: BackendId; size?: number } = $props();
</script>

{#if backend === 'codex'}
	<span class="mark" style:font-size="{size}px" aria-hidden="true">{@html openai}</span>
{:else if backend === 'claude'}
	<span class="mark claude" style:font-size="{size}px" aria-hidden="true">{@html claude}</span>
{:else}
	<span class="mark ju" style:font-size="{size}px" style:width="{size}px" style:height="{size}px" aria-hidden="true">Ju</span>
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
	.mark.claude {
		color: #d97757;
	}
	.mark :global(svg) {
		width: 1em;
		height: 1em;
	}
	.mark.ju {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 0.62em !important;
		line-height: 1;
		letter-spacing: -0.02em;
		border-radius: 4px;
		background: var(--accent-soft);
		color: var(--accent-bright);
	}
</style>
