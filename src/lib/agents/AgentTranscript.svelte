<script lang="ts">
	// One subagent's own conversation, read-only: its task (folded to a few
	// lines), then its messages and tool calls. Read when shown, and again
	// every few seconds while the subagent works. Shared by the agent trace
	// panel and the conversation's subagent drawer.
	import { untrack } from 'svelte';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { t } from '$lib/i18n';
	import Markdown from '$lib/Markdown.svelte';
	import MessageList from '$lib/MessageList.svelte';
	import type { ChatState } from '$lib/chat.svelte';
	import type { Op } from '$lib/protocol';

	let {
		chat,
		agentId,
		live,
		scroller,
		onOp
	}: {
		chat: ChatState;
		agentId: string;
		/** Still running: re-read its conversation every few seconds. */
		live: boolean;
		/** The scroll viewport the conversation sits in. */
		scroller: HTMLElement | null;
		onOp: (op: Op) => void;
	} = $props();

	const POLL_MS = 2500;
	const transcript = $derived(chat.subagentTranscripts[agentId]);
	$effect(() => {
		const id = agentId;
		const poll = live;
		untrack(() => onOp({ op: 'subagent_transcript', agent_id: id }));
		if (!poll) return;
		const timer = setInterval(() => onOp({ op: 'subagent_transcript', agent_id: id }), POLL_MS);
		return () => clearInterval(timer);
	});

	let taskOpen = $state(false);
	$effect(() => {
		void agentId;
		taskOpen = false;
	});
	// The newest tool call still running, as the list's live phase.
	const lastRunning = $derived(transcript?.messages.at(-1)?.kind === 'tool' && (transcript.messages.at(-1) as { running?: boolean }).running);
</script>

{#if transcript?.error}
	<p class="empty-line">{transcript.error}</p>
{:else if !transcript}
	<p class="empty-line"><CircleNotchIcon size={13} class="spin" /> {t('dock.agents.loading')}</p>
{:else}
	{#if transcript.task}
		<section class="task" class:open={taskOpen}>
			<button class="task-head" onclick={() => (taskOpen = !taskOpen)} aria-expanded={taskOpen}>
				<span class="caret" class:open={taskOpen}><CaretRightIcon size={12} /></span>
				{t('dock.agents.task')}
			</button>
			<div class="task-body"><Markdown text={transcript.task} /></div>
		</section>
	{/if}
	{#if transcript.messages.length}
		<div class="convo">
			<MessageList
				messages={transcript.messages}
				streamingMsg={null}
				streamingReasoning={null}
				phase={live ? (lastRunning ? 'tool' : 'waiting') : null}
				{scroller}
				onEdit={() => {}}
				onRewind={() => {}}
			/>
		</div>
	{:else}
		<p class="empty-line">{live ? t('dock.agents.loading') : t('dock.agents.noMessages')}</p>
	{/if}
{/if}

<style>
	.caret {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.task {
		margin: 4px 18px 6px;
		border-top: 1px solid var(--hairline);
		border-bottom: 1px solid var(--hairline);
	}
	.task-head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.task-body {
		max-height: 4.5em;
		overflow: hidden;
		padding-bottom: 8px;
		font-size: var(--fs-sm);
		mask-image: linear-gradient(to bottom, black 55%, transparent);
	}
	.task.open .task-body {
		max-height: none;
		mask-image: none;
	}
	.convo {
		padding: 6px 18px 0;
	}
	.empty-line {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 18px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
</style>
