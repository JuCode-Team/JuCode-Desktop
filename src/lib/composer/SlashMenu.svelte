<script lang="ts">
	import { t } from '$lib/i18n';

	interface Cmd {
		command: string;
		args?: string | null;
		description?: string | null;
		marker?: string | null;
	}

	// Selection/keyboard nav lives in the parent (on the textarea); this only
	// renders the listbox. The `composer-menu` / `cmp-opt-{i}` ids are kept so the
	// textarea's aria-controls / aria-activedescendant wiring stays intact.
	let {
		matches,
		selected,
		onSelect,
		onHover
	}: {
		matches: Cmd[];
		selected: number;
		onSelect: (c: Cmd) => void;
		onHover: (i: number) => void;
	} = $props();
</script>

<div class="slash" id="composer-menu" role="listbox" aria-label={t('chat.slashMenuLabel')}>
	{#each matches as c, i (c.command)}
		<button class="slash-item" id="cmp-opt-{i}" role="option" aria-selected={i === selected} class:sel={i === selected} onclick={() => onSelect(c)} onmouseenter={() => onHover(i)}>
			<span class="slash-cmd">{c.command}</span>
			{#if c.args}<span class="slash-args">{c.args}</span>{/if}
			{#if c.description}<span class="slash-desc">{c.description}</span>{/if}
			{#if c.marker}<span class="slash-marker">{c.marker}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.slash {
		margin-bottom: 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		overflow: hidden;
		box-shadow: var(--shadow-pop);
	}
	.slash-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.slash-item.sel {
		background: var(--surface2);
	}
	.slash-cmd {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.slash-args {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.slash-desc {
		flex: 1;
		color: var(--dim);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.slash-marker {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--accent-bright);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: 4px;
		padding: 1px 5px;
	}
</style>
