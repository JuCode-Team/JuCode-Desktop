<script lang="ts">
	// One message of the web chat. Yours: its images and text, copied or
	// edited and asked again. A reply: its thinking (folded, with how long it
	// took), a research's progress, the searches and sources, the answer, and
	// what it cost; copied, or (the last one) generated again.
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import { getLocale, t } from '$lib/i18n';
	import Markdown from '$lib/Markdown.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { attachmentURL, type WebMsg } from './chat.svelte';
	import { models } from './models.svelte';

	let {
		m,
		last,
		busy,
		onRegenerate,
		onEdit,
		onCancelResearch
	}: {
		m: WebMsg;
		/** The conversation's last message (a reply can be generated again). */
		last: boolean;
		busy: boolean;
		onRegenerate: () => void;
		onEdit: (text: string) => void;
		onCancelResearch: () => void;
	} = $props();

	const streaming = $derived(m.status === 'streaming');
	const thinkingNow = $derived(streaming && !!m.reasoning && !m.content);
	let thoughtOpen = $state(false);
	let sourcesOpen = $state(false);
	let copied = $state(false);
	let editing = $state(false);
	let draft = $state('');

	const secs = (ms: number) => {
		const s = Math.max(1, Math.round(ms / 1000));
		if (getLocale() === 'zh') return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	};
	const domain = (url: string) => {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	};
	const money = (cost: string, currency: string) => {
		const n = Number(cost);
		if (!Number.isFinite(n)) return '';
		return `${currency === 'USD' ? '$' : '¥'}${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
	};
	const usageLine = $derived.by(() => {
		if (!m.usage) return '';
		const parts = [t('web.chat.usage', { input: m.usage.input.toLocaleString(), output: m.usage.output.toLocaleString() })];
		if (m.usage.cost) parts.push(t('web.chat.cost', { cost: money(m.usage.cost, m.usage.currency) }));
		return parts.join(' · ');
	});

	// The user's images, shown from the cloud.
	let images = $state<Record<string, string>>({});
	$effect(() => {
		for (const a of m.attachments) {
			if (!a.mime.startsWith('image/') || images[a.id]) continue;
			attachmentURL(a.id).then(
				(url) => (images = { ...images, [a.id]: url }),
				() => {}
			);
		}
	});
	function viewImage(id: string) {
		const list = m.attachments.filter((a) => images[a.id]);
		imageViewer.open(list.map((a) => ({ path: a.name, load: () => Promise.resolve(images[a.id]!) })), list.findIndex((a) => a.id === id));
	}

	async function copy() {
		await navigator.clipboard?.writeText(m.content).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
	function startEdit() {
		draft = m.content;
		editing = true;
	}
	function saveEdit() {
		const text = draft.trim();
		editing = false;
		if (text && text !== m.content) onEdit(text);
	}
</script>

{#if m.role === 'user'}
	<div class="user">
		{#if m.attachments.length}
			<div class="uimgs">
				{#each m.attachments as a (a.id)}
					{#if images[a.id]}
						<button class="uimg" onclick={() => viewImage(a.id)} aria-label={t('common.image.open')}><img src={images[a.id]} alt={a.name} /></button>
					{:else}
						<span class="uimg ph"></span>
					{/if}
				{/each}
			</div>
		{/if}
		{#if editing}
			<div class="edit">
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					bind:value={draft}
					autofocus
					rows="3"
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
							e.preventDefault();
							saveEdit();
						} else if (e.key === 'Escape') editing = false;
					}}
				></textarea>
				<div class="edit-bar">
					<Button size="sm" variant="ghost" onclick={() => (editing = false)}>{t('web.chat.editCancel')}</Button>
					<Button size="sm" variant="primary" disabled={!draft.trim()} onclick={saveEdit}>{t('web.chat.editSave')}</Button>
				</div>
			</div>
		{:else if m.content}
			<div class="bubble">{m.content}</div>
			<div class="acts right">
				<button onclick={copy} title={t('web.chat.copy')} aria-label={t('web.chat.copy')}>{#if copied}<CheckIcon size={15} />{:else}<CopyIcon size={15} />{/if}</button>
				{#if !busy}<button onclick={startEdit} title={t('web.chat.edit')} aria-label={t('web.chat.edit')}><PencilSimpleIcon size={15} /></button>{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="reply">
		<span class="mark" title={models.find(m.model)?.name ?? m.model}><Vendor model={m.model} size={16} /></span>
		<div class="body">
			{#if m.reasoning}
				<button class="thought" onclick={() => (thoughtOpen = !thoughtOpen)} aria-expanded={thoughtOpen}>
					{#if thinkingNow}<CircleNotchIcon size={13} class="spin" /><span>{t('web.chat.thinking')}</span>
					{:else}<span>{m.thoughtMs ? t('web.chat.thought', { s: secs(m.thoughtMs) }) : t('web.chat.thoughtShort')}</span>{/if}
					<span class="caret" class:open={thoughtOpen || thinkingNow}><CaretRightIcon size={12} /></span>
				</button>
				{#if thoughtOpen || thinkingNow}
					<div class="reasoning"><Markdown text={m.reasoning} /></div>
				{/if}
			{/if}

			{#if m.kind === 'research' && m.research}
				<div class="research">
					<div class="rhead">
						{#if streaming}<CircleNotchIcon size={13} class="spin" />{/if}
						<span>{m.research.status === 'queued' ? t('web.chat.research_queued') : streaming ? t('web.chat.research_running') : t('web.chat.research')}</span>
						{#if m.research.steps.length}<span class="dim">· {t('web.chat.research_steps', { n: m.research.steps.length })}</span>{/if}
						<span class="grow"></span>
						{#if streaming}<button class="link" onclick={onCancelResearch}>{t('web.chat.research_cancel')}</button>{/if}
					</div>
					{#if streaming && m.research.steps.length}
						<ol class="steps">
							{#each m.research.steps.slice(-4) as s, i (i)}<li>{s.text}</li>{/each}
						</ol>
					{/if}
				</div>
			{/if}

			{#if m.searches.length || m.sources.length}
				<button class="thought" onclick={() => (sourcesOpen = !sourcesOpen)} aria-expanded={sourcesOpen}>
					<GlobeIcon size={13} />
					{#if streaming && !m.content && m.searches.length}<span>{t('web.chat.searching', { q: m.searches.at(-1) ?? '' })}</span>
					{:else}<span>{[m.searches.length ? t('web.chat.searched', { n: m.searches.length }) : '', m.sources.length ? t('web.chat.sources', { n: m.sources.length }) : ''].filter(Boolean).join(' · ')}</span>{/if}
					<span class="caret" class:open={sourcesOpen}><CaretRightIcon size={12} /></span>
				</button>
				{#if sourcesOpen && m.sources.length}
					<ol class="sources">
						{#each m.sources as s, i (i)}
							<li><a href={s.url} target="_blank" rel="noopener noreferrer"><span class="sn">{i + 1}</span><span class="st">{s.title || domain(s.url)}</span><span class="sd">{domain(s.url)}</span></a></li>
						{/each}
					</ol>
				{/if}
			{/if}

			{#if m.content}
				<div class="answer" class:streaming><Markdown text={m.content} /></div>
			{:else if streaming && !m.reasoning && !m.searches.length && m.kind === 'chat'}
				<div class="pending"><span></span><span></span><span></span></div>
			{/if}

			{#if m.status === 'error'}
				<div class="err"><WarningCircleIcon size={15} /><span>{t('web.chat.error', { msg: m.error || '—' })}</span>{#if last && !busy}<button class="link" onclick={onRegenerate}>{t('web.chat.retry')}</button>{/if}</div>
			{:else if m.status === 'incomplete'}
				<div class="note">{t('web.chat.stopped')}</div>
			{/if}

			{#if !streaming && (m.content || m.status === 'error')}
				<div class="acts">
					{#if m.content}<button onclick={copy} title={t('web.chat.copy')} aria-label={t('web.chat.copy')}>{#if copied}<CheckIcon size={15} />{:else}<CopyIcon size={15} />{/if}</button>{/if}
					{#if last && !busy && m.kind === 'chat'}<button onclick={onRegenerate} title={t('web.chat.regenerate')} aria-label={t('web.chat.regenerate')}><ArrowClockwiseIcon size={15} /></button>{/if}
					{#if usageLine}<span class="usage" title={usageLine}><InfoIcon size={15} /><span class="utext">{usageLine}</span></span>{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.user {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
	}
	.bubble {
		max-width: min(85%, 640px);
		padding: 10px 14px;
		border-radius: var(--r-xl);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-md);
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.uimgs {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
	}
	.uimg {
		display: inline-flex;
		padding: 0;
		border: none;
		border-radius: var(--r-lg);
		background: none;
		cursor: zoom-in;
		overflow: hidden;
	}
	.uimg img,
	.uimg.ph {
		display: block;
		width: 140px;
		height: 140px;
		object-fit: cover;
	}
	.uimg.ph {
		background: var(--surface2);
	}
	.edit {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(100%, 640px);
		padding: 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-xl);
		background: var(--panel);
	}
	.edit textarea {
		width: 100%;
		border: none;
		outline: none;
		resize: vertical;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.55;
	}
	.edit-bar {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.reply {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr);
		gap: 12px;
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--r-full);
		box-shadow: inset 0 0 0 1px var(--border);
		color: var(--text);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		padding-top: 3px;
	}
	.thought {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.thought:hover {
		color: var(--text);
	}
	.caret {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.reasoning {
		padding: 2px 0 2px 14px;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.research {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		font-size: var(--fs-sm);
	}
	.rhead {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dim {
		color: var(--dim);
	}
	.grow {
		flex: 1;
	}
	.steps {
		margin: 0;
		padding-left: 18px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.6;
	}
	.sources {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.sources a {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 2px 8px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		color: var(--text);
		text-decoration: none;
		font-size: var(--fs-xs);
	}
	.sources a:hover {
		background: var(--surface2);
	}
	.sn {
		grid-row: span 2;
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.st,
	.sd {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sd {
		color: var(--dim2);
	}
	.answer {
		font-size: var(--fs-md);
		line-height: 1.7;
	}
	.answer.streaming :global(.md > :last-child)::after {
		content: '';
		display: inline-block;
		width: 0.5em;
		height: 1em;
		margin-left: 2px;
		vertical-align: -2px;
		border-radius: 2px;
		background: var(--text);
		animation: blink 1s steps(2, start) infinite;
	}
	@keyframes blink {
		to {
			visibility: hidden;
		}
	}
	.pending {
		display: inline-flex;
		gap: 4px;
		padding: 8px 0;
	}
	.pending span {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--dim2);
		animation: dot 1.2s ease-in-out infinite;
	}
	.pending span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.pending span:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes dot {
		0%,
		80%,
		100% {
			opacity: 0.3;
		}
		40% {
			opacity: 1;
		}
	}
	.err {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		color: var(--err);
		font-size: var(--fs-sm);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.err :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.note {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.link {
		flex: none;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-left: -6px;
		color: var(--dim2);
	}
	.acts.right {
		margin: 0 -6px 0 0;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.user:hover .acts.right,
	.acts.right:focus-within {
		opacity: 1;
	}
	@media (hover: none) {
		.acts.right {
			opacity: 1;
		}
	}
	.acts button {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.acts button:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.usage {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 6px;
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	.utext {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.reply:hover .utext {
		opacity: 1;
	}
	@media (hover: none) {
		.utext {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.answer.streaming :global(.md > :last-child)::after,
		.pending span {
			animation: none;
		}
	}
</style>
