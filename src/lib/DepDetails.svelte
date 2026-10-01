<script lang="ts">
	// What an install leaves under its row: the copyable command (Linux sudo),
	// the live log, and the outcome. Renders nothing while there is none.
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import type { DepReport } from '$lib/protocol';
	import { deps, planCommand } from '$lib/deps.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';

	let { dep }: { dep: DepReport } = $props();

	const cmd = $derived(dep.present ? null : planCommand(dep));
	const log = $derived(deps.logs[dep.id] ?? []);
	const msg = $derived(deps.msgs[dep.id]);
	let copied = $state(false);

	function copyCmd(text: string) {
		navigator.clipboard?.writeText(text).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
</script>

{#if cmd || log.length || msg}
	<div class="details">
		{#if cmd}
			<p class="hint">{t('setup.deps.manualHint')}</p>
			<div class="cmd">
				<code>{cmd}</code>
				<IconButton size="sm" onclick={() => copyCmd(cmd)} label="copy" title={t('setup.deps.copy')}>
					{#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}
				</IconButton>
			</div>
		{/if}
		{#if log.length}
			<div class="logbox">
				<div class="log-head">{t('setup.deps.logTitle')}</div>
				<pre class="log">{log.join('\n')}</pre>
			</div>
		{/if}
		{#if msg?.ok}
			<p class="donemsg">{msg.text}</p>
		{:else if msg}
			<Notice>{msg.text}</Notice>
		{/if}
	</div>
{/if}

<style>
	.details {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim);
	}
	.cmd {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 8px 8px 12px;
		background: var(--sidebar);
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
	}
	.cmd code {
		flex: 1;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
		white-space: nowrap;
		overflow-x: auto;
	}
	.logbox {
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		overflow: hidden;
		background: var(--sidebar);
	}
	.log-head {
		padding: 6px 10px;
		font-size: var(--fs-2xs);
		font-weight: 600;
		color: var(--dim);
		border-bottom: 1px solid var(--hairline);
	}
	.log {
		margin: 0;
		padding: 8px 10px;
		max-height: 180px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.5;
		color: var(--dim);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.donemsg {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--ok);
	}
</style>
