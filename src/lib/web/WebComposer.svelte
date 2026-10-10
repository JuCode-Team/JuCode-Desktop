<script lang="ts">
	// The web chat's message box: text (Enter sends; Shift+Enter, or Enter on a
	// touch screen, is a new line), images by picker, paste or drop, web search
	// or deep research, the model and its effort, send / stop.
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import BinocularsIcon from 'phosphor-svelte/lib/BinocularsIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { t } from '$lib/i18n';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { models } from './models.svelte';
	import { chatPrefs, effortName } from './prefs.svelte';

	let {
		busy,
		onSend,
		onStop,
		autofocus = false
	}: {
		busy: boolean;
		/** Resolves false when the message was not sent (the text stays). */
		onSend: (text: string, files: File[]) => Promise<boolean>;
		onStop: () => void;
		autofocus?: boolean;
	} = $props();

	const MAX_FILES = 10;
	const MAX_BYTES = 20 * 1024 * 1024;

	let text = $state('');
	let files = $state<{ file: File; url: string }[]>([]);
	let input = $state<HTMLTextAreaElement | null>(null);
	let picker = $state<HTMLInputElement | null>(null);
	let menu = $state<'model' | 'effort' | null>(null);
	let dragging = $state(false);
	let sending = $state(false);

	const model = $derived(models.find(chatPrefs.current));
	const canSend = $derived(!busy && !sending && !!chatPrefs.current && (!!text.trim() || files.length > 0));

	$effect(() => {
		if (autofocus) input?.focus();
	});

	function autosize() {
		if (!input) return;
		input.style.height = 'auto';
		input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
	}

	function add(list: Iterable<File>) {
		for (const file of list) {
			if (files.length >= MAX_FILES) break;
			if (!file.type.startsWith('image/')) {
				toast.error(t('web.chat.attachType', { name: file.name }));
				continue;
			}
			if (file.size > MAX_BYTES) {
				toast.error(t('web.chat.attachTooBig', { name: file.name }));
				continue;
			}
			files = [...files, { file, url: URL.createObjectURL(file) }];
		}
	}
	function drop(i: number) {
		URL.revokeObjectURL(files[i]!.url);
		files = files.filter((_, j) => j !== i);
	}

	async function send() {
		if (!canSend) return;
		const body = text.trim();
		const sent = files;
		sending = true;
		text = '';
		files = [];
		requestAnimationFrame(autosize);
		const ok = await onSend(body, sent.map((f) => f.file)).catch(() => false);
		sending = false;
		if (!ok) {
			text = body;
			files = sent;
			requestAnimationFrame(autosize);
			return;
		}
		for (const f of sent) URL.revokeObjectURL(f.url);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
		if (matchMedia('(hover: none)').matches) return;
		e.preventDefault();
		void send();
	}

	function onPaste(e: ClipboardEvent) {
		const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
		if (!images.length) return;
		e.preventDefault();
		add(images);
	}

	export function focus() {
		input?.focus();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="composer"
	class:dragging
	ondragover={(e) => {
		if (e.dataTransfer?.types.includes('Files')) {
			e.preventDefault();
			dragging = true;
		}
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) add(e.dataTransfer.files);
	}}
