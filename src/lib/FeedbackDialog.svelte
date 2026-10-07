<script lang="ts">
	// 反馈问题: a bug report or suggestion, sent as a support ticket of the
	// signed-in JuCode account (the console shows it and the replies). It can
	// carry screenshots and, by default, the end of the engine's and the
	// daemon's logs: listed with their sizes and previewable, redacted and
	// gzipped before they leave (feedback.ts).
	import { onMount } from 'svelte';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { appVersion } from '$lib/about';
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { diagnosticLogs, submitFeedback } from '$lib/protocol';
	import { gzipDataURL, logBundle, redact } from '$lib/feedback';
	import { shrinkImage } from '$lib/upload';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import { telemetry } from '$lib/telemetry.svelte';
	import { t } from '$lib/i18n';

	let { onClose }: { onClose: () => void } = $props();

	/** Screenshots: 2 at most, each under 2 MB (the ticket's limits). */
	const MAX_SHOTS = 2;
	const MAX_SHOT_BYTES = 2 * 1024 * 1024;

	let kind = $state<'bug' | 'idea'>('bug');
	let title = $state('');
	let body = $state(loadComposerText('feedback'));
	$effect(() => saveComposerText('feedback', body));
	let shots = $state<{ name: string; url: string }[]>([]);
	let withLogs = $state(true);
	let logs = $state<{ name: string; size: number; text: string }[]>([]);
	let previewing = $state('');
	let sending = $state(false);
	let error = $state('');
	let picker = $state<HTMLInputElement | null>(null);

	onMount(() => {
		diagnosticLogs()
			.then((list) => (logs = list))
			.catch(() => (logs = []));
	});

	const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

	function readURL(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}
	async function addShots(files: Iterable<File>) {
		error = '';
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			if (shots.length >= MAX_SHOTS) {
				error = t('shell.feedback.tooManyShots', { n: MAX_SHOTS });
				return;
			}
			const { blob, name } = await shrinkImage(file);
			if (blob.size > MAX_SHOT_BYTES) {
				error = t('shell.feedback.shotTooBig');
				continue;
			}
			shots.push({ name, url: await readURL(blob) });
		}
	}
	function onPaste(e: ClipboardEvent) {
		const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
		if (!files.length) return;
		e.preventDefault();
		void addShots(files);
	}

	function platform(): string {
		const ua = navigator.userAgent;
		return /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ua;
	}

	async function send() {
		if (!title.trim() || !body.trim() || sending) return;
		sending = true;
		error = '';
		try {
			const version = await appVersion();
			const attachments: { name: string; type: string; data_url: string }[] = shots.map((s) => ({
				name: s.name,
				type: s.url.slice(5, s.url.indexOf(';')),
				data_url: s.url
			}));
			if (withLogs && logs.length)
				attachments.push({ name: 'jucode-logs.txt.gz', type: 'application/gzip', data_url: await gzipDataURL(logBundle(logs)) });
			const environment = t('shell.feedback.environment', { version: version || '?', system: platform() });
			const ticket = await submitFeedback({
				title: `[${t(kind === 'bug' ? 'shell.feedback.kindBug' : 'shell.feedback.kindIdea')}] ${title.trim()}`,
				body: `${body.trim()}\n\n---\n${environment}`,
				category: kind === 'bug' ? 'technical' : 'general',
				attachments
			});
			telemetry.track('feedback_send');
			body = '';
			toast.success(t('shell.feedback.sent', { no: String(ticket.ticket_no_label ?? ticket.ticket_no ?? '') }), { duration: 8000 });
			onClose();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			error = /401|unauthor|not logged|login/i.test(message) ? t('shell.feedback.needLogin') : message;
		} finally {
			sending = false;
		}
	}
</script>

<Modal title={t('shell.feedback.title')} dismissible={!sending} width={560} {onClose}>
	{#snippet icon()}<ChatCircleTextIcon size={15} />{/snippet}
	<p class="hint">{t('shell.feedback.hint')}</p>
	<Segmented
		bind:value={kind}
		options={[
			{ value: 'bug', label: t('shell.feedback.kindBug') },
			{ value: 'idea', label: t('shell.feedback.kindIdea') }
		]}
	/>
	<label class="field">
		<span>{t('shell.feedback.titleLabel')}</span>
		<input bind:value={title} placeholder={t(kind === 'bug' ? 'shell.feedback.titleBug' : 'shell.feedback.titleIdea')} />
	</label>
	<label class="field">
		<span>{t('shell.feedback.bodyLabel')}</span>
		<textarea
			bind:value={body}
			rows="6"
			placeholder={t(kind === 'bug' ? 'shell.feedback.bodyBug' : 'shell.feedback.bodyIdea')}
			onpaste={onPaste}
		></textarea>
	</label>
	<div class="shots">
		{#each shots as shot, i (shot.url)}
			<span class="shot">
				<img src={shot.url} alt="" />
				<button aria-label={t('shell.requirement.removeImage')} onclick={() => shots.splice(i, 1)}><XIcon size={11} /></button>
			</span>
		{/each}
		{#if shots.length < MAX_SHOTS}
			<button class="add" onclick={() => picker?.click()}><ImageIcon size={15} />{t('shell.feedback.addShot')}</button>
		{/if}
		<input
			bind:this={picker}
			type="file"
			accept="image/*"
			multiple
			hidden
			onchange={(e) => {
				const input = e.currentTarget;
				void addShots([...(input.files ?? [])]).then(() => (input.value = ''));
			}}
		/>
	</div>
	<div class="logs">
		<Checkbox bind:checked={withLogs} disabled={!logs.length}>{t('shell.feedback.withLogs')}</Checkbox>
		{#if logs.length}
			<ul>
				{#each logs as log (log.name)}
					<li>
						<code>{log.name}</code>
						<span class="dim">{t('shell.feedback.logTail', { size: kb(log.text.length), total: kb(log.size) })}</span>
						<button class="link" onclick={() => (previewing = previewing === log.name ? '' : log.name)}>
							{previewing === log.name ? t('shell.feedback.hidePreview') : t('shell.feedback.preview')}
						</button>
					</li>
					{#if previewing === log.name}
						<pre class="preview">{redact(log.text).slice(-20000)}</pre>
					{/if}
				{/each}
			</ul>
			<p class="dim small">{t('shell.feedback.logsNote')}</p>
		{:else}
			<p class="dim small">{t('shell.feedback.noLogs')}</p>
		{/if}
	</div>
	{#if error}
		<Notice onDismiss={() => (error = '')}>{error}</Notice>
	{/if}
	{#snippet footer()}
		<Button size="sm" onclick={onClose} disabled={sending}>{t('common.cancel')}</Button>
		<Button size="sm" variant="primary" onclick={send} disabled={!title.trim() || !body.trim() || sending}>
			{#if sending}<CircleNotchIcon size={13} class="spin" />{/if}{t('shell.feedback.send')}
		</Button>
	{/snippet}
</Modal>

<style>
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.5;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.field input,
	.field textarea {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
		padding: 7px 10px;
		outline: none;
		resize: vertical;
	}
	.field input:focus,
	.field textarea:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.shots {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.shot {
		position: relative;
		width: 84px;
		height: 56px;
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
	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border: 1px dashed var(--border-strong);
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.logs ul {
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--fs-xs);
	}
	.logs li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		padding: 2px 0;
	}
	.logs code {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.dim {
		color: var(--dim2);
	}
	.small {
		margin: 6px 0 0;
		font-size: var(--fs-2xs);
		line-height: 1.5;
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.preview {
		max-height: 200px;
		overflow: auto;
		margin: 4px 0 8px;
		padding: 8px 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
