<script lang="ts">
	import { History, ChevronRight } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import type { TurnDiff } from '$lib/chat.svelte';

	let {
		turns = [],
		onOpenFile
	}: {
		turns?: TurnDiff[];
		onOpenFile?: (path: string) => void;
	} = $props();

	// Turns start expanded (small lists); a manual toggle sticks per turn index.
	let collapsed = $state<Record<number, boolean>>({});
	const base = (p: string) => p.split('/').pop() || p;
</script>

<div class="turns">
	{#if turns.length === 0}
		<div class="empty">{t('dock.turns.empty')}</div>
	{:else}
		<div class="scroll">
			{#each turns as turn (turn.index)}
				<div class="turn">
					<button class="thead" onclick={() => (collapsed[turn.index] = !collapsed[turn.index])} aria-expanded={!collapsed[turn.index]}>
						<span class="chev" class:open={!collapsed[turn.index]}><ChevronRight size={13} /></span>
						<span class="tnum">{t('dock.turns.turnN', { n: turn.index + 1 })}</span>
						<span class="tprompt" title={turn.text}>{turn.text}</span>
						<span class="tstat">
							<span class="add">+{turn.added}</span><span class="del">−{turn.removed}</span>
						</span>
					</button>
					{#if !collapsed[turn.index]}
						<div class="files">
							{#each turn.files as f (f.path)}
								<button class="file" onclick={() => onOpenFile?.(f.path)} title={f.path}>
									<span class="fname">{base(f.path)}</span>
									<span class="fstat"><span class="add">+{f.added}</span><span class="del">−{f.removed}</span></span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<div class="foot"><History size={12} /> {t('dock.turns.foot', { n: turns.length })}</div>

<style>
	.turns {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}
	.empty {
		padding: 24px 18px;
		text-align: center;
		font-size: 12px;
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.turn {
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		margin-bottom: 6px;
		overflow: hidden;
		background: var(--surface);
	}
	.thead {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		padding: 7px 9px;
		border: none;
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}
	.chev {
		display: inline-flex;
		color: var(--dim);
		transition: transform 0.12s;
		flex-shrink: 0;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.tnum {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.tprompt {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tstat,
	.fstat {
		display: inline-flex;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 11px;
		flex-shrink: 0;
	}
	.add {
		color: var(--ok);
	}
	.del {
		color: var(--err);
	}
	.files {
		padding: 3px 6px 5px;
	}
	.file {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 4px 6px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		border-radius: var(--r-sm);
		text-align: left;
	}
	.file:hover {
		background: var(--surface2);
	}
	.fname {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-top: 1px solid var(--hairline);
		font-size: 11px;
		color: var(--dim2);
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
</style>
