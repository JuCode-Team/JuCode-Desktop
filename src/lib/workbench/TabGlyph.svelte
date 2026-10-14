<script lang="ts">
	import ActiveIcon from '$lib/icons/ActiveIcon.svelte';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import CodeIcon from '@lucide/svelte/icons/code';
	import BugIcon from '@lucide/svelte/icons/bug';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import StarIcon from '@lucide/svelte/icons/star';
	import HouseIcon from '@lucide/svelte/icons/house';
	import FileIcon from '@lucide/svelte/icons/file';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import BotIcon from '@lucide/svelte/icons/bot';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import BoxIcon from '@lucide/svelte/icons/box';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import TargetIcon from '@lucide/svelte/icons/target';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import { isEmojiSlug, type TabIcon } from './tabChrome';

	// One tab glyph: builtin icon (filled when active), slug (icon name / emoji / short
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
	const ICONS: Record<string, typeof LayersIcon> = {
		layers: LayersIcon, folder: FolderIcon, code: CodeIcon, bug: BugIcon, rocket: RocketIcon,
		terminal: TerminalIcon, globe: GlobeIcon, star: StarIcon, home: HouseIcon, file: FileIcon,
		'git-branch': GitBranchIcon, bot: BotIcon, sparkles: SparklesIcon, zap: ZapIcon,
		heart: HeartIcon, bookmark: BookmarkIcon, box: BoxIcon, cpu: CpuIcon, database: DatabaseIcon,
		'message-square': MessageSquareTextIcon, search: SearchIcon, shield: ShieldIcon,
		target: TargetIcon, wrench: WrenchIcon
	};

	const Glyph = $derived(
		icon?.kind === 'builtin'
			? ICONS[icon.id]
			: icon?.kind === 'slug'
				? (ICONS[icon.value.toLowerCase()] ?? null)
				: null
	);
	const badge = $derived(
		icon?.kind === 'slug' && !Glyph && !isEmojiSlug(icon.value) ? icon.value.slice(0, 2) : ''
	);
</script>

<span class="glyph" style:width="{size + 2}px" style:height="{size + 2}px" style:color={color ?? undefined}>
	{#if Glyph}
		<ActiveIcon icon={Glyph} {size} {active} />
	{:else if icon?.kind === 'slug' && isEmojiSlug(icon.value)}
		<span class="emoji" style:font-size="{size}px">{icon.value.trim()}</span>
	{:else if badge}
		<span class="badge" style:font-size="{Math.max(8, size - 4)}px">{badge}</span>
	{:else if icon?.kind === 'svg'}
		<!-- eslint-disable-next-line svelte/no-at-html-tags — markup is stored pre-sanitized -->
		<span class="svgbox">{@html icon.markup}</span>
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
</style>
