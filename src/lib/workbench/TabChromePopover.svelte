<script lang="ts">
	import { overBrowser } from '$lib/browser.svelte';
	import ArrowRightLeftIcon from '@lucide/svelte/icons/arrow-right-left';
	import { tick, type Snippet } from 'svelte';
	import BanIcon from '@lucide/svelte/icons/ban';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import { t } from '$lib/i18n';
	import { PICKER_ICONS, parseTabIcon, sanitizeSvg, TAB_COLORS, type TabIcon } from './tabChrome';
	import TabGlyph from './TabGlyph.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { popOut } from '$lib/ui/motion';
	import Collapse from '$lib/ui/Collapse.svelte';

	// Shared chrome editor for workspace tabs, session tabs, project folders
	// and agents: rename, tag color, and icon (builtin grid / slug / pasted
	// SVG), the latter two folded under 外观. Mosaic tabs add close actions;
	// tabs without chrome get only those. Fixed-position at the invoking
	// pointer/anchor, clamped to the viewport.
	let {
		x,
		y,
		name,
		color = null,
		icon = null,
		onRename,
		onColor,
		onIcon,
		onDelete,
		deleteLabel = '',
		pinned = false,
		onPin,
		moveTargets = [],
		moveLabel,
		onMove,
		onCloseOthers,
		onCloseAll,
		onClose,
		defaultIcon,
		children
	}: {
		x: number;
		y: number;
		name: string;
		color?: string | null;
		icon?: TabIcon | null;
		/** Without it there is no name field. */
		onRename?: (name: string) => void;
		/** Without them there is no 外观 section. */
		onColor?: (color: string | null) => void;
		onIcon?: (icon: TabIcon | null) => void;
		onDelete?: () => void;
		deleteLabel?: string;
		/** Sessions: pin or unpin it in the sidebar. */
		pinned?: boolean;
		onPin?: (pinned: boolean) => void;
		/** Projects and agents: the other workspaces it can move to. */
		moveTargets?: { id: string; name: string }[];
		onMove?: (workspace: string) => void;
		/** Heads the move targets (default: 移到工作区). */
		moveLabel?: string;
		/** Mosaic tabs: close the other tabs / every tab of its group. */
		onCloseOthers?: () => void;
		onCloseAll?: () => void;
		onClose: () => void;
		/** What shows with no icon set (a project's folder, an agent's
		 *  generated avatar): the first choice, so it can be picked back. */
		defaultIcon?: Snippet;
		/** Caller-specific controls below the icon fields (agents: the avatar). */
		children?: Snippet;
	} = $props();

	// Drafts seed once from the props (the popover is transient); live edits
	// flow back through the callbacks, never the other way.
	// svelte-ignore state_referenced_locally
	let nameVal = $state(name);
	// svelte-ignore state_referenced_locally
	let slugVal = $state(icon?.kind === 'slug' ? icon.value : '');
	// svelte-ignore state_referenced_locally
	let svgVal = $state(icon?.kind === 'svg' ? icon.markup : '');
	let svgError = $state(false);
	// Name/emoji and SVG are rarely used: folded unless the icon is one.
	// svelte-ignore state_referenced_locally
	let custom = $state(icon?.kind === 'slug' || icon?.kind === 'svg');
	let looks = $state(false);
	let nameEl = $state<HTMLInputElement | null>(null);
	let popW = $state(0);
	let popH = $state(0);

	$effect(() => {
		if (nameEl) tick().then(() => nameEl?.select());
	});

	const clamp = (v: number, max: number) => Math.min(Math.max(v, 8), Math.max(8, max));
	const left = $derived(clamp(x, window.innerWidth - popW - 8));
	const top = $derived(clamp(y, window.innerHeight - popH - 8));

	function commitName() {
		const v = nameVal.trim();
		if (v && v !== name) onRename?.(v);
	}
	function commitSlug() {
		const parsed = parseTabIcon({ kind: 'slug', value: slugVal });
		if (parsed) onIcon?.(parsed);
	}
	function commitSvg() {
		if (!svgVal.trim()) return;
		const clean = sanitizeSvg(svgVal);
		svgError = !clean;
		if (clean) onIcon?.({ kind: 'svg', markup: clean });
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<button class="backdrop" aria-label="close" onclick={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }}></button>
<div
	use:overBrowser
	class="pop"
	out:popOut
	role="dialog"
	aria-label={t('shell.chrome.title')}
	bind:clientWidth={popW}
	bind:clientHeight={popH}
	style:left="{left}px"
	style:top="{top}px"
