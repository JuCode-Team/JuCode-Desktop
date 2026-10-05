<script lang="ts">
	import { convertFileSrc } from '@tauri-apps/api/core';

	// An image the user sent, by its path on the computer the engine runs on.
	// The desktop opens the file itself; the remote page has it read there
	// (`load`) and shows the data it gets back.
	let { path, load }: { path: string; load?: (path: string) => Promise<string> } = $props();

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
</script>

{#if src}
	<img {src} alt="" />
{:else}
	<span class="ph" class:failed title={path}></span>
{/if}

<style>
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
