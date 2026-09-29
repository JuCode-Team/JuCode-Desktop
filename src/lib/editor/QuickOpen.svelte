<script lang="ts">
	import { onMount } from 'svelte';
	import { Search, FileText } from 'lucide-svelte';
	import { listFiles } from '$lib/protocol';
	import { fuzzyScore } from '$lib/mention';
	import Modal from '$lib/ui/Modal.svelte';
	import { t } from '$lib/i18n';

	let { root, onOpen, onClose }: { root: string; onOpen: (rel: string) => void; onClose: () => void } = $props();

	let files = $state<string[]>([]);
	let query = $state('');
	let selIdx = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	onMount(() => {
		listFiles(root)
			.then((f) => (files = f))
			.catch(() => {});
		inputEl?.focus();
	});

	const baseName = (p: string) => p.split('/').pop() || p;

	// Same ranking as @-mention: fuzzy on the path, doubled on the basename.
	// Bounded top-K so a huge index stays snappy per keystroke.
	const LIMIT = 50;
	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return files.slice(0, LIMIT);
		const top: { p: string; s: number }[] = [];
		for (const p of files) {
			const s = Math.max(fuzzyScore(p, q), fuzzyScore(baseName(p), q) * 2);
			if (s <= 0) continue;
			top.push({ p, s });
		}
		return top
			.sort((a, b) => b.s - a.s || a.p.length - b.p.length)
			.slice(0, LIMIT)
			.map((x) => x.p);
	});
	$effect(() => {
		matches;
		selIdx = 0;
	});

	function key(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selIdx = Math.min(selIdx + 1, matches.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selIdx = Math.max(selIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const m = matches[selIdx];
			if (m) onOpen(m);
		}
	}
</script>

<Modal label={t('editor.quickOpenPlaceholder')} width={560} placement="top" padded={false} {onClose}>
	<div class="qhead">
		<Search size={15} class="qico" />
		<input bind:this={inputEl} bind:value={query} placeholder={t('editor.quickOpenPlaceholder')} onkeydown={key} />
	</div>
	<div class="qlist">
		{#each matches as m, i (m)}
			<button class="qrow" class:sel={i === selIdx} onclick={() => onOpen(m)} onpointerenter={() => (selIdx = i)}>
				<FileText size={14} />
				<span class="qname">{baseName(m)}</span>
				<span class="qdir">{m}</span>
			</button>
		{/each}
		{#if matches.length === 0}
			<div class="qempty">{t('editor.quickOpenEmpty')}</div>
		{/if}
	</div>
</Modal>

<style>
	.qhead {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.qhead :global(.qico) {
		color: var(--dim2);
		flex-shrink: 0;
	}
	.qhead input {
		flex: 1;
		border: none;
		background: none;
		color: var(--text);
		font-size: var(--fs-md);
		outline: none;
	}
	.qlist {
		max-height: calc(60vh - 50px);
		overflow-y: auto;
		padding: 6px;
	}
	.qrow {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 7px 9px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		font-size: var(--fs-sm);
	}
	.qrow.sel {
		background: var(--surface2);
		color: var(--text);
	}
	.qname {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		flex-shrink: 0;
	}
	.qdir {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.qempty {
		padding: 18px;
		text-align: center;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
</style>
