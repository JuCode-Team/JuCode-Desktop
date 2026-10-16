<script lang="ts">
	// A tool call an unwatched session deferred for the user: allow, deny, or
	// close it as no longer needed (the workbench offers to undo that). Shown
	// in the workbench's 待处理 list and on the remote page.
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import type { ActionView } from '$lib/daemonState.svelte';
	import { useDaemonState } from '$lib/daemonScope';
	import { t } from '$lib/i18n';
	import { when } from '$lib/time';

	let {
		action,
		onOpenSession
	}: {
		action: ActionView;
		onOpenSession: (session: string) => void;
	} = $props();

	const daemon = useDaemonState();
	/** The session's title, else its folder. */
	const where = $derived(
		daemon.sessions.find((s) => s.session === action.session_id)?.title || action.cwd.split(/[\\/]/).pop() || action.cwd
	);

	let busy = $state(false);
	let error = $state('');

	async function run(work: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await work();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<article class="card">
	<div class="card-head">
		<ShieldCheckIcon size={14} />
		<span class="kind">{t('shell.desk.action')}</span>
		<span class="who">{where} · {when(action.created_at)}</span>
	</div>
	<div class="title"><code>{action.name}</code> {action.summary}</div>
	<details>
		<summary>{t('shell.desk.arguments')}</summary>
		<pre>{action.arguments}</pre>
	</details>
	{#if error}<Notice>{error}</Notice>{/if}
	<div class="actions">
		<Button size="sm" variant="ghost" disabled={busy} onclick={() => run(() => daemon.close(action.id))}>{t('shell.desk.close')}</Button>
		<Button size="sm" onclick={() => onOpenSession(action.session_id)}>{t('shell.desk.openSession')}</Button>
		<Button size="sm" disabled={busy} onclick={() => run(() => daemon.decide(action, false))}>{t('shell.desk.deny')}</Button>
		<Button size="sm" variant="primary" disabled={busy} onclick={() => run(() => daemon.decide(action, true))}>
			{#if busy}<LoaderCircleIcon size={14} class="spin" />{/if}
			{t('shell.desk.allow')}
		</Button>
	</div>
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r);
		background: var(--surface);
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.card-head > :global(svg) {
		flex-shrink: 0;
	}
	.kind {
		flex-shrink: 0;
		font-weight: 600;
		color: var(--text);
	}
	.who {
		min-width: 0;
		color: var(--dim2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.title code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--accent-bright);
	}
	details {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	pre {
		margin: 6px 0 0;
		padding: 8px 10px;
		border-radius: var(--r);
		background: var(--surface2);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		white-space: pre-wrap;
		word-break: break-all;
		color: var(--text);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
