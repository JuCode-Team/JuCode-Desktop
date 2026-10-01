<script lang="ts">
	// A session's status mark (sessionStatus.ts), for sidebar rows and canvas
	// tabs. Each state has its own shape; colour only where it carries meaning
	// (a failure). The dot is kept for one thing: a reply not seen yet.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import HandIcon from 'phosphor-svelte/lib/HandIcon';
	import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDotsIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import { t } from '$lib/i18n';
	import type { SessionStatus } from '$lib/sessionStatus';
	import { describeError, stripEngineHint } from '$lib/errorInfo';

	let { status, compact = false }: { status: SessionStatus; compact?: boolean } = $props();

	const size = $derived(compact ? 12 : 14);
</script>

{#if status?.kind === 'input'}
	{@const label = status.ask === 'answer' ? t('shell.status.answer') : t('shell.status.approve')}
	<span class="mark input" class:compact title={label} aria-label={label}>
		{#if status.ask === 'answer'}<ChatCircleDotsIcon size={size - 1} weight="bold" />{:else}<HandIcon size={size - 1} weight="bold" />{/if}
		{#if !compact}<span>{label}</span>{/if}
	</span>
{:else if status?.kind === 'failed'}
	{@const known = describeError(status.message)}
	{@const tip = known ? t(`chat.err.${known.kind}.title`, { subject: known.subject ?? t('chat.err.thisTool') }) : stripEngineHint(status.message)}
	<span class="mark failed" title={tip || t('shell.status.failed')} aria-label={t('shell.status.failed')}>
		<WarningCircleIcon {size} weight="bold" />
	</span>
{:else if status?.kind === 'running'}
	<span class="mark running" title={t('shell.status.running')} aria-label={t('shell.status.running')}>
		<CircleNotchIcon {size} class="spin" />
	</span>
{:else if status?.kind === 'unread'}
	<span class="mark unread" class:compact title={t('shell.unread')} aria-label={t('shell.unread')}></span>
{/if}

<style>
	.mark {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	/* Waiting on the user: the one mark with words, its outline breathing. */
	.input {
		gap: 4px;
		height: 20px;
		padding: 0 7px 0 5px;
		border-radius: var(--r-full);
		background: var(--accent-soft);
		color: var(--text);
		font-size: var(--fs-2xs);
		font-weight: 500;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 30%, transparent);
		animation: ask 2.4s var(--ease-out) infinite;
	}
	.input.compact {
		width: 18px;
		height: 18px;
		padding: 0;
		justify-content: center;
		border-radius: var(--r-xs);
	}
	@keyframes ask {
		50% {
			box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 70%, transparent);
		}
	}
	.failed {
		color: var(--err);
	}
	.running {
		color: var(--dim);
	}
	.unread {
		width: 6px;
		height: 6px;
		margin: 0 4px;
		border-radius: 50%;
		background: var(--text);
	}
	.unread.compact {
		margin: 0 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.input {
			animation: none;
		}
	}
</style>
