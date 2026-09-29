<script lang="ts">
	import StackIcon from 'phosphor-svelte/lib/StackIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
	import BugIcon from 'phosphor-svelte/lib/BugIcon';
	import RocketIcon from 'phosphor-svelte/lib/RocketIcon';
	import TerminalIcon from 'phosphor-svelte/lib/TerminalIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import StarIcon from 'phosphor-svelte/lib/StarIcon';
	import HouseIcon from 'phosphor-svelte/lib/HouseIcon';
	import FileIcon from 'phosphor-svelte/lib/FileIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import LightningIcon from 'phosphor-svelte/lib/LightningIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import BookmarkSimpleIcon from 'phosphor-svelte/lib/BookmarkSimpleIcon';
	import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import DatabaseIcon from 'phosphor-svelte/lib/DatabaseIcon';
	import ChatCenteredTextIcon from 'phosphor-svelte/lib/ChatCenteredTextIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import ShieldIcon from 'phosphor-svelte/lib/ShieldIcon';
	import TargetIcon from 'phosphor-svelte/lib/TargetIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
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
	const ICONS: Record<string, typeof StackIcon> = {
		layers: StackIcon, folder: FolderIcon, code: CodeIcon, bug: BugIcon, rocket: RocketIcon,
		terminal: TerminalIcon, globe: GlobeIcon, star: StarIcon, home: HouseIcon, file: FileIcon,
		'git-branch': GitBranchIcon, bot: RobotIcon, sparkles: SparkleIcon, zap: LightningIcon,
		heart: HeartIcon, bookmark: BookmarkSimpleIcon, box: CubeIcon, cpu: CpuIcon, database: DatabaseIcon,
		'message-square': ChatCenteredTextIcon, search: MagnifyingGlassIcon, shield: ShieldIcon,
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
		<Glyph {size} weight={active ? 'fill' : 'regular'} />
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
