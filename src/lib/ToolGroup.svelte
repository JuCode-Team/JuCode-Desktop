<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import BrainIcon from '@lucide/svelte/icons/brain';
	import Collapse from '$lib/ui/Collapse.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import ToolCard from '$lib/ToolCard.svelte';
	import { t } from '$lib/i18n';
	import type { Msg } from '$lib/chat.svelte';
	import { diffStat, editedPaths, isEdit, parseToolOutput, toolTarget, toolVerb } from '$lib/toolSummary';
	import DiffStat from '$lib/DiffStat.svelte';
	import { fmtDur } from '$lib/turnStats';

	type Tool = Extract<Msg, { kind: 'tool' }>;

	// A run of consecutive tool calls, with the reasoning between them, as one
	// card: folded, a header with the run's status, latest call and time;
	// open, the calls and reasoning in the order they happened.
	let {
		run,
		open,
		onToggle,
		onFile,
		traceOf
	}: {
		run: Msg[];
		open: boolean;
		onToggle: () => void;
		onFile?: (href: string) => void;
		traceOf?: (m: Msg) => { label: string; run: () => void } | null;
	} = $props();

	const tools = $derived(run.filter((m): m is Tool => m.kind === 'tool'));
	const failed = (x: Tool) => x.isError || typeof parseToolOutput(x.output)?.error === 'string';
	const running = $derived(tools.some((x) => x.running));
	const anyFailed = $derived(tools.some(failed));
	const latest = $derived(tools[tools.length - 1]);
	// A run that only edits files says which, and how much changed.
	const edits = $derived.by(() => {
		if (!tools.length || !tools.every((x) => isEdit(x.name))) return null;
		const files = new Set<string>();
		let add = 0;
		let del = 0;
		let counted = false;
		for (const x of tools) {
			const parsed = parseToolOutput(x.output);
			for (const p of editedPaths(parsed)) files.add(p);
			const stat = diffStat(parsed);
			if (stat) {
				counted = true;
				add += stat.add;
				del += stat.del;
			}
		}
		const names = [...files].map((p) => p.split('/').pop() || p);
		return { names, stat: counted ? { add, del } : null };
	});

	// Ticks while a call runs, for the live times.
	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(timer);
	});

	// The run's time: the union of its calls' spans, so calls running in
	// parallel count once and the reasoning between them not at all.
	const took = $derived.by(() => {
		const spans = tools
			.filter((x) => x.startedAt)
			.map((x) => [x.startedAt!, x.endedAt ?? (x.running ? now : x.startedAt!)] as const)
			.sort((a, b) => a[0] - b[0]);
		if (!spans.length) return null;
		let total = 0;
		let [from, to] = spans[0]!;
		for (const [a, b] of spans.slice(1)) {
			if (a > to) {
				total += to - from;
				from = a;
			}
			to = Math.max(to, b);
		}
		return total + to - from;
	});
</script>

{#snippet call(x: Tool, framed: boolean)}
	<ToolCard name={x.name} output={x.output} running={x.running} isError={x.isError} subagent={x.subagent} trace={traceOf?.(x) ?? undefined} startedAt={x.startedAt} endedAt={x.endedAt} {now} {framed} />
{/snippet}

{#if run.length === 1 && latest}
	{@render call(latest, true)}
{:else}
	<div class="card">
		<button class="head" class:open onclick={onToggle}>
			<span class="st">
				{#if running}<LoaderCircleIcon size={14} class="spin" />{:else if anyFailed}<XIcon size={14} class="bad" />{:else}<CheckIcon size={14} class="good" />{/if}
			</span>
			{#if edits}
				<span class="verb">{t('chat.editedFiles', { n: edits.names.length })}</span>
				{#if edits.names.length}<span class="sep">·</span><span class="target">{edits.names.join(', ')}</span>{/if}
				<span class="grow"></span>
				{#if edits.stat}<DiffStat {...edits.stat} />{/if}
			{:else}
				{#if latest}
					<span class="verb">{toolVerb(latest.name)}</span>
					<span class="target">{toolTarget(latest.name, parseToolOutput(latest.output))}</span>
				{/if}
				<span class="grow"></span>
				{#if tools.length > 1}<span class="count">{t('chat.toolGroup', { n: tools.length })}</span>{/if}
				{#if took !== null}<span class="took">{fmtDur(took)}</span>{/if}
			{/if}
			<span class="chev"><ChevronRightIcon size={14} /></span>
		</button>
		<Collapse {open}>
			<div class="rows">
				{#each run as m (m)}
					{#if m.kind === 'tool'}
						{@render call(m, false)}
					{:else if m.kind === 'reasoning'}
						<div class="reason">
							<button class="rhead" class:open={!m.collapsed} onclick={() => (m.collapsed = !m.collapsed)}>
								<span class="st"><BrainIcon size={14} /></span>
								<span>{t('chat.reasoning')}</span>
								<span class="grow"></span>
								<span class="chev"><ChevronRightIcon size={14} /></span>
							</button>
							<Collapse open={!m.collapsed}>
								<div class="reason-body"><Markdown text={m.text} {onFile} /></div>
							</Collapse>
						</div>
					{/if}
				{/each}
			</div>
		</Collapse>
	</div>
{/if}

<style>
	.card {
		border: 1px solid var(--border);
		border-radius: var(--r);
	}
	.head,
	.rhead {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.head {
		min-height: 34px;
		padding: 4px 10px;
	}
	.rhead {
		min-height: 26px;
		padding: 2px 0;
	}
	.head:hover,
	.rhead:hover {
		color: var(--text);
	}
	.st {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
	}
	.st :global(.good) {
		color: var(--ok);
	}
	.st :global(.bad) {
		color: var(--err);
	}
	.verb {
		flex-shrink: 0;
		font-weight: 500;
	}
	.target {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.grow {
		flex: 1;
	}
	.sep {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.count,
	.took {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	.chev {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim2);
		transition: transform var(--t-med) var(--ease-out);
	}
	.head.open .chev,
	.rhead.open .chev {
		transform: rotate(90deg);
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 10px 6px;
		border-top: 1px solid var(--hairline);
	}
	.reason-body {
		margin: 2px 0 6px 21px;
		color: var(--dim);
		font-style: italic;
		font-size: var(--fs-sm);
		line-height: 1.6;
		word-break: break-word;
	}
</style>
