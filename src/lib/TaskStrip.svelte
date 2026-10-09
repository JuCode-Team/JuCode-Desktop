<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import { taskKindLabel, type ChatState } from '$lib/chat.svelte';

	// Above the transcript: a session's background work and running subagents
	// as one aligned list (each with a stop button; a shell's output on
	// demand), and its /btw answers, which are beside the conversation, never
	// part of it.
	let {
		chat,
		onStop,
		onOutput,
		onTrace,
		agents = true
	}: {
		chat: ChatState;
		onStop: (id: string) => void;
		onOutput: (id: string) => void;
		/** The agent trace: one subagent's, or the run list (null). */
		onTrace?: (agentId: string | null) => void;
		/** Lists subagents that are not background tasks (off where the
		 *  progress card shows them). */
		agents?: boolean;
	} = $props();

	let open = $state<string | null>(null);
	// Shell and Monitor tasks write output the engine can read back.
	const hasOutput = (kind: string) => kind.startsWith('local_bash') || kind.startsWith('monitor');

	function toggleOutput(id: string) {
		open = open === id ? null : id;
		if (open) onOutput(id);
	}

	// Engine subagent lifecycle status → localized label (falls back to the raw value).
	const AGENT_STATUS_KEY: Record<string, string> = {
		started: 'started',
		completed: 'completed',
		done: 'completed',
		interrupted: 'interrupted',
		stopped: 'interrupted',
		failed: 'failed',
		closed: 'closed'
	};

	interface Row {
		key: string;
		/** A task the engine can stop (claude's task id). */
		task: string | null;
		/** A subagent the trace can open. */
		agent: string | null;
		kind: string;
		label: string;
		message: string;
		/** A subagent's state when not simply running. */
		status: string;
	}

	// A claude subagent is both a background task and a subagent under the
	// same id: one row, with the subagent's latest step as its message.
	const rows = $derived.by((): Row[] => {
		const ids = new Set(chat.bgTasks.map((x) => x.id));
		const fromTasks = chat.bgTasks.map((task) => {
			const sub = chat.subagents[task.id];
			return {
				key: task.id,
				task: task.id,
				agent: sub ? task.id : null,
				kind: task.kind,
				label: task.description,
				message: sub?.message || task.message,
				status: sub ? (AGENT_STATUS_KEY[sub.status] ?? '') : ''
			};
		});
		const fromAgents = Object.entries(agents ? chat.subagents : {})
			.filter(([path]) => !ids.has(path))
			.map(([path, info]) => ({
				key: path,
				task: null,
				agent: info.label ? path : null,
				kind: 'local_agent',
				label: info.label || path,
				message: info.message,
				status: AGENT_STATUS_KEY[info.status] ?? ''
			}));
		return [...fromTasks, ...fromAgents];
	});

	const counts = $derived.by(() => {
		const by = new Map<string, number>();
		for (const row of rows) {
			const label = taskKindLabel(row.kind);
			by.set(label, (by.get(label) ?? 0) + 1);
		}
		return [...by].map(([label, n]) => `${label} ${n}`).join(' · ');
	});

	// Many rows fold away by default; the user's choice holds from then on.
	let folded = $state<boolean | null>(null);
	const collapsed = $derived(folded ?? rows.length > 3);
</script>

{#if rows.length || chat.sideAnswers.length}
	<div class="strip">
		{#if rows.length}
			<button class="head" aria-expanded={!collapsed} aria-label={t('chat.task.list')} onclick={() => (folded = !collapsed)}>
				<span class="caret" class:open={!collapsed}><CaretRightIcon size={11} /></span>
				<CircleNotchIcon size={12} class="spin" />
				<span>{counts}</span>
			</button>
		{/if}
		{#if rows.length && !collapsed}
			<div class="list">
				{#each rows as row (row.key)}
					<div class="row">
						<span class="kind">{taskKindLabel(row.kind)}</span>
						{#if row.agent && onTrace}
							<button class="desc link-text" title={t('dock.agents.openAgent')} onclick={() => onTrace(row.agent)}>{row.label}</button>
						{:else}
							<span class="desc" title={row.label}>{row.label}</span>
						{/if}
						<span class="msg" title={row.message}>{row.status ? t(`shell.agentStatus.${row.status}`) : row.message}</span>
						<span class="acts">
							{#if onTrace && row.kind.startsWith('local_workflow')}
								<button class="link" onclick={() => onTrace(null)}>{t('dock.agents.open')}</button>
							{/if}
							{#if row.task && hasOutput(row.kind)}
								<button class="link" onclick={() => toggleOutput(row.key)}>
									{open === row.key ? t('chat.task.hideOutput') : t('chat.task.output')}
								</button>
							{/if}
							{#if row.task}
								{@const id = row.task}
								<button class="link" onclick={() => onStop(id)}>{t('chat.task.stop')}</button>
							{/if}
						</span>
					</div>
					{#if open === row.key}
						{@const out = chat.taskOutputs[row.key]}
						<div class="out">
							{#if !out}
								<span class="dim">{t('chat.task.loading')}</span>
							{:else if out.error}
								<span class="dim">{out.error}</span>
							{:else}
								{#if out.truncated}<span class="dim">{t('chat.task.truncated')}</span>{/if}
								<pre>{out.output || t('chat.task.noOutput')}</pre>
								<button class="link" onclick={() => onOutput(row.key)}>{t('chat.task.refresh')}</button>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
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
	}
	.head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.head:hover {
		color: var(--text);
	}
	.caret {
		display: inline-flex;
		transition: transform 0.15s;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	/* Columns line up across rows: kind, name, latest step, actions. */
	.list {
		display: grid;
		grid-template-columns: auto minmax(0, max-content) minmax(0, 1fr) auto;
		column-gap: 12px;
		max-height: 30vh;
		overflow-y: auto;
		padding-left: 17px;
	}
	.row {
		display: contents;
	}
	.row > * {
		padding: 3px 0;
		min-width: 0;
	}
	.kind {
		color: var(--dim2);
		white-space: nowrap;
	}
	.desc,
	.q {
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.desc {
		max-width: 32ch;
	}
	.link-text {
		border: none;
		background: none;
		margin: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.link-text:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.msg {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.6;
		color: var(--dim2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
	}
	/* With a pointer, a row's actions show when it is hovered: a column of
	   identical stop buttons is noise. */
	@media (hover: hover) {
		.acts {
			opacity: 0;
		}
		.row:hover .acts,
		.acts:focus-within {
			opacity: 1;
		}
	}
	.side .row {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--dim);
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
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		margin: 4px 0 6px;
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
