<script lang="ts">
	// One thing waiting for the user on the desk: an agent's question, with a
	// box for the answer, or an action it may not take alone, with allow and
	// deny. Either can be closed as no longer needed (nothing is sent to the
	// agent; the desk offers to undo it). Shown in the desk's list
	// (DeskContent) and on the remote page.
	import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import type { ActionView, QuestionView } from '$lib/agents.svelte';
	import { useAgents } from '$lib/agentScope';
	import { t } from '$lib/i18n';

	let {
		question,
		action,
		onOpenSession,
		onOpenAgent
	}: {
		question?: QuestionView;
		action?: ActionView;
		onOpenSession: (session: string) => void;
		onOpenAgent?: (agent: string) => void;
	} = $props();

	const agentDirectory = useAgents();
	const agent = $derived(
		question
			? agentDirectory.agents.find((x) => x.id === question.agent)
			: action
				? agentDirectory.agentOfSession(action.session_id)
				: undefined
	);

	let answer = $state('');
	let busy = $state(false);
	let error = $state('');

	function when(ms: number): string {
		return new Date(ms).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	async function run(work: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function reply() {
		const text = answer.trim();
		if (!text || !question) return;
		void run(() => agentDirectory.answer(question.id, text));
	}
</script>

{#snippet who(id: string | undefined, label: string, at: number)}
	{#if agent}<AgentAvatar {agent} size={14} />{/if}
	{#if id && onOpenAgent}
		<button class="who link" onclick={() => onOpenAgent(id)}>{label}</button><span class="who">· {when(at)}</span>
	{:else}
		<span class="who">{label} · {when(at)}</span>
	{/if}
{/snippet}

{#if question}
	<article class="card" class:high={question.importance === 'high'}>
		<div class="card-head">
			<QuestionIcon size={14} />
			<span class="kind">{t('shell.desk.question')}</span>
			{@render who(question.agent, agentDirectory.agentName(question.agent), question.asked_at)}
			{#if question.due_at}<span class="due">{t('shell.desk.due', { time: when(question.due_at) })}</span>{/if}
		</div>
		<div class="title">{question.title}</div>
		{#if question.body}<div class="text">{question.body}</div>{/if}
		{#if question.assumption}
			<div class="meta"><span>{t('shell.desk.assumption')}</span>{question.assumption}</div>
		{/if}
		{#if question.default}
			<div class="meta"><span>{t('shell.desk.default')}</span>{question.default}</div>
		{/if}
		<textarea
			rows="2"
			bind:value={answer}
			placeholder={t('shell.desk.answerPlaceholder')}
			onkeydown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), reply())}
		></textarea>
		{#if error}<Notice>{error}</Notice>{/if}
		<div class="actions">
			<Button size="sm" variant="ghost" disabled={busy} onclick={() => run(() => agentDirectory.close('question', question.id))}>{t('shell.desk.close')}</Button>
			<Button size="sm" onclick={() => onOpenSession(question.session)}>{t('shell.desk.openSession')}</Button>
			<Button size="sm" variant="primary" disabled={!answer.trim() || busy} onclick={reply}>
				{#if busy}<CircleNotchIcon size={13} class="spin" />{/if}
				{t('shell.desk.answer')}
			</Button>
		</div>
	</article>
{:else if action}
	<article class="card">
		<div class="card-head">
			<ShieldCheckIcon size={14} />
			<span class="kind">{t('shell.desk.action')}</span>
			{@render who(agent?.id, agent?.name ?? action.cwd, action.created_at)}
		</div>
		<div class="title"><code>{action.name}</code> {action.summary}</div>
		<details>
			<summary>{t('shell.desk.arguments')}</summary>
			<pre>{action.arguments}</pre>
		</details>
		{#if error}<Notice>{error}</Notice>{/if}
		<div class="actions">
			<Button size="sm" variant="ghost" disabled={busy} onclick={() => run(() => agentDirectory.close('action', action.id))}>{t('shell.desk.close')}</Button>
			<Button size="sm" onclick={() => onOpenSession(action.session_id)}>{t('shell.desk.openSession')}</Button>
			<Button size="sm" disabled={busy} onclick={() => run(() => agentDirectory.decide(action, false))}>{t('shell.desk.deny')}</Button>
			<Button size="sm" variant="primary" disabled={busy} onclick={() => run(() => agentDirectory.decide(action, true))}>
				{t('shell.desk.allow')}
			</Button>
		</div>
	</article>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.card.high {
		border-color: var(--border-strong);
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.card-head > :global(svg) {
		flex-shrink: 0;
	}
	.kind {
		flex-shrink: 0;
		font-weight: 600;
		color: var(--text);
	}
	.who {
		min-width: 0;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.link {
		flex-shrink: 1;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
		text-decoration: underline;
	}
	.due {
		flex-shrink: 0;
		margin-left: auto;
		color: var(--warn);
		font-family: var(--font-mono);
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
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
		overflow-wrap: anywhere;
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
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
