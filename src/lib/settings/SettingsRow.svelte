<script lang="ts">
	// One setting inside a SettingsSection card: title and gray description on
	// the left, the control on the right. `stacked` puts wide content (a list,
	// a form, a heatmap) under the text instead. `id` is the search anchor
	// (element id `set-<id>`, see settings/nav.ts).
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		id,
		stacked = false,
		detail,
		children
	}: {
		title?: string;
		description?: string;
		id?: string;
		stacked?: boolean;
		/** Extra lines under the description (status, errors). */
		detail?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div class="row" class:stacked id={id ? `set-${id}` : undefined}>
	{#if title || description || detail}
		<div class="txt">
			{#if title}<div class="title">{title}</div>{/if}
			{#if description}<div class="desc">{description}</div>{/if}
			{#if detail}{@render detail()}{/if}
		</div>
	{/if}
	{#if children}
		<div class="ctl">{@render children()}</div>
	{/if}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		min-height: 60px;
		padding: 14px 18px;
		scroll-margin: 24px;
	}
	.row.stacked {
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		gap: 12px;
	}
	.txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text);
	}
	.desc {
		max-width: 60ch;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.ctl {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		min-width: 0;
	}
	.stacked .ctl {
		display: block;
	}
	/* Search hit: SettingsPage adds .flash for a moment after scrolling here. */
	.row:global(.flash) {
		animation: flash 1.6s var(--ease-out);
	}
	@keyframes flash {
		0%,
		40% {
			background: var(--accent-soft);
		}
		100% {
			background: transparent;
		}
	}
</style>
