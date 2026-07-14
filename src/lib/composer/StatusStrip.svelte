<script lang="ts">
	// A calm, collapsible strip for meta/status notices (retrying, compaction,
	// engine warnings, stderr, restart notices) — kept out of the conversation
	// bubble stream (T3 Code's "work log" idea). Collapsed by default: a muted pill
	// showing the latest notice + a count; click to expand the full list.
	import { Info, X, ChevronUp } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { t } from '$lib/i18n';

	let { items }: { items: string[] } = $props();
	let open = $state(false);

	const latest = $derived(items[items.length - 1] ?? '');
</script>

{#if items.length}
	<div class="strip">
		{#if open}
			<div class="panel" transition:slide={{ duration: 140 }}>
				<div class="phead">
					<span class="ptitle">{t('chat.statusTitle')} · {items.length}</span>
					<button class="pclose" onclick={() => (open = false)} aria-label="close"><X size={13} /></button>
				</div>
				<div class="plist">
					{#each items as it, i (i)}
						<div class="pitem">{it}</div>
					{/each}
				</div>
			</div>
		{/if}
		<button class="pill" class:on={open} onclick={() => (open = !open)} title={t('chat.statusTitle')}>
			<Info size={13} />
			<span class="ptext">{latest}</span>
			<span class="pcount">{items.length}</span>
			<span class="pchev" class:up={open}><ChevronUp size={13} /></span>
		</button>
	</div>
{/if}

<style>
	.strip {
		position: relative;
		display: flex;
		flex-direction: column;
		margin: 0 auto 8px;
		max-width: 880px;
		width: 100%;
		padding: 0 18px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		align-self: flex-start;
		max-width: 100%;
		padding: 4px 8px 4px 9px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface2);
		color: var(--dim);
		font-size: 12px;
		font-family: var(--font-sans);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}
	.pill:hover,
	.pill.on {
		background: var(--panel);
		color: var(--text);
	}
	.ptext {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono);
		font-size: 11.5px;
	}
	.pcount {
		flex-shrink: 0;
		padding: 0 6px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--dim) 22%, transparent);
		color: var(--text);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.pchev {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
		transition: transform 0.15s ease;
	}
	.pchev.up {
		transform: rotate(180deg);
	}
	.panel {
		margin-bottom: 6px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
	}
	.phead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px 8px 12px;
		border-bottom: 1px solid var(--hairline);
	}
	.ptitle {
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
	}
	.pclose {
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.pclose:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.plist {
		max-height: 200px;
		overflow-y: auto;
		padding: 4px 0;
	}
	.pitem {
		padding: 5px 12px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		color: var(--dim);
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: break-word;
	}
	.pitem + .pitem {
		border-top: 1px solid var(--hairline);
	}
</style>
