<script lang="ts">
	import { X, ChevronDown, ChevronUp, Search } from 'lucide-svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';

	let {
		value = $bindable(),
		inputEl = $bindable(),
		hitCount,
		activeIndex,
		onInput,
		onKey,
		onPrev,
		onNext,
		onClose
	}: {
		value: string;
		inputEl: HTMLInputElement | null;
		hitCount: number;
		activeIndex: number;
		onInput: () => void;
		onKey: (e: KeyboardEvent) => void;
		onPrev: () => void;
		onNext: () => void;
		onClose: () => void;
	} = $props();
</script>

<div class="findbar">
	<Search size={14} />
	<input bind:this={inputEl} bind:value oninput={onInput} onkeydown={onKey} placeholder={t('shell.findPlaceholder')} />
	<span class="findcount">{value.trim() ? (hitCount ? `${Math.min(activeIndex + 1, hitCount)}/${hitCount}` : t('shell.findNoResult')) : ''}</span>
	<IconButton size="sm" onclick={onPrev} label={t('shell.findPrev')} disabled={!hitCount}><ChevronUp size={15} /></IconButton>
	<IconButton size="sm" onclick={onNext} label={t('shell.findNext')} disabled={!hitCount}><ChevronDown size={15} /></IconButton>
	<IconButton size="sm" onclick={onClose} label={t('common.close')}><X size={15} /></IconButton>
</div>

<style>
	.findbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
		background: var(--panel);
	}
	.findbar input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 13.5px;
	}
	.findbar input::placeholder {
		color: var(--dim2);
	}
	.findcount {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--dim2);
		flex-shrink: 0;
		min-width: 36px;
		text-align: right;
	}
</style>
