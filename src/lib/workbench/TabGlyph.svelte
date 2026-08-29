<script lang="ts">
	import {
		Layers, Folder, Code, Bug, Rocket, Terminal, Globe, Star, Home, File,
		GitBranch, Bot, Sparkles, Zap, Heart, Bookmark, Box, Cpu, Database,
		MessageSquare, Search, Shield, Target, Wrench
	} from 'lucide-svelte';
	import { isEmojiSlug, type TabIcon } from './tabChrome';

	// One tab glyph: builtin lucide icon, slug (lucide name / emoji / short
	// badge), sanitized SVG, or the plain status dot fallback.
	let {
		icon = null,
		color = null,
		active = false,
		size = 12
	}: {
		icon?: TabIcon | null;
		color?: string | null;
		active?: boolean;
		size?: number;
	} = $props();

	// Static map — every builtin is imported above; no dynamic import().
	const ICONS: Record<string, typeof Layers> = {
		layers: Layers, folder: Folder, code: Code, bug: Bug, rocket: Rocket,
		terminal: Terminal, globe: Globe, star: Star, home: Home, file: File,
		'git-branch': GitBranch, bot: Bot, sparkles: Sparkles, zap: Zap,
		heart: Heart, bookmark: Bookmark, box: Box, cpu: Cpu, database: Database,
		'message-square': MessageSquare, search: Search, shield: Shield,
		target: Target, wrench: Wrench
	};

	const Lucide = $derived(
		icon?.kind === 'builtin'
			? ICONS[icon.id]
			: icon?.kind === 'slug'
				? (ICONS[icon.value.toLowerCase()] ?? null)
				: null
	);
	const badge = $derived(
		icon?.kind === 'slug' && !Lucide && !isEmojiSlug(icon.value) ? icon.value.slice(0, 2) : ''
	);
</script>

<span class="glyph" style:width="{size + 2}px" style:height="{size + 2}px" style:color={color ?? undefined}>
	{#if Lucide}
		<Lucide {size} />
	{:else if icon?.kind === 'slug' && isEmojiSlug(icon.value)}
		<span class="emoji" style:font-size="{size}px">{icon.value.trim()}</span>
	{:else if badge}
		<span class="badge" style:font-size="{Math.max(8, size - 4)}px">{badge}</span>
	{:else if icon?.kind === 'svg'}
		<!-- eslint-disable-next-line svelte/no-at-html-tags — markup is stored pre-sanitized -->
		<span class="svgbox">{@html icon.markup}</span>
	{:else}
		<span class="dot" class:on={active} style:background={color ?? undefined}></span>
	{/if}
</span>

<style>
	.glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		line-height: 1;
	}
	.emoji {
		line-height: 1;
	}
	.badge {
		font-family: var(--font-mono);
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: currentColor;
	}
	.svgbox {
		display: inline-flex;
		width: 100%;
		height: 100%;
	}
	.svgbox :global(svg) {
		width: 100%;
		height: 100%;
	}
	/* Fallback: the mosaic's ldot look. */
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--dim2);
	}
	.dot.on {
		background: var(--accent-bright);
	}
</style>