>
	{#if files.length}
		<div class="files">
			{#each files as f, i (f.url)}
				<span class="thumb">
					<button class="open" onclick={() => imageViewer.open(files.map((x) => ({ path: x.file.name, load: () => Promise.resolve(x.url) })), i)} aria-label={t('common.image.open')}>
						<img src={f.url} alt={f.file.name} />
					</button>
					<button class="x" onclick={() => drop(i)} aria-label={t('common.close')}><XIcon size={11} weight="bold" /></button>
				</span>
			{/each}
		</div>
	{/if}
	<textarea
		bind:this={input}
		bind:value={text}
		rows="1"
		placeholder={t('web.chat.placeholder')}
		oninput={autosize}
		onkeydown={onKey}
		onpaste={onPaste}
	></textarea>
	<div class="bar">
		<button class="tool" onclick={() => picker?.click()} title={t('web.chat.attach')} aria-label={t('web.chat.attach')}><PlusIcon size={17} /></button>
		<input bind:this={picker} type="file" accept="image/*" multiple hidden onchange={(e) => (add((e.currentTarget as HTMLInputElement).files ?? []), ((e.currentTarget as HTMLInputElement).value = ''))} />
		<button class="chip" class:on={chatPrefs.search} aria-pressed={chatPrefs.search} onclick={() => chatPrefs.setSearch(!chatPrefs.search)}>
			<GlobeIcon size={15} /><span>{t('web.chat.search')}</span>
		</button>
		<button class="chip" class:on={chatPrefs.research} aria-pressed={chatPrefs.research} title={t('web.chat.researchHint')} onclick={() => chatPrefs.setResearch(!chatPrefs.research)}>
			<BinocularsIcon size={15} /><span>{t('web.chat.research')}</span>
		</button>
		<span class="grow"></span>
		{#if models.list.length}
			<span class="anchor">
				<button class="pick" onclick={() => (menu = menu === 'model' ? null : 'model')} aria-haspopup="menu" aria-expanded={menu === 'model'} title={t('web.chat.model')}>
					<Vendor model={chatPrefs.current} size={14} />
					<span class="pname">{model?.name ?? chatPrefs.current}</span>
					<CaretDownIcon size={11} />
				</button>
				{#if menu === 'model'}
					<PopMenu
						placement="up-right"
						title={t('web.chat.model')}
						items={models.list.map((m) => ({ key: m.id, label: m.name, desc: m.window ? `${Math.round(m.window / 1000)}K` : undefined, checked: m.id === chatPrefs.current }))}
						onSelect={(k) => {
							chatPrefs.setModel(k);
							menu = null;
						}}
						onClose={() => (menu = null)}
					/>
				{/if}
			</span>
			{#if model?.efforts.length}
				<span class="anchor">
					<button class="pick dim" onclick={() => (menu = menu === 'effort' ? null : 'effort')} aria-haspopup="menu" aria-expanded={menu === 'effort'} title={t('web.chat.effort')}>
						<span>{effortName(chatPrefs.effort)}</span>
						<CaretDownIcon size={11} />
					</button>
					{#if menu === 'effort'}
						<PopMenu
							placement="up-right"
							title={t('web.chat.effort')}
							items={model.efforts.map((e) => ({ key: e, label: effortName(e), checked: e === chatPrefs.effort }))}
							onSelect={(k) => {
								chatPrefs.setEffort(k);
								menu = null;
							}}
							onClose={() => (menu = null)}
						/>
					{/if}
				</span>
			{/if}
		{/if}
		{#if busy}
			<button class="send stop" onclick={onStop} title={t('web.chat.stop')} aria-label={t('web.chat.stop')}><StopIcon size={15} weight="fill" /></button>
		{:else}
			<button class="send" disabled={!canSend} onclick={send} title={t('web.chat.send')} aria-label={t('web.chat.send')}><ArrowUpIcon size={17} weight="bold" /></button>
		{/if}
	</div>
</div>

<style>
	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 10px 8px 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-xl);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		transition:
			border-color var(--t-fast) var(--ease-out),
			box-shadow var(--t-med) var(--ease-out);
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--text) 18%, var(--border));
	}
	.composer.dragging {
		border-color: var(--brand);
	}
	textarea {
		width: 100%;
		min-height: 26px;
		max-height: 240px;
		padding: 4px 4px 2px 0;
		border: none;
		outline: none;
		resize: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.55;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 2px;
	}
	.thumb {
		position: relative;
		display: inline-flex;
	}
	.open {
		display: inline-flex;
		padding: 0;
		border: none;
		border-radius: var(--r-md);
		background: none;
		cursor: zoom-in;
	}
	.thumb img {
		width: 56px;
		height: 56px;
		border-radius: var(--r-md);
		object-fit: cover;
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.x {
		position: absolute;
		top: -6px;
		right: -6px;
		display: inline-flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-full);
		background: var(--text);
		color: var(--bg);
		cursor: pointer;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.grow {
		flex: 1;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 30px;
		height: 30px;
		margin-left: -4px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tool:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: none;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.chip:hover {
		color: var(--text);
	}
	.chip.on {
		border-color: color-mix(in oklab, var(--brand) 45%, var(--border));
		background: color-mix(in oklab, var(--brand) 12%, transparent);
		color: var(--text);
	}
	.anchor {
		position: relative;
		display: inline-flex;
		min-width: 0;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		height: 30px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		white-space: nowrap;
		cursor: pointer;
	}
	.pick.dim {
		color: var(--dim);
	}
	.pick:hover {
		background: var(--surface2);
	}
	.pname {
		min-width: 0;
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.send {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r-full);
		background: var(--text);
		color: var(--bg);
		cursor: pointer;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.send:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.send.stop {
		background: var(--text);
	}
	.tool:focus-visible,
	.chip:focus-visible,
	.pick:focus-visible,
	.send:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	@media (max-width: 520px) {
		.chip span {
			display: none;
		}
		.chip {
			width: 30px;
			padding: 0;
			justify-content: center;
		}
		.pname {
			max-width: 110px;
		}
	}
</style>
