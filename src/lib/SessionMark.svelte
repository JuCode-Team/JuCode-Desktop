<script lang="ts">
	// A session's status mark (sessionStatus.ts), for sidebar rows and canvas
	// tabs. Each state has its own shape; colour only where it carries meaning
	// (a failure). The dot is kept for one thing: a reply not seen yet.
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import HandIcon from '@lucide/svelte/icons/hand';
	import MessageCircleMoreIcon from '@lucide/svelte/icons/message-circle-more';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import { t } from '$lib/i18n';
	import type { SessionStatus } from '$lib/sessionStatus';
	import { describeError, stripEngineHint } from '$lib/errorInfo';

	let { status }: { status: SessionStatus } = $props();

	const size = 14;
</script>

{#if status?.kind === 'input'}
	{@const label = status.ask === 'answer' ? t('shell.status.answer') : t('shell.status.approve')}
	<span class="mark input" title={label} aria-label={label}>
		{#if status.ask === 'answer'}<MessageCircleMoreIcon size={size - 1} />{:else}<HandIcon size={size - 1} />{/if}
		<span>{label}</span>
	</span>
{:else if status?.kind === 'failed'}
	{@const known = describeError(status.message)}
	{@const tip = known ? t(`chat.err.${known.kind}.title`, { subject: known.subject ?? t('chat.err.thisTool') }) : stripEngineHint(status.message)}
	<span class="mark failed" title={tip || t('shell.status.failed')} aria-label={t('shell.status.failed')}>
		<CircleAlertIcon {size} />
	</span>
{:else if status?.kind === 'running'}
	<span class="mark running" title={t('shell.status.running')} aria-label={t('shell.status.running')}>
		<LoaderCircleIcon {size} class="spin" />
	</span>
{:else if status?.kind === 'background'}
	<span class="mark running" title={t('shell.status.background')} aria-label={t('shell.status.background')}>
		<LayersIcon {size} />
	</span>
{:else if status?.kind === 'unread'}
	<span class="mark unread" title={t('shell.unread')} aria-label={t('shell.unread')}></span>
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
		border-radius: var(--r);
		background: var(--accent-soft);
		color: var(--text);
		font-size: var(--fs-2xs);
		font-weight: 500;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 30%, transparent);
		animation: ask 2.4s var(--ease-out) infinite;
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
	@media (prefers-reduced-motion: reduce) {
		.input {
			animation: none;
		}
	}
</style>
