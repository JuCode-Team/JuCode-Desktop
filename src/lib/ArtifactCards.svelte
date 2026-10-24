<script lang="ts">
	// The deliverables the agent presented (`present_files`), as cards: a
	// click opens the file, the folder button shows it in the file manager,
	// a right-click offers the chat's file menu (data-file). Images and
	// videos show above their cards.
	import FileIcon from '@lucide/svelte/icons/file';
	import FilePlayIcon from '@lucide/svelte/icons/file-play';
	import FileImageIcon from '@lucide/svelte/icons/file-image';
	import FileMusicIcon from '@lucide/svelte/icons/file-music';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import PresentationIcon from '@lucide/svelte/icons/presentation';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import IconButton from '$lib/ui/IconButton.svelte';
	import ArtifactMedia from '$lib/ArtifactMedia.svelte';
	import { isTauri } from '@tauri-apps/api/core';
	import { pathExt } from '$lib/fileRefs';
	import { isMac } from '$lib/shortcuts';
	import type { Artifact } from '$lib/turnSummary';
	import { t } from '$lib/i18n';

	let {
		files,
		onOpen,
		onReveal,
		load
	}: {
		files: Artifact[];
		onOpen?: (path: string) => void;
		/** Absent where the file manager can't be reached (the remote page). */
		onReveal?: (path: string) => void;
		/** Reads a file on the engine's computer (the remote page). */
		load?: (path: string) => Promise<string>;
	} = $props();

	const KINDS: [RegExp, typeof FileIcon][] = [
		[/^(mp4|mov|m4v|webm|mkv|avi)$/, FilePlayIcon],
		[/^(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/, FileImageIcon],
		[/^(mp3|wav|m4a|aac|flac|ogg)$/, FileMusicIcon],
		[/^(html?)$/, GlobeIcon],
		[/^(pptx?|key)$/, PresentationIcon],
		[/^(xlsx?|csv|tsv|numbers)$/, FileSpreadsheetIcon],
		[/^(pdf|docx?|md|txt|rtf|pages)$/, FileTextIcon],
		[/^(zip|tar|gz|tgz|7z|rar|dmg|pkg|apk|ipa|exe|msi|deb|appimage)$/, FileArchiveIcon],
		[/^(json|ya?ml|toml|xml|js|ts|py|rs|go|sh)$/, FileCodeIcon]
	];
	const iconOf = (path: string) => KINDS.find(([re]) => re.test(pathExt(path)))?.[1] ?? FileIcon;
	/** The kinds both the webview and the daemon's `fs_image` take. */
	const IMAGE = /^(png|jpe?g|gif|webp)$/;
	const VIDEO = /^(mp4|m4v|webm|mov)$/;
	const images = $derived(files.filter((f) => IMAGE.test(pathExt(f.path))).map((f) => f.path));
	const media = $derived(files.filter((f) => IMAGE.test(pathExt(f.path)) || VIDEO.test(pathExt(f.path))));
	const nameOf = (path: string) => path.split(/[\\/]/).pop() || path;
	const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
	const revealLabel = isMac() ? 'chat.fileMenu.revealMac' : /Windows/.test(navigator.userAgent) ? 'chat.fileMenu.revealWin' : 'chat.fileMenu.revealLinux';
</script>

<!-- Read by the desktop, or through `load`; elsewhere (a phone subagent's
     transcript) only the cards show. -->
{#if media.length && (load || isTauri())}
	<div class="media">
		{#each media as f (f.path)}
			<ArtifactMedia path={f.path} video={VIDEO.test(pathExt(f.path))} {load} group={images} />
		{/each}
	</div>
{/if}
<div class="artifacts" class:single={files.length === 1}>
	{#each files as f (f.path)}
		{@const Icon = iconOf(f.path)}
		<div class="card" data-file={f.path} title={f.path}>
			<button class="open" onclick={() => onOpen?.(f.path)}>
				<span class="icon"><Icon size={18} /></span>
				<span class="text">
					<span class="name">{nameOf(f.path)}</span>
					<span class="desc">{f.description || size(f.size)}</span>
				</span>
			</button>
			{#if onReveal}
				<IconButton size="sm" title={t(revealLabel)} onclick={() => onReveal(f.path)}><FolderOpenIcon size={15} /></IconButton>
			{/if}
		</div>
	{/each}
</div>

<style>
	.media {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}
	.artifacts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		margin-top: 12px;
	}
	.artifacts.single {
		grid-template-columns: minmax(0, 1fr);
		max-width: calc(50% - 4px);
	}
	.card {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-right: 8px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.card:hover {
		border-color: var(--border-strong);
	}
	.open {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 12px;
		padding: 12px 4px 12px 12px;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.icon {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: var(--panel);
		border: 1px solid var(--hairline);
		color: var(--dim);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name,
	.desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name {
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.desc {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	@media (max-width: 560px) {
		.artifacts,
		.artifacts.single {
			grid-template-columns: minmax(0, 1fr);
			max-width: none;
		}
	}
</style>
