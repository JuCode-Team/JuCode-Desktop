<script lang="ts">
	// One desk item as a page of the remote app: a question to answer or an
	// action to allow (DeskCard), or a report to read (marked read when
	// shown). An item answered meanwhile (here or on another device) says so.
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import Button from '$lib/ui/Button.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import DeskCard from '$lib/DeskCard.svelte';
	import { useAgents } from '$lib/agentScope';
	import { t } from '$lib/i18n';
	import RemoteScreen from './RemoteScreen.svelte';
	import { parseDeskKey, when } from './desk';

	let {
		key,
		onBack,
		onOpenSession,
		onOpenAgent
	}: {
		key: string;
		onBack: () => void;
		onOpenSession: (session: string) => void;
		onOpenAgent: (agent: string) => void;
	} = $props();

	const agentDirectory = useAgents();
	const item = $derived(parseDeskKey(key));
	const question = $derived(item.kind === 'question' ? agentDirectory.questions.find((q) => q.id === item.id) : undefined);
	const action = $derived(item.kind === 'action' ? agentDirectory.actions.find((a) => a.id === item.id) : undefined);
	const report = $derived(item.kind === 'report' ? agentDirectory.reports.find((r) => r.id === item.id) : undefined);

	$effect(() => {
		if (report && !report.read) void agentDirectory.markRead(report).catch(() => {});
	});

	const title = $derived(
		item.kind === 'report' ? t('shell.desk.report') : item.kind === 'question' ? t('shell.desk.question') : t('shell.desk.action')
	);
</script>

<RemoteScreen {title} subtitle={report ? `${agentDirectory.agentName(report.agent)} · ${when(report.at)}` : undefined} {onBack}>
	<div class="item">
		{#if question || action}
			<DeskCard {question} {action} {onOpenSession} {onOpenAgent} />
		{:else if report}
			<h2>{report.title}</h2>
			{#if report.body}<div class="body"><Markdown text={report.body} /></div>{/if}
			<div class="actions">
				<Button size="sm" onclick={() => onOpenAgent(report.agent)}>{agentDirectory.agentName(report.agent)}</Button>
				<Button size="sm" onclick={() => onOpenSession(report.session)}>{t('shell.desk.openSession')}</Button>
			</div>
		{:else}
			<div class="gone">
				<CheckCircleIcon size={28} />
				<p>{item.kind === 'report' ? t('shell.desk.reportGone') : t('shell.desk.handled')}</p>
				<Button size="sm" onclick={onBack}>{t('shell.desk.back')}</Button>
			</div>
		{/if}
	</div>
</RemoteScreen>

<style>
	.item {
		max-width: 760px;
		margin: 8px auto 0;
		animation: rise var(--t-med) var(--ease-out);
	}
	h2 {
		margin: 4px 0 12px;
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.body {
		font-size: var(--fs-sm);
		line-height: 1.6;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--hairline);
	}
	.gone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 48px 0;
		color: var(--dim2);
		text-align: center;
	}
	.gone p {
		margin: 0;
		font-size: var(--fs-sm);
	}
</style>