>
	{#if onRename}
		<label class="field">
			<span class="lbl">{t('shell.chrome.name')}</span>
			<input
				class="txt"
				bind:this={nameEl}
				bind:value={nameVal}
				onblur={commitName}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						commitName();
						onClose();
					}
				}}
			/>
		</label>
	{/if}

	{#if onColor && onIcon}
	<button class="more" onclick={() => (looks = !looks)} aria-expanded={looks}>
		{#if looks}<ChevronDownIcon size={12} />{:else}<ChevronRightIcon size={12} />{/if}{t('shell.chrome.title')}
	</button>
	<Collapse open={looks}>
		<div class="lbl">{t('shell.chrome.color')}</div>
		<div class="swatches">
			<button
				class="swatch none"
				class:on={!color}
				title={t('shell.chrome.noColor')}
				aria-label={t('shell.chrome.noColor')}
				onclick={() => onColor!(null)}><BanIcon size={12} /></button
			>
			{#each TAB_COLORS as c (c)}
				<button
					class="swatch"
					class:on={color === c}
					style:background={c}
					title={c}
					aria-label={c}
					onclick={() => onColor!(c)}
				></button>
			{/each}
		</div>

		<div class="lbl">{t('shell.chrome.icon')}</div>
		<div class="icons">
			<button
				class="ic"
				class:on={!icon}
				title={defaultIcon ? t('shell.chrome.defaultIcon') : t('shell.chrome.clearIcon')}
				aria-label={defaultIcon ? t('shell.chrome.defaultIcon') : t('shell.chrome.clearIcon')}
				onclick={() => onIcon!(null)}
			>
				{#if defaultIcon}{@render defaultIcon()}{:else}<BanIcon size={14} />{/if}
			</button>
			{#each PICKER_ICONS as id (id)}
				<button
					class="ic"
					class:on={icon?.kind === 'builtin' && icon.id === id}
					title={id}
					aria-label={id}
					onclick={() => onIcon!({ kind: 'builtin', id })}
				>
					<TabGlyph icon={{ kind: 'builtin', id }} size={14} />
				</button>
			{/each}
		</div>

		<button class="more" onclick={() => (custom = !custom)} aria-expanded={custom}>
			{#if custom}<ChevronDownIcon size={12} />{:else}<ChevronRightIcon size={12} />{/if}{t('shell.chrome.custom')}
		</button>
		<Collapse open={custom}>
		<label class="field">
			<span class="lbl">{t('shell.chrome.slug')}</span>
			<input
				class="txt mono"
				placeholder={t('shell.chrome.slugPlaceholder')}
				bind:value={slugVal}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						commitSlug();
					}
				}}
				onblur={commitSlug}
			/>
		</label>

		<label class="field">
			<span class="lbl">{t('shell.chrome.svg')}</span>
			<textarea
				class="txt mono"
				rows="2"
				placeholder={t('shell.chrome.svgPlaceholder')}
				bind:value={svgVal}
				onblur={commitSvg}
			></textarea>
			{#if svgError}<span class="err">{t('shell.chrome.svgInvalid')}</span>{/if}
		</label>
		</Collapse>
	</Collapse>
	{/if}

	{@render children?.()}

	{#if onPin}
		<Button size="sm" full onclick={() => onPin(!pinned)}>
			{#if pinned}<PinOffIcon size={12} />{t('shell.unpin')}{:else}<PinIcon size={12} />{t('shell.pin')}{/if}
		</Button>
	{/if}
	{#if onMove && moveTargets.length}
		<span class="move-label">{moveLabel ?? t('shell.chrome.moveTo')}</span>
		{#each moveTargets as w (w.id)}
			<Button size="sm" full onclick={() => onMove(w.id)}><ArrowRightLeftIcon size={12} />{w.name}</Button>
		{/each}
	{/if}
	{#if onCloseOthers}
		<Button size="sm" full onclick={onCloseOthers}>{t('shell.chrome.closeOthers')}</Button>
	{/if}
	{#if onCloseAll}
		<Button size="sm" full onclick={onCloseAll}>{t('shell.chrome.closeAll')}</Button>
	{/if}
	{#if onDelete}
		<Button variant="danger" size="sm" full onclick={onDelete}><TrashIcon size={12} />{deleteLabel || t('shell.chrome.delete')}</Button>
	{/if}
</div>

<style>
	.move-label {
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	/* Above a Modal (z-index 100): an agent's page opens it. */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 101;
		border: none;
		background: none;
		cursor: default;
	}
	.pop {
		position: fixed;
		z-index: 102;
		width: 248px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 11px;
		background: var(--panel);
		border-radius: var(--r);
		box-shadow: var(--shadow-pop);
		animation: drop-in var(--t-med) var(--ease-out);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.lbl {
		font-size: var(--fs-2xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--dim2);
	}
	.txt {
		width: 100%;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-sm);
		font-family: var(--font-sans);
		outline: none;
		resize: vertical;
	}
	.txt::placeholder {
		color: var(--dim2);
	}
	.txt:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.txt.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.err {
		font-size: var(--fs-2xs);
		color: var(--err);
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.swatch {
		width: 17px;
		height: 17px;
		border-radius: 50%;
		border: 1px solid transparent;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.swatch.on {
		box-shadow:
			0 0 0 1.5px var(--panel),
			0 0 0 3px var(--text);
	}
	.swatch.none {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--surface2);
		color: var(--dim);
		border-color: var(--hairline);
	}
	.icons {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 2px;
	}
	.ic {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px 0;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.ic:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.more {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		align-self: flex-start;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.more:hover {
		color: var(--text);
	}
	.ic.on {
		background: var(--accent-soft);
		color: var(--accent-bright);
	}
</style>
