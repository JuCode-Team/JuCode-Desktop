<script lang="ts">
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { t } from '$lib/i18n';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';

	// An image the user sent, by its path on the computer the engine runs on.
	// The desktop opens the file itself; the remote page has it read there
	// (`load`) and shows the data it gets back. A click shows it full size,
	// with the other images of its message (`group`) a step away.
	let {
		path,
		load,
		group = [path]
	}: { path: string; load?: (path: string) => Promise<string>; group?: string[] } = $props();

	let loaded = $state('');
	let failed = $state(false);
	$effect(() => {
		if (!load) return;
		const p = path;
		loaded = '';
		failed = false;
		load(p).then(
			(src) => p === path && (loaded = src),
			() => p === path && (failed = true)
		);
	});
	const src = $derived(load ? loaded : convertFileSrc(path));

	function open() {
		imageViewer.open(
			group.map((p) => ({ path: p, load })),
			Math.max(group.indexOf(path), 0)
		);
	}
</script>

{#if src && !failed}
	<button class="uimg" onclick={open} aria-label={t('common.image.open')} title={t('common.image.open')}>
		<img {src} alt="" onerror={() => (failed = true)} />
	</button>
{:else}
	<span class="ph" class:failed title={failed ? `${t('common.image.failed')}\n${path}` : path}></span>
{/if}

<style>
	.uimg {
		display: block;
		padding: 0;
		border: none;
		border-radius: var(--r-md);
		background: none;
		cursor: zoom-in;
	}
	.uimg:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	img,
	.ph {
		display: block;
		max-width: 220px;
		max-height: 160px;
		border-radius: var(--r-md);
		object-fit: cover;
	}
	.ph {
		width: 96px;
		height: 72px;
		background: var(--surface2);
	}
	.ph.failed {
		opacity: 0.5;
	}
</style>
