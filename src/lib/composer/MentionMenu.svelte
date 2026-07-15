<script lang="ts">
	import { File, Folder } from 'lucide-svelte';
	import { fuzzyPositions, type AtEntry } from '$lib/mention';
	import { t } from '$lib/i18n';

	// @-mention completion list. Selection/keyboard nav lives in the parent; the
	// `composer-menu` / `cmp-opt-{i}` ids are preserved for the textarea's aria wiring.
	let {
		matches,
		query,
		selected,
		onSelect,
		onHover
	}: {
		matches: AtEntry[];
		query: string | null;
		selected: number;
		onSelect: (e: AtEntry) => void;
		onHover: (i: number) => void;
	} = $props();

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

	// Split a label into matched/unmatched segments for highlighting (fuzzy mode
	// only — root/drill queries aren't a meaningful highlight).
	function hlSegments(text: string, q: string | null) {
		if (!q || q === '' || q.endsWith('/')) return [{ text, hit: false }];
		const pos = fuzzyPositions(text, q);
		if (!pos || pos.length === 0) return [{ text, hit: false }];
		const set = new Set(pos);
		const segs: { text: string; hit: boolean }[] = [];
		for (let i = 0; i < text.length; i++) {
			const hit = set.has(i);
			const last = segs[segs.length - 1];
			if (last && last.hit === hit) last.text += text[i];
			else segs.push({ text: text[i], hit });
		}
		return segs;
	}
</script>

<div class="slash" id="composer-menu" role="listbox" aria-label={t('chat.atMenuLabel')}>
	{#each matches as e, i (e.path)}
		<button class="slash-item" id="cmp-opt-{i}" role="option" aria-selected={i === selected} class:sel={i === selected} onclick={() => onSelect(e)} onmouseenter={() => onHover(i)}>
			{#if e.dir}<Folder size={13} class="atfolder" />{:else}<File size={13} />{/if}
			<span class="at-name">{#each hlSegments(base(e.path), query) as seg}{#if seg.hit}<b class="hl">{seg.text}</b>{:else}{seg.text}{/if}{/each}{#if e.dir}/{/if}</span>
			<span class="at-path">{e.path}</span>
		</button>
	{/each}
	{#if matches.length === 0 && query}<div class="slash-empty">{t('chat.noMatchingFiles')}</div>{/if}
</div>

<style>
	.slash {
		margin-bottom: 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		overflow: hidden;
		box-shadow: var(--shadow-pop);
		transform-origin: bottom center;
		animation: pop-in var(--t-med) var(--ease-spring);
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
		transition: background var(--t-fast) var(--ease-out);
	}
	.slash-item.sel {
		background: var(--accent-soft);
	}
	.at-name {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.at-name .hl {
		color: var(--accent-bright);
		font-weight: 700;
	}
	:global(.atfolder) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.at-path {
		flex: 1;
		color: var(--dim2);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: right;
	}
	.slash-empty {
		padding: 10px 12px;
		font-size: 12.5px;
		color: var(--dim2);
	}
</style>
