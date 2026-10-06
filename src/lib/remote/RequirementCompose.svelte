<script lang="ts">
	// Noting an idea from the phone: a line of words, screenshots (camera or
	// photos) and its project (the one last noted in, or none). The words
	// and that project are kept on this device. A page of its own on a phone; the Requirements tab's
	// pane on a wide page.
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { MAX_IMAGES } from '$lib/requirements.svelte';
	import { sendFile } from '$lib/upload';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';
	import RemoteScreen from './RemoteScreen.svelte';

	let {
		onBack,
		onNoted
	}: {
		/** A page over the list (phone); none in the wide pane. */
		onBack?: () => void;
		onNoted: (id: string) => void;
	} = $props();

	const conn = useHost();
	const KEY = `${conn.id}:requirement-capture`;
	let text = $state(loadComposerText(KEY));
	$effect(() => saveComposerText(KEY, text));
	/** Screenshots to note, with their previews. */
	let images = $state<{ file: File; url: string }[]>([]);
	/** Bytes sent of all screenshots, while noting. */
	let progress = $state<{ sent: number; total: number } | null>(null);
	const PROJECT_KEY = `${conn.id}:requirement-project`;
	let project = $state(localStorage.getItem(PROJECT_KEY) ?? '');
	let busy = $state(false);
	let error = $state('');
	let picker = $state<HTMLInputElement | null>(null);

	const projects = $derived.by(() => {
		const seen = new Set<string>();
		return conn.projects.workspaces
			.flatMap((w) => w.projects)
			.filter((p) => !p.chats && !seen.has(p.id) && !!seen.add(p.id))
			.map((p) => ({ value: p.id, label: p.name }));
	});
	// A project since removed: none.
	$effect(() => {
		if (project && projects.length && !projects.some((p) => p.value === project)) project = '';
	});
	const options = $derived([{ value: '', label: t('shell.requirement.noProject') }, ...projects]);

	async function addFiles(files: Iterable<File>) {
		error = '';
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			if (images.length >= MAX_IMAGES) {
				error = t('shell.requirement.tooManyImages', { n: MAX_IMAGES });
				return;
			}
			images.push({ file, url: URL.createObjectURL(file) });
		}
	}

	async function note() {
		const words = text.trim();
		if (!words || busy) return;
		busy = true;
		error = '';
		try {
			// The screenshots go first (through the relay, encrypted), then
			// the requirement names them.
			const total = images.reduce((n, i) => n + i.file.size, 0);
			let done = 0;
			const paths = [];
			for (const image of images) {
				const sent = await conn.requirements.upload(image.file, (bytes) => (progress = { sent: done + bytes, total }));
				done += image.file.size;
				paths.push(sent.path);
			}
			const r = await conn.requirements.create({
				text: words,
				images: paths,
				source: 'phone',
				project: project || null
			});
			localStorage.setItem(PROJECT_KEY, project);
			text = '';
			for (const image of images) URL.revokeObjectURL(image.url);
			images = [];
			onNoted(r.id);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
			progress = null;
		}
	}
</script>

<RemoteScreen title={t('shell.requirement.capture')} {onBack}>
	<div class="compose">
		<p class="hint">{t('shell.requirement.captureHint')}</p>
		<!-- svelte-ignore a11y_autofocus -->
		<textarea bind:value={text} placeholder={t('shell.requirement.capture')} disabled={busy} autofocus={!!onBack}></textarea>
		<div class="shots">
			{#each images as image, i (image.url)}
				<span class="shot">
					<img src={image.url} alt="" />
					<button aria-label={t('shell.requirement.removeImage')} onclick={() => URL.revokeObjectURL(images.splice(i, 1)[0].url)}><XIcon size={12} /></button>
				</span>
			{/each}
			{#if images.length < MAX_IMAGES}
				<button class="shot add" onclick={() => picker?.click()} aria-label={t('shell.requirement.addImage')}><ImageIcon size={20} /></button>
			{/if}
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
		</div>
		{#if projects.length}
			<div class="project"><Select bind:value={project} {options} /></div>
		{/if}
		{#if error}<Notice tone="error">{error}</Notice>{/if}
		<Button variant="primary" full disabled={!text.trim() || busy} onclick={note}>
			{#if busy}<CircleNotchIcon size={15} class="spin" />{/if}{progress
				? t('shell.upload.progress', { percent: Math.round((progress.sent / Math.max(progress.total, 1)) * 100) })
				: t('shell.requirement.add')}
		</Button>
	</div>
</RemoteScreen>

<style>
	.compose {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 640px;
		margin: 0 auto;
		padding: 16px;
	}
	.hint {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	textarea {
		min-height: 120px;
		padding: 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		/* 16px keeps iOS from zooming into the field. */
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.6;
		resize: vertical;
		outline: none;
	}
	.shots {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.shot {
		position: relative;
		width: 84px;
		height: 60px;
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
		top: 3px;
		right: 3px;
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-full);
		background: color-mix(in oklab, var(--bg) 80%, transparent);
		color: var(--text);
	}
	.shot.add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-style: dashed;
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
</style>
