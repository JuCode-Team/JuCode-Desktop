<script lang="ts">
	// A subagent call in the conversation: a spawn (spawn_agent, claude's Task /
	// Agent) as the agent it started — name, the task's first line, its state
	// and its latest action — and a wait as the agents it waits on with
	// theirs. A click shows the agent's own conversation.
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import HourglassMediumIcon from 'phosphor-svelte/lib/HourglassMediumIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { t } from '$lib/i18n';
	import {
		agentOfCall,
		shortPath,
		spawnPayload,
		WAIT_TOOLS,
		waitTargets,
		type AgentRow
	} from '$lib/agentProgress';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';

	let {
		name,
		callId,
		output,
		args = '',
		running,
		isError,
		rows,
		onOpen
	}: {
		name: string;
		callId: string;
		output: string;
		args?: string;
		running: boolean;
		isError: boolean;
		/** Every subagent of the conversation (see agentRows). */
		rows: AgentRow[];
		onOpen?: (row: AgentRow) => void;
	} = $props();

	const wait = $derived(WAIT_TOOLS.has(name));
	const row = $derived(wait ? undefined : agentOfCall(rows, callId));
	const payload = $derived.by(() => {
		const a = spawnPayload(args);
		const o = spawnPayload(output);
		return { name: a.name || o.name, task: a.task || o.task, path: o.path || a.path };
	});
	// A spawn whose agent the rows do not know by its call: by its path.
	const agent = $derived(row ?? (payload.path ? rows.find((r) => r.id === payload.path) : undefined));
	const label = $derived(agent?.label || shortPath(payload.name || payload.path) || t('chat.subagentCard.spawn'));
	const task = $derived((payload.task || agent?.prompt || '').split('\n').find((l) => l.trim())?.trim() ?? '');
	const state = $derived(agent?.state ?? (isError ? 'failed' : running ? 'running' : 'unknown'));
	const activity = $derived(isError ? errorLine(output) : running && !agent ? t('chat.subagentCard.starting') : agent?.activity || '');

	// The agents a wait names, with their state now (the trace's, else the
	// wait's own answer).
	const targets = $derived(
		wait
			? waitTargets(output).map((w) => {
					const known = rows.find((r) => r.id === w.id || r.label === shortPath(w.id) || r.label === w.id);
					return { id: w.id, label: known?.label ?? shortPath(w.id), state: known?.state ?? w.state, row: known, timedOut: w.timedOut };
				})
			: []
	);
	// While a wait runs it names no one yet: the agents running now.
	const waitingOn = $derived(
		targets.length ? targets : running ? rows.filter((r) => r.state === 'running').map((r) => ({ id: r.id, label: r.label, state: r.state, row: r, timedOut: false })) : []
	);
	const timedOut = $derived(targets.some((x) => x.timedOut));

	function errorLine(out: string): string {
		try {
			const o = JSON.parse(out) as Record<string, unknown>;
			if (typeof o.error === 'string') return o.error;
		} catch {
			/* plain text */
		}
		return out.split('\n')[0] ?? '';
	}
</script>

{#if wait}
	<div class="sa wait">
		<div class="head">
			<span class="ico"><HourglassMediumIcon size={14} /></span>
			<span class="title">{waitingOn.length ? t('chat.subagentCard.waitN', { n: waitingOn.length }) : t('chat.subagentCard.wait')}</span>
			{#if timedOut}<span class="tag">{t('chat.subagentCard.timedOut')}</span>{/if}
			{#if running}<StateIcon state="running" size={12} />{/if}
		</div>
		{#if waitingOn.length}
			<div class="targets">
				{#each waitingOn as w (w.id)}
					<button class="target" disabled={!onOpen || !w.row} onclick={() => w.row && onOpen?.(w.row)} title={w.id}>
						<StateIcon state={w.state} size={12} label={t(`dock.agents.state.${w.state === 'unknown' ? 'queued' : w.state}`)} />
						<span>{w.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<button class="sa spawn" class:link={!!onOpen && !!agent} disabled={!onOpen || !agent} onclick={() => agent && onOpen?.(agent)} aria-label={t('chat.progress.open', { name: label })}>
		<span class="ico"><RobotIcon size={15} /></span>
		<span class="col">
			<span class="line">
				<span class="name">{label}</span>
				{#if agent?.model}<span class="model">{agent.model.replace(/^claude-/, '')}</span>{/if}
				<span class="grow"></span>
				{#if agent}<Elapsed row={agent} />{/if}
				<StateIcon state={state} size={14} label={state === 'unknown' ? '' : t(`dock.agents.state.${state}`)} />
			</span>
			{#if task}<span class="task">{task}</span>{/if}
			{#if activity}<span class="act" class:err={state === 'failed'}>{activity}</span>{/if}
		</span>
		{#if onOpen && agent}<span class="go"><CaretRightIcon size={13} /></span>{/if}
	</button>
{/if}

<style>
	.sa {
		display: flex;
		max-width: min(560px, 100%);
		border-radius: var(--r-lg);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text);
	}
	.spawn {
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border: none;
		text-align: left;
		font: inherit;
		cursor: default;
		transition: background var(--t-fast) var(--ease-out);
	}
	.spawn.link {
		cursor: pointer;
	}
	.spawn.link:hover {
		background: var(--surface2);
	}
	.wait {
		flex-direction: column;
		gap: 6px;
		padding: 8px 12px;
		background: none;
	}
	.ico {
		display: inline-flex;
		flex: none;
		margin-top: 2px;
		color: var(--dim);
	}
	.wait .ico {
		margin-top: 0;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.line,
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--dim);
	}
	.model {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.grow {
		flex: 1;
	}
	.task {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.act {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.act.err {
		color: var(--err);
	}
	.tag {
		font-size: var(--fs-2xs);
		color: var(--warn);
	}
	.go {
		display: inline-flex;
		align-self: center;
		color: var(--dim2);
	}
	.targets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-left: 21px;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		border: none;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.target:disabled {
		cursor: default;
	}
	.target:hover:not(:disabled) {
		background: color-mix(in oklab, var(--text) 10%, transparent);
	}
</style>
