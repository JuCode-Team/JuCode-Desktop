<script lang="ts">
	// The sessions a turn started (`start_session`): a row each, which opens
	// the session.
	import BotIcon from '@lucide/svelte/icons/bot';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { BACKEND_LABELS, type BackendId } from '$lib/backends/types';
	import type { ChildSession } from '$lib/turnSummary';

	let { sessions, onOpen }: { sessions: ChildSession[]; onOpen?: (session: string) => void } = $props();
</script>

<div class="children">
	{#each sessions as s (s.session)}
		<button class="row" disabled={!onOpen} onclick={() => onOpen?.(s.session)}>
			<BotIcon size={14} />
			<span class="engine">{BACKEND_LABELS[s.engine as BackendId] ?? s.engine}</span>
			<span class="title">{s.title}</span>
			{#if onOpen}<span class="go"><ChevronRightIcon size={14} /></span>{/if}
		</button>
	{/each}
</div>

<style>
	.children {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 10px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 34px;
		padding: 4px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
		color: var(--dim);
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.row:hover:not(:disabled) {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.row:disabled {
		cursor: default;
	}
	.engine {
		flex-shrink: 0;
		font-weight: 500;
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.go {
		display: inline-flex;
		color: var(--dim2);
	}
</style>
