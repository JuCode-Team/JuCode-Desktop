<script lang="ts">
	// One block of a settings page: a small heading (and optional gray line)
	// over a rounded card whose children are SettingsRows or a wide block.
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		id,
		action,
		children
	}: {
		title?: string;
		description?: string;
		/** Search anchor (element id `set-<id>`, see settings/nav.ts). */
		id?: string;
		/** Small control at the right of the heading (e.g. refresh). */
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="sec" id={id ? `set-${id}` : undefined}>
	{#if title || action}
		<div class="head">
			<div class="txt">
				{#if title}<h3>{title}</h3>{/if}
				{#if description}<p>{description}</p>{/if}
			</div>
			{#if action}{@render action()}{/if}
		</div>
	{/if}
	<div class="card">
		{@render children()}
	</div>
</section>

<style>
	.sec {
		margin-top: 28px;
		scroll-margin: 24px;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		margin: 0 2px 10px;
	}
	.txt {
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
	}
	p {
		margin: 3px 0 0;
		max-width: 64ch;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.card {
		background: var(--panel);
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
	}
	/* Light theme: --panel is the page's white; a faint fill lifts the card. */
	:global([data-theme='light']) .card {
		background: var(--surface);
		border-color: var(--border);
	}
	/* No overflow clip (a Select's menu must escape the card): the end
	   children take the card's corners so hover fills stay inside. */
	.card > :global(:first-child) {
		border-top-left-radius: inherit;
		border-top-right-radius: inherit;
	}
	.card > :global(:last-child) {
		border-bottom-left-radius: inherit;
		border-bottom-right-radius: inherit;
	}
	/* Rows, and any direct wide block, are divided by hairlines (doubled class:
	   wins over a child's own `border: none`). */
	.card.card > :global(* + *) {
		border-top: 1px solid var(--hairline);
	}
	/* Search hit: SettingsPage adds .flash for a moment after scrolling here. */
	.sec:global(.flash) .card {
		animation: flash 1.6s var(--ease-out);
	}
	@keyframes flash {
		0%,
		40% {
			box-shadow: 0 0 0 3px var(--accent-soft);
		}
		100% {
			box-shadow: 0 0 0 3px transparent;
		}
	}
</style>
