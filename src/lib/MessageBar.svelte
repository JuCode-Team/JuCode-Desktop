<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import GitForkIcon from '@lucide/svelte/icons/git-fork';
	import { writeText } from '@tauri-apps/plugin-clipboard-manager';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';
	import { toast } from '$lib/ui/toast.svelte';

	// Under a message, shown while the message is hovered (as in t3code):
	// copy its text, fork the conversation from its turn, when it was written.
	let { text, at, onFork }: { text: string; at?: number; onFork?: () => void } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	function copy() {
		writeText(text)
			.then(() => {
				copied = true;
				clearTimeout(timer);
				timer = setTimeout(() => (copied = false), 1200);
			})
			.catch((e) => toast.error(String(e)));
	}
	$effect(() => () => clearTimeout(timer));
</script>

<div class="mbar">
	<IconButton size="xs" onclick={copy} label={t('chat.msg.copy')} title={copied ? t('chat.msg.copied') : t('chat.msg.copy')}>
		{#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}
	</IconButton>
	{#if onFork}
		<IconButton size="xs" onclick={onFork} label={t('chat.msg.fork')} title={t('chat.msg.fork')}><GitForkIcon size={14} /></IconButton>
	{/if}
	{#if at}<span class="at">{when(at)}</span>{/if}
</div>

<style>
	.mbar {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 24px;
		margin-top: 4px;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	/* Shown on the hovered message (MessageList marks it), or reached by keyboard. */
	:global(.mhover:hover) .mbar,
	.mbar:focus-within {
		opacity: 1;
	}
	.at {
		margin-left: 4px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
</style>
