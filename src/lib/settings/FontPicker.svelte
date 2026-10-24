<script lang="ts">
	// A font, picked by name among those installed here (systemFonts), as
	// t3code's picker: a search box over the list, each family shown in its
	// own face, the generic choices first; code and terminal fonts only from
	// the fixed-width families. A saved family no longer installed still
	// shows, as the current choice.
	import { tick } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { overBrowser } from '$lib/browser.svelte';
	import { popOut } from '$lib/ui/motion';
	import { t } from '$lib/i18n';
	import { systemFonts } from '$lib/systemFonts.svelte';

	let {
		value,
		generic,
		mono = false,
		onChange
	}: {
		/** The current choice: a generic id or a family name. */
		value: string;
		/** The choices that are no family, with their labels. */
		generic: { id: string; label: string }[];
		/** Fixed-width families only. */
		mono?: boolean;
		onChange: (id: string) => void;
	} = $props();

	/** Families shown at most at once: the search narrows the rest. */
	const SHOWN = 200;

	let open = $state(false);
	let query = $state('');
	let searchEl = $state<HTMLInputElement | null>(null);
	const families = $derived(systemFonts.list.filter((f) => !mono || f.mono).map((f) => f.family));
	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? families.filter((f) => f.toLowerCase().includes(q)) : families;
	});
	const label = $derived(generic.find((g) => g.id === value)?.label ?? value);
	const isFamily = $derived(!generic.some((g) => g.id === value));

	function toggle() {
		open = !open;
		if (!open) return;
		systemFonts.load();
		query = '';
		tick().then(() => searchEl?.focus());
	}
	function pick(id: string) {
		open = false;
		if (id !== value) onChange(id);
	}
	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			open = false;
		} else if (e.key === 'Enter' && matches.length) {
			e.preventDefault();
			pick(matches[0]!);
		}
	}
</script>

<div class="picker">
	<button type="button" class="trigger" class:open onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
		<span class="cur" style:font-family={isFamily ? `'${value}'` : undefined}>{label}</span>
		<span class="chev" class:up={open}><ChevronDownIcon size={16} /></span>
	</button>
	{#if open}
		<button class="backdrop" aria-label="close" onclick={() => (open = false)}></button>
		<div use:overBrowser class="menu" out:popOut={{ y: 3 }}>
			<label class="search">
				<SearchIcon size={14} />
				<input bind:this={searchEl} bind:value={query} placeholder={t('settings.font.search')} onkeydown={key} />
			</label>
			<div class="list" role="listbox">
				{#if !query.trim()}
					{#each generic as g (g.id)}
						<button class="opt" class:on={g.id === value} role="option" aria-selected={g.id === value} onclick={() => pick(g.id)}>
							<span class="name">{g.label}</span>
							{#if g.id === value}<CheckIcon size={14} />{/if}
						</button>
					{/each}
					{#if isFamily && !families.includes(value)}
						<button class="opt on" role="option" aria-selected="true" onclick={() => pick(value)}>
							<span class="name">{value}</span>
							<span class="gone">{t('settings.font.missing')}</span>
						</button>
					{/if}
					<div class="sep"></div>
				{/if}
				{#each matches.slice(0, SHOWN) as f (f)}
					<button class="opt" class:on={f === value} role="option" aria-selected={f === value} onclick={() => pick(f)}>
						<span class="name" style:font-family="'{f}'">{f}</span>
						{#if f === value}<CheckIcon size={14} />{/if}
					</button>
				{/each}
				{#if matches.length > SHOWN}
					<div class="more">{t('settings.font.more', { n: matches.length - SHOWN })}</div>
				{:else if !matches.length}
					<div class="more">{systemFonts.list.length ? t('settings.font.none') : t('settings.font.loading')}</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		width: 100%;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 9px 11px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r);
		color: var(--text);
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.trigger:hover,
	.trigger.open {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.cur {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chev {
		display: inline-flex;
		color: var(--dim);
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 30;
		border: none;
		background: none;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 5px);
		right: 0;
		z-index: 31;
		width: max(100%, 280px);
		padding: 5px;
		border-radius: var(--r);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		transform-origin: top right;
		animation: pop-in var(--t-med) var(--ease-out);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
		padding: 6px 9px;
		border-radius: var(--r);
		background: var(--surface2);
		color: var(--dim);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.list {
		max-height: 300px;
		overflow-y: auto;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 9px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.opt:hover {
		background: var(--surface2);
	}
	.opt.on {
		background: var(--accent-soft);
	}
	.opt :global(svg) {
		flex-shrink: 0;
		color: var(--accent-bright);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.gone {
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--hairline);
	}
	.more {
		padding: 8px 9px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
</style>
