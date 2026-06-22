<script lang="ts">
	import { Send, Square, Paperclip, X, FileText } from 'lucide-svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import Vendor from '$lib/Vendor.svelte';
	import ContextRing from '$lib/ContextRing.svelte';
	import EffortSlider from '$lib/EffortSlider.svelte';
	import type { ChatState } from '$lib/chat.svelte';

	let {
		chat,
		input = $bindable(),
		attachments = $bindable(),
		el = $bindable(),
		onSubmit,
		onStop,
		onPick,
		onModel,
		onEffort
	}: {
		chat: ChatState;
		input: string;
		attachments: { path: string; image: boolean }[];
		el: HTMLTextAreaElement | null;
		onSubmit: () => void;
		onStop: () => void;
		onPick: () => void;
		onModel: () => void;
		onEffort: (ef: string) => void;
	} = $props();

	let slashIdx = $state(0);
	let showEffort = $state(false);

	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

	const slashMatches = $derived.by(() => {
		const t = input.trim();
		if (!t.startsWith('/') || t.includes(' ')) return [];
		return chat.commands.filter((c) => c.command.startsWith(t) && c.command !== t).slice(0, 8);
	});
	$effect(() => {
		slashMatches;
		slashIdx = 0;
	});

	const ctxPct = $derived(
		chat.contextWindow > 0 ? Math.min(100, Math.round((chat.contextTokens / chat.contextWindow) * 100)) : 0
	);

	function onKey(e: KeyboardEvent) {
		if (slashMatches.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				slashIdx = (slashIdx + 1) % slashMatches.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				slashIdx = (slashIdx - 1 + slashMatches.length) % slashMatches.length;
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				input = slashMatches[slashIdx].command + ' ';
				return;
			}
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSubmit();
		}
	}
</script>

<div class="composer-wrap">
	{#if slashMatches.length}
		<div class="slash">
			{#each slashMatches as c, i (c.command)}
				<button class="slash-item" class:sel={i === slashIdx} onclick={() => (input = c.command + ' ')} onmouseenter={() => (slashIdx = i)}>
					<span class="slash-cmd">{c.command}</span>
					{#if c.args}<span class="slash-args">{c.args}</span>{/if}
					{#if c.description}<span class="slash-desc">{c.description}</span>{/if}
					{#if c.marker}<span class="slash-marker">{c.marker}</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
	{#if attachments.length}
		<div class="chips">
			{#each attachments as a, i (a.path)}
				<span class="chip" class:imgchip={a.image}>
					{#if a.image}<img class="chip-thumb" src={convertFileSrc(a.path)} alt="" />{:else}<FileText size={12} />{/if}
					<span class="chip-name">{base(a.path)}</span>
					<button class="chip-x" onclick={() => attachments.splice(i, 1)} aria-label="remove"><X size={12} /></button>
				</span>
			{/each}
		</div>
	{/if}
	<div class="composer">
		<textarea bind:this={el} bind:value={input} onkeydown={onKey} rows="1" placeholder="给 JuCode 指派一个任务…  (拖入或点回形针附加文件 · / 唤起命令)"></textarea>
		<div class="composer-bar">
			<button class="cbtn" onclick={onPick} aria-label="attach" title="attach files"><Paperclip size={16} /></button>
			<button class="flatbtn model" onclick={onModel} title="switch model">
				<Vendor model={chat.model} size={15} /><span>{chat.model || 'model'}</span>
			</button>
			{#if chat.efforts.length}
				<div class="effortsel">
					<button class="flatbtn" onclick={() => (showEffort = !showEffort)} title="thinking effort">
						{cap(chat.effort) || 'Effort'}
					</button>
					{#if showEffort}
						<button class="pop-backdrop" aria-label="close" onclick={() => (showEffort = false)}></button>
						<div class="effort-pop">
							<EffortSlider efforts={chat.efforts} current={chat.effort} onChange={onEffort} />
						</div>
					{/if}
				</div>
			{/if}
			<div class="cspace"></div>
			{#if chat.contextWindow > 0}<ContextRing pct={ctxPct} label={`context ${fmtTokens(chat.contextTokens)} / ${fmtTokens(chat.contextWindow)}`} />{/if}
			{#if chat.busy}
				<button class="cact stop" onclick={onStop} aria-label="stop"><Square size={15} /></button>
			{:else}
				<button class="cact send" onclick={onSubmit} disabled={!input.trim() && !attachments.length} aria-label="send"><Send size={16} /></button>
			{/if}
		</div>
	</div>
</div>

<style>
	.composer-wrap {
		padding: 0 18px 18px;
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
	}
	.composer {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		padding: 12px 14px 10px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	textarea {
		width: 100%;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: 14px;
		line-height: 1.55;
		max-height: 180px;
		padding: 2px 0 8px;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	.composer-bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cbtn {
		display: inline-flex;
		padding: 7px;
		border: none;
		background: none;
		color: var(--dim);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.cbtn:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.flatbtn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-size: 13px;
		font-family: var(--font-sans);
		cursor: pointer;
	}
	.flatbtn:hover {
		background: var(--surface2);
	}
	.flatbtn.model span {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.effortsel {
		position: relative;
		display: inline-flex;
	}
	.pop-backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 20;
		cursor: default;
	}
	.effort-pop {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: 21;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
		animation: rise 0.12s ease;
	}
	.cspace {
		flex: 1;
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: var(--r-md);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
	}
	.cact.send {
		background: linear-gradient(145deg, var(--accent-bright), var(--accent));
		color: var(--on-accent);
		box-shadow: 0 4px 14px var(--accent-soft);
	}
	.cact.send:disabled {
		opacity: 0.4;
		box-shadow: none;
		cursor: default;
	}
	.cact.stop {
		background: var(--surface2);
		border: 1px solid var(--border);
		color: var(--err);
	}

	.slash {
		margin-bottom: 8px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		overflow: hidden;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}
	.slash-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		border: none;
		background: none;
		color: var(--text);
		cursor: pointer;
		font-size: 13px;
	}
	.slash-item.sel {
		background: var(--surface2);
	}
	.slash-cmd {
		font-family: var(--font-mono);
		flex-shrink: 0;
	}
	.slash-args {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.slash-desc {
		flex: 1;
		color: var(--dim);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.slash-marker {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--accent-bright);
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-family: var(--font-mono);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 3px 5px 3px 8px;
		max-width: 200px;
	}
	.chip.imgchip {
		padding: 3px 5px 3px 3px;
	}
	.chip-thumb {
		width: 26px;
		height: 26px;
		border-radius: 4px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.chip-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip-x {
		display: inline-flex;
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		padding: 1px;
	}
	.chip-x:hover {
		color: var(--text);
	}
</style>
