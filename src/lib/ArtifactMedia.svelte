<script lang="ts">
	// An image or a video the agent presented, shown in the reply. The desktop
	// reads the file itself; the remote page has it read on the computer
	// (`load`, a data URL), a video only when asked, since one can be large.
	// Nothing shows when it cannot be read: the file's card still does.
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { onDestroy } from 'svelte';
	import PlayIcon from '@lucide/svelte/icons/play';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { t } from '$lib/i18n';

	let {
		path,
		video,
		load,
		group = [path]
	}: {
		path: string;
		video: boolean;
		load?: (path: string) => Promise<string>;
		/** The reply's presented images, for the full-size view's ← →. */
		group?: string[];
	} = $props();

	let loaded = $state('');
	let failed = $state(false);
	let fetching = $state(false);
	$effect(() => {
		if (!load || video) return;
		const p = path;
		loaded = '';
		failed = false;
		load(p).then(
			(src) => p === path && (loaded = src),
			() => p === path && (failed = true)
		);
	});
	// A fetched video plays from a blob, which goes with the component.
	$effect(() => {
		const url = loaded;
		return () => {
			if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		};
	});
	const src = $derived(load ? loaded : convertFileSrc(path));

	let gone = false;
	onDestroy(() => (gone = true));
	async function fetchVideo() {
		fetching = true;
		try {
			const blob = await (await fetch(await load!(path))).blob();
			if (!gone) loaded = URL.createObjectURL(blob);
		} catch {
			failed = true;
		} finally {
			fetching = false;
		}
	}

	function open() {
		imageViewer.open(
			group.map((p) => ({ path: p, load })),
			Math.max(group.indexOf(path), 0)
		);
	}
</script>

{#if !failed}
	{#if video}
		{#if src}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video class="media" {src} controls preload="metadata" onerror={() => (failed = true)}></video>
		{:else}
			<button class="media ph" onclick={fetchVideo} disabled={fetching} aria-label={t('common.video.play')} title={t('common.video.play')}>
				{#if fetching}<LoaderCircleIcon size={20} class="spin" />{:else}<PlayIcon size={20} />{/if}
			</button>
		{/if}
	{:else if src}
		<button class="shot" onclick={open} aria-label={t('common.image.open')} title={t('common.image.open')}>
			<img class="media" {src} alt="" onerror={() => (failed = true)} />
		</button>
	{:else}
		<span class="media ph"></span>
	{/if}
{/if}

<style>
	.media {
		display: block;
		max-width: 100%;
		max-height: 280px;
		border-radius: var(--r);
		border: 1px solid var(--hairline);
		background: var(--surface2);
	}
	img.media {
		object-fit: contain;
	}
	.shot {
		display: block;
		padding: 0;
		border: none;
		background: none;
		cursor: zoom-in;
	}
	.shot:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-radius: var(--r);
	}
	.ph {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 240px;
		height: 135px;
		color: var(--dim);
	}
	button.ph {
		cursor: pointer;
	}
	button.ph:hover:not(:disabled) {
		color: var(--text);
	}
</style>
