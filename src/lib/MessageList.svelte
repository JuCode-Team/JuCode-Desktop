<script lang="ts">
	import { Pencil, Copy, Check, ChevronRight } from 'lucide-svelte';
	import Markdown from '$lib/Markdown.svelte';
	import ToolCard from '$lib/ToolCard.svelte';
	import type { Msg } from '$lib/chat.svelte';

	let {
		messages,
		streamingMsg,
		thinking,
		onEdit
	}: {
		messages: Msg[];
		streamingMsg: Msg | null;
		thinking: boolean;
		onEdit: (text: string) => void;
	} = $props();

	let copied = $state<unknown>(null);
	function copy(text: string, m: unknown) {
		navigator.clipboard?.writeText(text).catch(() => {});
		copied = m;
		setTimeout(() => {
			if (copied === m) copied = null;
		}, 1500);
	}

	const fmtDur = (ms: number) =>
		ms < 1000
			? `${ms}ms`
			: ms < 60000
				? `${(ms / 1000).toFixed(1)}s`
				: `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;

	// Skip empty placeholders (e.g. an assistant message before its first delta).
	function shown(m: Msg): boolean {
		if (m.kind === 'tool') return !!(m.name || m.output);
		return !!m.text && m.text.trim().length > 0;
	}
</script>

<div class="list">
	{#each messages as m (m)}
		{#if !shown(m)}
			<!-- empty placeholder -->
		{:else if m.kind === 'user'}
			<div class="row user">
				<button class="uedit" onclick={() => onEdit(m.text)} aria-label="edit" title="编辑重发"><Pencil size={12} /></button>
				<div class="bubble">{m.text}</div>
			</div>
		{:else if m.kind === 'assistant'}
			<div class="answer">
				{#if m === streamingMsg}
					<div class="stream">{m.text}</div>
				{:else}
					<Markdown text={m.text} />
					<div class="foot">
						{#if m.elapsed}<span class="mono">{fmtDur(m.elapsed)}</span>{/if}
						{#if m.tokens}<span class="mono">{m.tokens} tokens</span>{/if}
						<button class="copy" onclick={() => copy(m.text, m)} aria-label="copy">
							{#if copied === m}<Check size={13} /> 已复制{:else}<Copy size={13} /> 复制{/if}
						</button>
					</div>
				{/if}
			</div>
		{:else if m.kind === 'reasoning'}
			<div class="reason" class:open={!m.collapsed}>
				<button class="reason-head" onclick={() => (m.collapsed = !m.collapsed)}>
					<span class="rchev"><ChevronRight size={13} /></span>
					<span>推理</span>
				</button>
				{#if !m.collapsed}<div class="reason-body">{m.text}</div>{/if}
			</div>
		{:else if m.kind === 'tool'}
			<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} />
		{:else if m.kind === 'system'}
			<div class="system">{m.text}</div>
		{:else if m.kind === 'error'}
			<div class="error">{m.text}</div>
		{/if}
	{/each}
	{#if thinking}
		<div class="thinking" aria-label="thinking"><span class="td"></span><span class="td"></span><span class="td"></span></div>
	{/if}
</div>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.row {
		display: flex;
	}
	.row.user {
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
	}
	.uedit {
		opacity: 0;
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: 5px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.row.user:hover .uedit {
		opacity: 1;
	}
	.uedit:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.bubble {
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: 14px 14px 4px 14px;
		padding: 11px 14px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 78%;
	}
	.answer {
		line-height: 1.65;
		word-break: break-word;
	}
	.stream {
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.65;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
		font-size: 11px;
		color: var(--dim2);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.copy {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: none;
		background: none;
		color: var(--dim2);
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 5px;
		font-size: 11px;
	}
	.copy:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.reason {
		border-left: 2px solid var(--hairline);
		padding-left: 12px;
	}
	.reason-head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.reason-head:hover {
		color: var(--text);
	}
	.rchev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform 0.12s;
	}
	.reason.open .rchev {
		transform: rotate(90deg);
	}
	.reason-body {
		margin-top: 4px;
		color: var(--dim);
		font-size: 13px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.system {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--dim2);
		text-align: center;
	}
	.error {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--err) 32%, transparent);
		padding: 9px 12px;
		border-radius: var(--r-sm);
	}
	.thinking {
		display: flex;
		gap: 5px;
		padding: 6px 2px;
	}
	.td {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent-bright);
		animation: tdot 1s ease-in-out infinite;
	}
	.td:nth-child(2) {
		animation-delay: 0.16s;
	}
	.td:nth-child(3) {
		animation-delay: 0.32s;
	}
	@keyframes tdot {
		0%,
		100% {
			opacity: 0.3;
			transform: translateY(0);
		}
		50% {
			opacity: 1;
			transform: translateY(-3px);
		}
	}
</style>
