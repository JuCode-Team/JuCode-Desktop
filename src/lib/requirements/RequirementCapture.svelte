<script lang="ts">
	// Noting an idea: a line of words (Enter notes it, Shift+Enter breaks the
	// line), screenshots pasted, dropped or picked, and its project (the
	// default one unless the user picks another, or none).
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { MAX_IMAGES, useRequirements } from '$lib/requirements.svelte';
	import { sendFile } from '$lib/upload';
	import { daemon } from '$lib/protocol';
	import { telemetry } from '$lib/telemetry.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import ProjectPick from './ProjectPick.svelte';
	import { t } from '$lib/i18n';

	let {
		focusSignal = 0,
		project = '',
		projects = [],
		onNoted
	}: {
		focusSignal?: number;
		/** The default project's id ('' for none). */
		project?: string;
		projects?: { id: string; name: string }[];
		onNoted?: (id: string) => void;
	} = $props();

	const reqs = useRequirements();
	// Unsent words survive leaving the page, like a composer's.
	let text = $state(loadComposerText('requirement-capture'));
	$effect(() => saveComposerText('requirement-capture', text));
	/** Screenshots to note, with their previews. */
	let images = $state<{ file: File; url: string }[]>([]);
	let busy = $state(false);
	/** The user's pick; null follows the default. */
	let picked = $state<string | null>(null);
	const target = $derived(picked ?? project);
	let field = $state<HTMLTextAreaElement | null>(null);
	let picker = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (focusSignal) field?.focus();
	});
	$effect(() => {
		void text;
		autosize();
	});

	function autosize() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	}

	async function addFiles(files: Iterable<File>) {
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			if (images.length >= MAX_IMAGES) {
				toast.warn(t('shell.requirement.tooManyImages', { n: MAX_IMAGES }));
				return;
			}
			images.push({ file, url: URL.createObjectURL(file) });
		}
	}

	function onPaste(e: ClipboardEvent) {
		const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
		if (!files.length) return;
		e.preventDefault();
		void addFiles(files);
	}

	async function note() {
		const words = text.trim();
		if (!words || busy) return;
		busy = true;
		try {
			const paths = [];
			for (const image of images) paths.push((await sendFile(daemon, image.file)).path);
			const r = await reqs.create({ text: words, images: paths, source: 'desktop', project: target || null });
			telemetry.track('requirement_create');
			text = '';
			for (const image of images) URL.revokeObjectURL(image.url);
			images = [];
			onNoted?.(r.id);
		} catch (e) {
			toast.error(String(e));
		} finally {
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void note();
		}
	}
</script>

<div
	class="capture"
	role="group"
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		void addFiles(e.dataTransfer?.files ?? []);
	}}
>
	<PlusIcon size={16} class="lead" />
	<div class="body">
		<textarea
			rows="1"
			bind:this={field}
			bind:value={text}
			placeholder={t('shell.requirement.capture')}
			title={t('shell.requirement.captureHint')}
			onkeydown={onKey}
			onpaste={onPaste}
		></textarea>
		{#if images.length}
			<div class="shots">
				{#each images as image, i (image.url)}
					<span class="shot">
						<img src={image.url} alt="" />
						<button aria-label={t('shell.requirement.removeImage')} onclick={() => URL.revokeObjectURL(images.splice(i, 1)[0].url)}><XIcon size={11} /></button>
					</span>
				{/each}
			</div>
		{/if}
	</div>
	{#if projects.length}
		<span class="where"><ProjectPick value={target} {projects} placement="down-left" onChange={(p) => (picked = p)} /></span>
	{/if}
	<button class="icon" title={t('shell.requirement.addImage')} aria-label={t('shell.requirement.addImage')} onclick={() => picker?.click()}>
		<ImageIcon size={17} />
	</button>
	<input
		bind:this={picker}
		type="file"
		accept="image/*"
		multiple
		hidden
		onchange={(e) => {
			const input = e.currentTarget;
			void addFiles(input.files ?? []).then(() => (input.value = ''));
		}}
	/>
	<button class="add" disabled={!text.trim() || busy} onclick={note}>{t('shell.requirement.add')}</button>
</div>

<style>
	.capture {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 9px 10px 9px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-lg);
		background: var(--surface);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.capture:focus-within {
		border-color: var(--text);
	}
	.capture :global(.lead) {
		flex: none;
		margin-top: 6px;
		color: var(--dim2);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 28px;
		max-height: 30vh;
		padding: 4px 0;
		border: none;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 1.5;
		resize: none;
		outline: none;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	.shots {
		display: flex;
		gap: 8px;
		padding: 6px 0 2px;
	}
	.shot {
		position: relative;
		width: 72px;
		height: 48px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.shot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.shot button {
		position: absolute;
		top: 2px;
		right: 2px;
		display: inline-flex;
		padding: 2px;
		border: none;
		border-radius: var(--r-full);
		background: color-mix(in oklab, var(--bg) 80%, transparent);
		color: var(--text);
		cursor: pointer;
	}
	.where {
		flex: none;
		display: inline-flex;
		margin-top: 5px;
	}
	.icon {
		flex: none;
		display: inline-flex;
		margin-top: 2px;
		padding: 5px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.icon:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.add {
		flex: none;
		margin-top: 1px;
		padding: 5px 12px;
		border: none;
		border-radius: var(--r-sm);
		background: var(--accent);
		color: var(--on-accent);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.add:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
