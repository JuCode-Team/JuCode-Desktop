<script lang="ts">
	import { untrack, type Snippet } from 'svelte';

	// Expand and collapse by grid rows (0fr ↔ 1fr), as hark.com does: the
	// height follows the content without measuring it, on the shared size
	// token. The content stays mounted only while open or closing.
	let { open, children }: { open: boolean; children: Snippet } = $props();

	// Mounted from the first open until the closing transition ends.
	let mounted = $state(untrack(() => open));
	let shown = $state(untrack(() => open));
	// Fully open: the content may reach past the edges (a highlight's ring,
	// a focus outline); while it moves it is clipped to the height.
	let settled = $state(untrack(() => open));
	$effect(() => {
		if (open) {
			mounted = true;
			if (untrack(() => shown)) return;
			// One frame at 0fr first, so the opening transitions.
			const raf = requestAnimationFrame(() => (shown = true));
			const done = setTimeout(() => (settled = true), 400);
			return () => {
				cancelAnimationFrame(raf);
				clearTimeout(done);
			};
		}
		shown = false;
		settled = false;
		// No transitionend under reduced motion or a window resize: unmount anyway.
		const done = setTimeout(() => (mounted = false), 400);
		return () => clearTimeout(done);
	});
</script>

{#if mounted}
	<div
		class="collapse"
		class:open={shown}
		inert={!open}
		class:settled
		ontransitionend={(e) => e.target === e.currentTarget && (open ? (settled = true) : (mounted = false))}
	>
		<div class="inner">{@render children()}</div>
	</div>
{/if}

<style>
	.collapse {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows var(--t-med) var(--ease-out),
			opacity var(--t-med) var(--ease-out);
	}
	.collapse.open {
		grid-template-rows: 1fr;
		opacity: 1;
	}
	.inner {
		min-height: 0;
		overflow: hidden;
	}
	.settled > .inner {
		overflow: visible;
	}
	@media (prefers-reduced-motion: reduce) {
		.collapse {
			transition: none;
		}
	}
</style>
