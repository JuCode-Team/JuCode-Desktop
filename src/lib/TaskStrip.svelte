<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import { taskKindLabel, type ChatState } from '$lib/chat.svelte';

	// Above the transcript: a claude session's background work (each with a
	// stop button; a shell's output on demand) and its /btw answers, which
	// are beside the conversation, never part of it.
	let {
		chat,
		onStop,
		onOutput,
		onTrace
	}: {
		chat: ChatState;
		onStop: (id: string) => void;
		onOutput: (id: string) => void;
		/** A Workflow's agent trace. */
		onTrace?: (id: string) => void;
	} = $props();

	let open = $state<string | null>(null);
	// Shell and Monitor tasks write output the engine can read back.
	const hasOutput = (kind: string) => kind.startsWith('local_bash') || kind.startsWith('monitor');

	function toggleOutput(id: string) {
		open = open === id ? null : id;
		if (open) onOutput(id);
	}
</script>

{#if chat.bgTasks.length || chat.sideAnswers.length}
	<div class="strip">
		{#each chat.bgTasks as task (task.id)}
			<div class="task">
				<div class="row">
					<CircleNotchIcon size={12} class="spin" />
					<span class="kind">{taskKindLabel(task.kind)}</span>
					<span class="desc" title={task.description}>{task.description}</span>
					{#if task.message}<span class="msg" title={task.message}>{task.message}</span>{/if}
					<span class="grow"></span>
					{#if onTrace && task.kind.startsWith('local_workflow')}
						<button class="link" onclick={() => onTrace(task.id)}>{t('dock.agents.open')}</button>
					{/if}
					{#if hasOutput(task.kind)}
						<button class="link" onclick={() => toggleOutput(task.id)}>
							{open === task.id ? t('chat.task.hideOutput') : t('chat.task.output')}
						</button>
					{/if}
					<button class="link" onclick={() => onStop(task.id)}>{t('chat.task.stop')}</button>
				</div>
				{#if open === task.id}
					{@const out = chat.taskOutputs[task.id]}
					<div class="out">
						{#if !out}
							<span class="dim">{t('chat.task.loading')}</span>
						{:else if out.error}
							<span class="dim">{out.error}</span>
						{:else}
							{#if out.truncated}<span class="dim">{t('chat.task.truncated')}</span>{/if}
							<pre>{out.output || t('chat.task.noOutput')}</pre>
							<button class="link" onclick={() => onOutput(task.id)}>{t('chat.task.refresh')}</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
		{#each chat.sideAnswers as a, i (i)}
			<div class="side">
				<div class="row">
					<span class="kind">{t('chat.btw.label')}</span>
					<span class="q">{a.question}</span>
					<span class="grow"></span>
					<IconButton size="sm" label={t('chat.btw.dismiss')} title={t('chat.btw.dismiss')} onclick={() => chat.sideAnswers.splice(i, 1)}>
						<XIcon size={13} />
					</IconButton>
				</div>
				{#if a.pending}
					<span class="dim"><CircleNotchIcon size={12} class="spin" /> {t('chat.btw.pending')}</span>
				{:else if a.error}
					<span class="dim">{a.error}</span>
				{:else}
					<div class="answer">{a.answer || t('chat.btw.empty')}</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.strip {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 18px;
		border-bottom: 1px solid var(--hairline);
		font-size: var(--fs-xs);
		max-height: 40vh;
		overflow-y: auto;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		color: var(--dim);
	}
	.kind {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.desc,
	.q {
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.msg {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.grow {
		flex: 1;
	}
	.link {
		flex-shrink: 0;
		border: none;
		background: none;
		padding: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.out {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		margin: 6px 0 2px 20px;
	}
	pre {
		margin: 0;
		width: 100%;
		max-height: 220px;
		overflow: auto;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		background: var(--surface2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		white-space: pre-wrap;
		word-break: break-all;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.answer {
		padding-left: 2px;
		color: var(--text);
		white-space: pre-wrap;
		line-height: 1.55;
	}
	.dim {
		color: var(--dim2);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
