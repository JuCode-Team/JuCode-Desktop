<script lang="ts">
	// One dispatch as a page of the remote app: the request, the plan to
	// confirm (plan mode), each task with where it runs and the end of its
	// session's reply, and the summary once done. The dispatcher's own
	// conversation is one tap away.
	import ChatTeardropTextIcon from 'phosphor-svelte/lib/ChatTeardropTextIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';
	import { baseName } from './store.svelte';
	import type { DispatchTask } from './dispatch.svelte';
	import RemoteScreen from './RemoteScreen.svelte';
	import { when } from './desk';

	let {
		id,
		onBack,
		onOpenSession,
		onOpenProcess
	}: {
		id: string;
		onBack: () => void;
		onOpenSession: (session: string, title: string) => void;
		/** The dispatcher's conversation. */
		onOpenProcess: () => void;
	} = $props();

	const conn = useHost();
	const d = $derived(conn.dispatches.list.find((x) => x.id === id));
	const done = $derived(d ? d.tasks.filter((task) => task.status === 'done').length : 0);
	const where = (task: DispatchTask) => baseName(task.project) || task.project;

	let note = $state('');
	let deciding = $state(false);
	let error = $state('');
	async function decide(approve: boolean) {
		deciding = true;
		error = '';
		try {
			await conn.dispatches.confirm(id, approve, note.trim());
			note = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			deciding = false;
		}
	}
</script>

<RemoteScreen
	title={d ? t(`shell.dispatch.status.${d.status}`) : t('shell.dispatch.title')}
	subtitle={d ? `${when(d.created_at)} · ${t(`shell.dispatch.modes.${d.mode}`)}` : undefined}
	{onBack}
>
	{#snippet actions()}
		{#if d}
			<button class="act" onclick={onOpenProcess} aria-label={t('shell.dispatch.process')} title={t('shell.dispatch.process')}>
				<ChatTeardropTextIcon size={18} />
			</button>
		{/if}
	{/snippet}

	{#if !d}
		<p class="gone">{t('shell.dispatch.gone')}</p>
	{:else}
		<div class="page">
			<section>
				<h2>{t('shell.dispatch.request')}</h2>
				<p class="request">{d.text}</p>
			</section>

			{#if d.status === 'awaiting'}
				<section class="decide">
					<p>{t('shell.dispatch.awaitingHint')}</p>
					<textarea rows="2" bind:value={note} placeholder={t('shell.dispatch.note')} disabled={deciding}></textarea>
					{#if error}<Notice tone="error">{error}</Notice>{/if}
					<div class="buttons">
						<Button size="sm" variant="ghost" disabled={deciding} onclick={() => decide(false)}>{t('shell.dispatch.cancel')}</Button>
						<Button size="sm" variant="primary" disabled={deciding} onclick={() => decide(true)}>{t('shell.dispatch.confirm')}</Button>
					</div>
				</section>
			{/if}

			<section>
				<h2>
					{t('shell.dispatch.tasks')}
					{#if d.tasks.length}<span class="count">{t('shell.dispatch.progress', { done, total: d.tasks.length })}</span>{/if}
				</h2>
				{#if d.tasks.length === 0}
					<p class="waiting">
						{#if d.status === 'planning'}<CircleNotchIcon size={14} class="spin" />{t('shell.dispatch.planning')}{:else}—{/if}
					</p>
				{/if}
				<ol class="tasks">
					{#each d.tasks as task (task.id)}
						<li class="task">
							<button class="task-head" disabled={!task.session} onclick={() => task.session && onOpenSession(task.session, task.title)}>
								<span class="mark {task.status}">
									{#if task.status === 'sent' || task.status === 'running'}<CircleNotchIcon size={14} class="spin" />{:else}<span class="dot"></span>{/if}
								</span>
								<span class="name">{task.title}</span>
								<span class="state {task.status}">{t(`shell.dispatch.task.${task.status}`)}</span>
								{#if task.session}<CaretRightIcon size={12} />{/if}
							</button>
							<div class="where">{where(task)}{task.session ? '' : ` · ${t('shell.dispatch.newSession')}`}</div>
							{#if task.reply}<p class="reply">{task.reply}</p>{/if}
						</li>
					{/each}
				</ol>
			</section>

			{#if d.summary}
				<section>
					<h2>{t('shell.dispatch.summary')}</h2>
					<div class="summary"><Markdown text={d.summary} /></div>
				</section>
			{/if}
		</div>
	{/if}
</RemoteScreen>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 22px;
		max-width: 760px;
		margin: 8px auto 0;
		animation: rise var(--t-med) var(--ease-out);
	}
	h2 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 8px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.count {
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.request {
		margin: 0;
		color: var(--text);
		font-size: var(--fs-md);
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.decide {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--surface);
	}
	.decide p {
		margin: 0;
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.decide textarea {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
		resize: none;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.waiting {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.tasks {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--hairline);
	}
	.task {
		padding: 10px 0;
		border-bottom: 1px solid var(--hairline);
	}
	.task-head {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.task-head:disabled {
		cursor: default;
	}
	.task-head:not(:disabled):hover .name {
		text-decoration: underline;
	}
	.task-head > :global(svg) {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.mark {
		flex-shrink: 0;
		display: inline-flex;
		justify-content: center;
		width: 16px;
		color: var(--accent-bright);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--dim2);
	}
	.mark.waiting .dot {
		background: var(--warn);
	}
	.mark.done .dot {
		background: var(--ok);
	}
	.mark.failed .dot {
		background: var(--err);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: 500;
	}
	.state {
		flex-shrink: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.state.waiting {
		color: var(--warn);
	}
	.state.failed {
		color: var(--err);
	}
	.where {
		margin: 2px 0 0 26px;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.reply {
		margin: 8px 0 0 26px;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.summary {
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--fs-sm);
	}
	.gone {
		margin: 48px 0;
		color: var(--dim2);
		font-size: var(--fs-sm);
		text-align: center;
	}
</style>
