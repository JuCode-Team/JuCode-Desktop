<script lang="ts">
	import { Sparkles } from 'lucide-svelte';
	import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
	import claude from '@lobehub/icons-static-svg/icons/claude.svg?raw';
	import gemini from '@lobehub/icons-static-svg/icons/gemini.svg?raw';
	import mistral from '@lobehub/icons-static-svg/icons/mistral.svg?raw';
	import meta from '@lobehub/icons-static-svg/icons/meta.svg?raw';
	import deepseek from '@lobehub/icons-static-svg/icons/deepseek.svg?raw';
	import qwen from '@lobehub/icons-static-svg/icons/qwen.svg?raw';
	import grok from '@lobehub/icons-static-svg/icons/grok.svg?raw';

	let { model, size = 14 }: { model: string; size?: number } = $props();

	// Maps a model name to its vendor logo (from the maintained icon library) and
	// brand color. Monochrome SVGs are tinted via `color`; '' inherits currentColor.
	const VENDORS: Array<{ re: RegExp; svg: string; color: string }> = [
		{ re: /(^|[^a-z])(gpt|o[134]|chatgpt|codex|openai)/i, svg: openai, color: '' },
		{ re: /claude/i, svg: claude, color: '#D97757' },
		{ re: /gemini/i, svg: gemini, color: '#8E75B2' },
		{ re: /(mistral|mixtral|codestral|ministral|magistral)/i, svg: mistral, color: '#FA520F' },
		{ re: /(llama|meta)/i, svg: meta, color: '#0467DF' },
		{ re: /deepseek/i, svg: deepseek, color: '' },
		{ re: /qwen/i, svg: qwen, color: '' },
		{ re: /grok/i, svg: grok, color: '' }
	];

	const hit = $derived(VENDORS.find((v) => v.re.test(model)));
</script>

{#if hit}
	<span class="vendor" style:font-size="{size}px" style:color={hit.color || 'currentColor'} aria-hidden="true">{@html hit.svg}</span>
{:else}
	<Sparkles {size} />
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
