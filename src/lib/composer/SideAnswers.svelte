<script lang="ts">
	// /btw answers, on the composer's top edge where the question was typed:
	// beside the conversation, never part of it. Each stays until dismissed.
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import { paneIn, rowOut } from '$lib/ui/motion';

	let { chat }: { chat: ChatState } = $props();
</script>

{#if chat.sideAnswers.length}
	<div class="side">
		{#each chat.sideAnswers as a, i (a)}
			<!-- global: the last card's exit plays as the strip goes too. -->
			<div class="card" in:paneIn out:rowOut|global>
				<div class="head">
					<span class="label">{t('chat.btw.label')}</span>
					<span class="q" title={a.question}>{a.question}</span>
					<button class="x" aria-label={t('chat.btw.dismiss')} title={t('chat.btw.dismiss')} onclick={() => chat.sideAnswers.splice(i, 1)}>
						<XIcon size={14} />
					</button>
				</div>
				{#if a.pending}
					<span class="dim"><LoaderCircleIcon size={12} class="spin" /> {t('chat.btw.pending')}</span>
				{:else if a.error}
					<span class="dim">{a.error}</span>
				{:else}
					<div class="answer selectable">{a.answer || t('chat.btw.empty')}</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.side {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: calc(var(--chat-w, 844px) + 2 * var(--chat-pad, 32px));
		width: 100%;
		margin: 0 auto 8px;
		padding: 0 var(--chat-pad, 32px);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 8px 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r);
		background: var(--surface);
		font-size: var(--fs-xs);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.label {
		flex: none;
		color: var(--dim2);
	}
	.q {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
	}
	.x {
		display: inline-flex;
		flex: none;
		padding: 3px;
		border: none;
		border-radius: var(--r);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.answer {
		max-height: 30vh;
		overflow-y: auto;
		padding-right: 4px;
		color: var(--text);
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.dim {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--dim2);
	}
	/* macOS: close first, as the window's own close button. */
	:global(:root[data-os='macos']) .x {
		order: -1;
	}
</style>
