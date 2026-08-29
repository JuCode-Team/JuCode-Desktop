<script lang="ts">
	import { tick } from 'svelte';
	import { Ban, Trash2 } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import { BUILTIN_ICONS, parseTabIcon, sanitizeSvg, TAB_COLORS, type TabIcon } from './tabChrome';
	import TabGlyph from './TabGlyph.svelte';

	// Shared chrome editor for workspace tabs and session tabs: rename, tag
	// color, and icon (builtin grid / slug / pasted SVG). Fixed-position at the
	// invoking pointer/anchor, clamped to the viewport.
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
		onClose
	}: {
		x: number;
		y: number;
		name: string;
		color?: string | null;
		icon?: TabIcon | null;
		onRename: (name: string) => void;
		onColor: (color: string | null) => void;
		onIcon: (icon: TabIcon | null) => void;
		onDelete?: () => void;
		deleteLabel?: string;
		onClose: () => void;
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
		if (v && v !== name) onRename(v);
	}
	function commitSlug() {
		const parsed = parseTabIcon({ kind: 'slug', value: slugVal });
		if (parsed) onIcon(parsed);
	}
	function commitSvg() {
		if (!svgVal.trim()) return;
		const clean = sanitizeSvg(svgVal);
		svgError = !clean;
		if (clean) onIcon({ kind: 'svg', markup: clean });
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
	class="pop"
	role="dialog"
	aria-label={t('shell.chrome.title')}
	bind:clientWidth={popW}
	bind:clientHeight={popH}
	style:left="{left}px"
	style:top="{top}px"
>
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

	<div class="lbl">{t('shell.chrome.color')}</div>
	<div class="swatches">
		<button
			class="swatch none"
			class:on={!color}
			title={t('shell.chrome.noColor')}
			aria-label={t('shell.chrome.noColor')}
			onclick={() => onColor(null)}><Ban size={11} /></button
		>
		{#each TAB_COLORS as c (c)}
			<button
				class="swatch"
				class:on={color === c}
				style:background={c}
				title={c}
				aria-label={c}
				onclick={() => onColor(c)}
			></button>
		{/each}
	</div>

	<div class="lbl">{t('shell.chrome.icon')}</div>
	<div class="icons">
		{#each BUILTIN_ICONS as id (id)}
			<button
				class="ic"
				class:on={icon?.kind === 'builtin' && icon.id === id}
				title={id}
				aria-label={id}
				onclick={() => onIcon({ kind: 'builtin', id })}
			>
				<TabGlyph icon={{ kind: 'builtin', id }} size={14} />
			</button>
		{/each}
		<button class="ic" class:on={!icon} title={t('shell.chrome.clearIcon')} aria-label={t('shell.chrome.clearIcon')} onclick={() => onIcon(null)}>
			<Ban size={13} />
		</button>
	</div>

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

	{#if onDelete}
		<button class="del" onclick={onDelete}><Trash2 size={12} />{deleteLabel || t('shell.chrome.delete')}</button>
	{/if}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		border: none;
		background: none;
		cursor: default;
	}
	.pop {
		position: fixed;
		z-index: 91;
		width: 248px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 11px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.lbl {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--dim2);
	}
	.txt {
		width: 100%;
		padding: 6px 8px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--text);
		font-size: 12.5px;
		font-family: var(--font-sans);
		outline: none;
		resize: vertical;
	}
	.txt:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--hairline));
	}
	.txt.mono {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.err {
		font-size: 11px;
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
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
	}
	.ic {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.ic:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.ic.on {
		background: var(--accent-soft);
		color: var(--accent-bright);
	}
	.del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		margin-top: 2px;
		padding: 6px 0;
		border: 1px solid color-mix(in oklab, var(--err) 35%, transparent);
		border-radius: var(--r-sm);
		background: none;
		color: var(--err);
		font-size: 12px;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.del:hover {
		background: color-mix(in oklab, var(--err) 12%, transparent);
	}
</style>
