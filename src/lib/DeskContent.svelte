<script lang="ts">
	// The desk's content: questions and pending actions waiting for the user,
	// which agents are working, and their reports. Everything comes from the
	// jucode daemon through agentDirectory. Shown in the desktop's desk sheet
	// and on the remote page.
	import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import {
		agentDirectory,
		type ActionView,
		type QuestionView,
		type ReportView
	} from '$lib/agents.svelte';
	import { t } from '$lib/i18n';

	let {
		onOpenSession
	}: {
		/** Show a daemon session. */
		onOpenSession: (session: string) => void;
	} = $props();

	let answers = $state<Record<string, string>>({});
	let busy = $state<Record<string, boolean>>({});
	let errors = $state<Record<string, string>>({});
	let expanded = $state<Record<string, boolean>>({});

	const working = $derived(agentDirectory.agents.filter((a) => a.busy));

	function when(ms: number): string {
		return new Date(ms).toLocaleString(undefined, {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function run(key: string, work: () => Promise<void>) {
		busy[key] = true;
		errors[key] = '';
		try {
			await work();
		} catch (e) {
			errors[key] = e instanceof Error ? e.message : String(e);
		} finally {
			busy[key] = false;
		}
	}

	function answer(q: QuestionView) {
		const text = (answers[q.id] ?? '').trim();
		if (!text) return;
		void run(q.id, () => agentDirectory.answer(q.id, text));
	}

	function decide(a: ActionView, allow: boolean) {
		void run(a.id, () => agentDirectory.decide(a, allow));
	}

	function toggleReport(r: ReportView) {
		expanded[r.id] = !expanded[r.id];
		if (expanded[r.id]) void agentDirectory.markRead(r).catch(() => {});
	}
</script>

{#if agentDirectory.status === 'unreachable'}
	<div class="unreachable"><Notice tone="warn">{t('shell.desk.unreachable')}</Notice></div>
{/if}

<section>
	<h3>{t('shell.desk.pending')} <span class="count">{agentDirectory.pending}</span></h3>
	{#if agentDirectory.pending === 0}
		<p class="empty">{t('shell.desk.nothingPending')}</p>
	{/if}
	{#each agentDirectory.questions as q (q.id)}
		<article class="card" class:high={q.importance === 'high'}>
			<div class="card-head">
				<QuestionIcon size={14} />
				<span class="kind">{t('shell.desk.question')}</span>
				<span class="who">{agentDirectory.agentName(q.agent)} · {when(q.asked_at)}</span>
				{#if q.due_at}<span class="due">{t('shell.desk.due', { time: when(q.due_at) })}</span>{/if}
			</div>
			<div class="title">{q.title}</div>
			{#if q.body}<div class="text">{q.body}</div>{/if}
			{#if q.assumption}
				<div class="meta"><span>{t('shell.desk.assumption')}</span>{q.assumption}</div>
			{/if}
			{#if q.default}
				<div class="meta"><span>{t('shell.desk.default')}</span>{q.default}</div>
			{/if}
			<textarea
				rows="2"
				bind:value={answers[q.id]}
				placeholder={t('shell.desk.answerPlaceholder')}
				onkeydown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), answer(q))}
			></textarea>
			{#if errors[q.id]}<Notice>{errors[q.id]}</Notice>{/if}
			<div class="actions">
				<Button size="sm" onclick={() => onOpenSession(q.session)}>{t('shell.desk.openSession')}</Button>
				<Button
					size="sm"
					variant="primary"
					disabled={!(answers[q.id] ?? '').trim() || busy[q.id]}
					onclick={() => answer(q)}
				>
					{#if busy[q.id]}<CircleNotchIcon size={13} class="spin" />{/if}
					{t('shell.desk.answer')}
				</Button>
			</div>
		</article>
	{/each}
	{#each agentDirectory.actions as a (a.id)}
		{@const agent = agentDirectory.agentOfSession(a.session_id)}
		<article class="card">
			<div class="card-head">
				<ShieldCheckIcon size={14} />
				<span class="kind">{t('shell.desk.action')}</span>
				<span class="who">{agent?.name ?? a.cwd} · {when(a.created_at)}</span>
			</div>
			<div class="title"><code>{a.name}</code> {a.summary}</div>
			<details>
				<summary>{t('shell.desk.arguments')}</summary>
				<pre>{a.arguments}</pre>
			</details>
			{#if errors[a.id]}<Notice>{errors[a.id]}</Notice>{/if}
			<div class="actions">
				<Button size="sm" onclick={() => onOpenSession(a.session_id)}>{t('shell.desk.openSession')}</Button>
				<Button size="sm" disabled={busy[a.id]} onclick={() => decide(a, false)}>{t('shell.desk.deny')}</Button>
				<Button size="sm" variant="primary" disabled={busy[a.id]} onclick={() => decide(a, true)}>
					{t('shell.desk.allow')}
				</Button>
			</div>
		</article>
	{/each}
</section>

<section>
	<h3>{t('shell.desk.working')}</h3>
	{#if working.length === 0}
		<p class="empty">{t('shell.desk.nobodyWorking')}</p>
	{:else}
		<div class="working">
			{#each working as agent (agent.id)}
				<span class="chip"><CircleNotchIcon size={14} class="spin" />{agent.name}</span>
			{/each}
		</div>
	{/if}
</section>

<section>
	<h3>{t('shell.desk.reports')}</h3>
	{#if agentDirectory.reports.length === 0}
		<p class="empty">{t('shell.desk.noReports')}</p>
	{/if}
	{#each agentDirectory.reports as r (r.id)}
		<article class="report" class:unread={!r.read}>
			<button class="report-head" onclick={() => toggleReport(r)}>
				<FileTextIcon size={13} />
				<span class="title">{r.title}</span>
				<span class="who">{agentDirectory.agentName(r.agent)} · {when(r.at)}</span>
			</button>
			{#if expanded[r.id]}
				{#if r.body}<div class="text">{r.body}</div>{/if}
				<div class="actions">
					<Button size="sm" onclick={() => onOpenSession(r.session)}>{t('shell.desk.openSession')}</Button>
				</div>
			{/if}
		</article>
	{/each}
</section>

<style>
	section {
		margin-top: 14px;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--dim);
		font-family: var(--font-mono);
	}
	.count {
		font-size: var(--fs-2xs);
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
	}
	.empty {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.unreachable {
		margin-top: 10px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin-bottom: 10px;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.card.high {
		border-color: color-mix(in oklab, var(--warn) 45%, var(--hairline));
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.kind {
		font-weight: 600;
		color: var(--text);
	}
	.who {
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.due {
		margin-left: auto;
		color: var(--warn);
		font-family: var(--font-mono);
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.title code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--accent-bright);
	}
	.text {
		font-size: var(--fs-sm);
		color: var(--text);
		line-height: 1.55;
		white-space: pre-wrap;
	}
	.meta {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.meta span {
		margin-right: 6px;
		color: var(--dim2);
	}
	textarea {
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
	textarea:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	details {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	pre {
		margin: 6px 0 0;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface2);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		white-space: pre-wrap;
		word-break: break-all;
		color: var(--text);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.working {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border-radius: var(--r-full);
		background: var(--surface2);
		font-size: var(--fs-xs);
	}
	.report {
		border-bottom: 1px solid var(--hairline);
		padding: 4px 0 8px;
	}
	.report .text {
		margin: 4px 0 8px 21px;
	}
	.report-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 2px;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
		text-align: left;
	}
	.report-head .title {
		flex: 1;
		font-weight: 500;
		color: var(--dim);
	}
	.report.unread .title {
		font-weight: 600;
		color: var(--text);
	}
</style>
