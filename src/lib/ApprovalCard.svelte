<script lang="ts">
	import { ShieldAlert, ChevronRight, Bot, MessageCircleQuestion, Check, ClipboardList, Copy, Download } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import {
		allHunkIds,
		buildApproveOp,
		selectionState,
		toggleHunk,
		type ApprovalHunk,
		type ApproveOp,
		type Question
	} from '$lib/approval';

	let {
		approval,
		onRespond
	}: {
		approval: {
			callId: string;
			name: string;
			summary: string;
			subagentId: string | null;
			hunks: ApprovalHunk[] | null;
			questions?: Question[] | null;
		};
		onRespond: (op: ApproveOp) => void;
	} = $props();

	// --- AskUserQuestion: an interactive picker instead of allow/deny ---
	const questions = $derived(approval.questions ?? null);
	let picks = $state<Record<number, string[]>>({});
	// svelte-ignore state_referenced_locally -- deliberate: tracks the last-seen request identity
	let seenQCallId = approval.callId;
	$effect.pre(() => {
		if (approval.callId === seenQCallId) return;
		seenQCallId = approval.callId;
		picks = {};
	});
	function pickOption(qi: number, label: string, multi: boolean) {
		const cur = picks[qi] ?? [];
		if (multi) picks[qi] = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
		else picks[qi] = [label];
	}
	const answersReady = $derived(!!questions && questions.every((_, i) => (picks[i]?.length ?? 0) > 0));
	function submitAnswers() {
		if (!questions || !answersReady) return;
		const answers: Record<string, string> = {};
		for (let i = 0; i < questions.length; i++) answers[questions[i].question] = (picks[i] ?? []).join(', ');
		onRespond({ op: 'approve', call_id: approval.callId, decision: 'allow', answers });
	}

	const isShell = $derived(
		['bash', 'execute', 'exec_command', 'shell_command'].includes(approval.name)
	);
	// ExitPlanMode: the model is proposing a plan and asking to leave plan mode.
	// Render the plan markdown with copy/download actions instead of a raw diff.
	const isPlan = $derived(approval.name === 'ExitPlanMode' || approval.name === 'update_plan');
	let copied = $state(false);
	async function copyPlan() {
		try {
			await navigator.clipboard.writeText(approval.summary);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			/* clipboard blocked — ignore */
		}
	}
	function downloadPlan() {
		const blob = new Blob([approval.summary], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'plan.md';
		a.click();
		URL.revokeObjectURL(url);
	}
	// Per-hunk selection only kicks in for multi-hunk edits; a single hunk (or a
	// non-edit tool) keeps the whole-call card, incl. 始终允许 (the engine rejects
	// always+hunks, so the hunk card never offers it).
	const hunks = $derived(approval.hunks ?? []);
	const multiHunk = $derived(hunks.length > 1);

	// Per-request defaults: everything selected; diffs expanded when the list is
	// short (≤3), collapsed beyond that. The card is remounted per request
	// ({#key callId} at the call site) so plain initializers are enough; the
	// effect below is a guard for an unkeyed rerender with a new request (it
	// depends only on the request identity, so user toggles never re-trigger it).
	const defaults = (hs: ApprovalHunk[] | null) => ({
		selected: allHunkIds(hs ?? []),
		expanded: Object.fromEntries((hs ?? []).map((h) => [h.id, (hs ?? []).length <= 3]))
	});
	// svelte-ignore state_referenced_locally -- deliberate: per-request initial value, reset via the effect below
	let selected = $state<string[]>(defaults(approval.hunks).selected);
	// svelte-ignore state_referenced_locally -- deliberate: per-request initial value, reset via the effect below
	let expanded = $state<Record<string, boolean>>(defaults(approval.hunks).expanded);
	// svelte-ignore state_referenced_locally -- deliberate: tracks the last-seen request identity
	let seenCallId = approval.callId;
	$effect.pre(() => {
		if (approval.callId === seenCallId) return;
		seenCallId = approval.callId;
		({ selected, expanded } = defaults(approval.hunks));
	});

	const selState = $derived(selectionState(hunks, selected));

	const lineCls = (line: string) =>
		line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
</script>

<div class="approval" class:ask={!!questions} class:plan={isPlan}>
	<div class="approval-head">
		{#if questions}
			<MessageCircleQuestion size={15} />
			<span>{t('shell.askQuestion')}</span>
		{:else if isPlan}
			<ClipboardList size={15} />
			<span>{t('shell.proposePlan')}</span>
		{:else}
			<ShieldAlert size={15} />
			<span
				>{isShell ? t('shell.approveCommand') : t('shell.approveFile')} · <b>{approval.name}</b
				></span
			>
		{/if}
		{#if multiHunk}
			<span class="hunk-count">{t('shell.hunkCount', { n: hunks.length })}</span>
		{/if}
		{#if approval.subagentId}
			<span class="subagent-chip" title={approval.subagentId}
				><Bot size={11} />{t('chat.subagentChip', { id: approval.subagentId })}</span
			>
		{/if}
	</div>

	{#if questions}
		<div class="questions">
			{#each questions as q, qi (qi)}
				<div class="q">
					<div class="q-text">{q.question}</div>
					<div class="q-opts">
						{#each q.options as o (o.label)}
							{@const on = (picks[qi] ?? []).includes(o.label)}
							<button class="q-opt" class:on onclick={() => pickOption(qi, o.label, q.multiSelect)}>
								<span class="q-mark" class:multi={q.multiSelect}>{#if on}<Check size={12} />{/if}</span>
								<span class="q-body">
									<span class="q-label">{o.label}</span>
									{#if o.description}<span class="q-desc">{o.description}</span>{/if}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<div class="approval-actions">
			<Button variant="primary" size="sm" disabled={!answersReady} onclick={submitAnswers}>{t('shell.answerSubmit')}</Button>
			<Button variant="danger" size="sm" onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}>{t('shell.answerCancel')}</Button>
		</div>
	{:else if isPlan}
		<div class="plan-body">
			<Markdown text={approval.summary} />
		</div>
		<div class="approval-actions">
			<Button
				variant="primary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow'))}
				>{t('shell.approvePlan')}</Button
			>
			<Button
				variant="danger"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}
				>{t('shell.keepPlanning')}</Button
			>
			<span class="plan-spacer"></span>
			<button class="plan-util" onclick={copyPlan}>
				{#if copied}<Check size={13} />{t('shell.copiedPlan')}{:else}<Copy size={13} />{t('shell.copyPlan')}{/if}
			</button>
			<button class="plan-util" onclick={downloadPlan}><Download size={13} />{t('shell.downloadPlan')}</button>
		</div>
	{:else if multiHunk}
		<div class="hunks">
			{#each hunks as h (h.id)}
				<div class="hunk" class:off={!selected.includes(h.id)}>
					<div class="hunk-row">
						<label class="hunk-pick">
							<input
								type="checkbox"
								checked={selected.includes(h.id)}
								onchange={() => (selected = toggleHunk(selected, h.id))}
							/>
							<span class="hunk-file">{h.file}</span>
							<span class="hunk-header">{h.header}</span>
						</label>
						<button
							class="hunk-toggle"
							aria-label={t('shell.toggleDiff')}
							title={t('shell.toggleDiff')}
							onclick={() => (expanded[h.id] = !expanded[h.id])}
						>
							<span class="chev" class:open={expanded[h.id]}><ChevronRight size={13} /></span>
						</button>
					</div>
					{#if expanded[h.id]}
						<pre class="diff">{#each h.lines as line, i (i)}<span class={lineCls(line)}>{line}
</span>{/each}</pre>
					{/if}
				</div>
			{/each}
		</div>
		{#if selState === 'none'}
			<div class="none-hint">{t('shell.noneSelectedHint')}</div>
		{/if}
		<div class="approval-actions">
			<Button
				variant="primary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow'))}
				>{t('shell.allowAll')}</Button
			>
			<Button
				variant="secondary"
				size="sm"
				disabled={selState !== 'some'}
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow', { hunks: selected }))}
				>{t('shell.allowSelected', { n: selected.length })}</Button
			>
			<Button
				variant="danger"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}>{t('shell.deny')}</Button
			>
		</div>
	{:else}
		{#if approval.summary}
			<pre class="approval-sum" class:cmd={isShell}>{isShell
					? `$ ${approval.summary}`
					: approval.summary}</pre>
		{/if}
		<div class="approval-actions">
			<Button
				variant="primary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow'))}
				>{t('shell.allowOnce')}</Button
			>
			<Button
				variant="secondary"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'allow', { always: true }))}
				>{t('shell.allowAlways')}</Button
			>
			<Button
				variant="danger"
				size="sm"
				onclick={() => onRespond(buildApproveOp(approval.callId, 'deny'))}>{t('shell.deny')}</Button
			>
		</div>
	{/if}
</div>

<style>
	.approval {
		padding: 12px 14px;
		background: color-mix(in oklab, var(--warn) 9%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--warn) 38%, transparent);
		border-radius: var(--r-md);
	}
	/* AskUserQuestion uses the accent (not the warn) palette — it's a prompt. */
	.approval.ask {
		background: color-mix(in oklab, var(--accent) 8%, var(--panel));
		border-color: color-mix(in oklab, var(--accent) 38%, transparent);
	}
	.approval.ask .approval-head {
		color: var(--accent-bright);
	}
	.approval.plan {
		background: color-mix(in oklab, var(--accent) 6%, var(--panel));
		border-color: color-mix(in oklab, var(--accent) 32%, transparent);
	}
	.approval.plan .approval-head {
		color: var(--accent-bright);
	}
	.plan-body {
		margin-top: 10px;
		padding: 10px 12px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		font-size: 13px;
		max-height: 340px;
		overflow-y: auto;
	}
	.plan-spacer {
		flex: 1;
	}
	.plan-util {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		font-size: 11.5px;
		color: var(--dim);
		background: none;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.plan-util:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.approval-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--warn);
	}
	.questions {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 10px;
	}
	.q-text {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 7px;
	}
	.q-opts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.q-opt {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--sidebar);
		color: var(--text);
		cursor: pointer;
		transition: border-color 0.12s ease, background 0.12s ease;
	}
	.q-opt:hover {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.q-opt.on {
		border-color: var(--accent);
		background: color-mix(in oklab, var(--accent) 12%, var(--sidebar));
	}
	.q-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		margin-top: 1px;
		border: 1.5px solid var(--border);
		border-radius: 999px;
		color: var(--on-accent);
	}
	.q-mark.multi {
		border-radius: 4px;
	}
	.q-opt.on .q-mark {
		background: var(--accent);
		border-color: var(--accent);
	}
	.q-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.q-label {
		font-size: 13px;
		font-weight: 500;
	}
	.q-desc {
		font-size: 12px;
		color: var(--dim);
		line-height: 1.4;
	}
	.approval-head b {
		font-family: var(--font-mono);
		color: var(--text);
	}
	.hunk-count {
		font-size: 11px;
		color: var(--dim);
	}
	.subagent-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		padding: 1px 7px;
		font-size: 10.5px;
		font-family: var(--font-mono);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		max-width: 200px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.approval-sum {
		margin: 8px 0 0;
		padding: 8px 10px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
	}
	.approval-sum.cmd {
		color: var(--text);
		border-left: 2px solid var(--warn);
	}
	.approval-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	/* --- hunk list --- */
	.hunks {
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 300px;
		overflow-y: auto;
	}
	.hunk {
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.hunk.off {
		opacity: 0.55;
	}
	.hunk-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
	}
	.hunk-pick {
		display: flex;
		align-items: center;
		gap: 7px;
		flex: 1;
		min-width: 0;
		cursor: pointer;
		font-size: 11.5px;
	}
	.hunk-pick input {
		accent-color: var(--accent);
		margin: 0;
		flex-shrink: 0;
	}
	.hunk-file {
		font-family: var(--font-mono);
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hunk-header {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--accent);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.hunk-toggle {
		display: inline-flex;
		padding: 3px;
		border: none;
		background: none;
		color: var(--dim);
		cursor: pointer;
		flex-shrink: 0;
	}
	.chev {
		display: inline-flex;
		transition: transform 0.12s;
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.none-hint {
		margin-top: 8px;
		font-size: 11.5px;
		color: var(--err);
	}
	/* Diff rendering, matching ToolCard's diff styles. */
	.diff {
		margin: 0;
		padding: 6px 10px;
		border-top: 1px solid var(--hairline);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.45;
		color: var(--text);
		max-height: 160px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.diff .add {
		color: var(--ok);
		background: color-mix(in oklch, var(--ok) 10%, transparent);
		display: block;
	}
	.diff .del {
		color: var(--err);
		background: color-mix(in oklch, var(--err) 10%, transparent);
		display: block;
	}
	.diff .ctx {
		display: block;
	}
</style>
