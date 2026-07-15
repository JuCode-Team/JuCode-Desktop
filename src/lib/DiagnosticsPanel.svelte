<script lang="ts">
	import { Activity, Copy, Check } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';

	let { chat }: { chat: ChatState | null } = $props();

	const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
	const fmtNum = (n: number) => n.toLocaleString('en-US');

	const timing = $derived(chat?.turnTiming ?? { turns: 0, totalMs: 0, meanMs: 0 });
	const ctxPct = $derived(chat && chat.contextWindow ? Math.min(100, Math.round((chat.contextTokens / chat.contextWindow) * 100)) : 0);
	const totalTokens = $derived((chat?.totalIn ?? 0) + (chat?.totalOut ?? 0));

	// Group the diagnostics into labelled rows for rendering + copy-to-clipboard.
	const groups = $derived.by(() => {
		if (!chat) return [];
		return [
			{
				title: t('dock.diag.engine'),
				rows: [
					[t('dock.diag.backend'), chat.backendId],
					[t('dock.diag.provider'), chat.provider || '—'],
					[t('dock.diag.model'), chat.modelLabel || chat.model || '—'],
					[t('dock.diag.state'), chat.engineState || '—'],
					[t('dock.diag.session'), chat.sessionId || '—'],
					[t('dock.diag.restarts'), String(chat.restarts)]
				]
			},
			{
				title: t('dock.diag.usage'),
				rows: [
					[t('dock.diag.tokensIn'), fmtNum(chat.totalIn)],
					[t('dock.diag.tokensOut'), fmtNum(chat.totalOut)],
					[t('dock.diag.tokensTotal'), fmtNum(totalTokens)],
					[t('dock.diag.context'), chat.contextWindow ? `${fmtNum(chat.contextTokens)} / ${fmtNum(chat.contextWindow)} (${ctxPct}%)` : '—'],
					[t('dock.diag.cost'), `$${chat.cost.toFixed(4)}`]
				]
			},
			{
				title: t('dock.diag.timing'),
				rows: [
					[t('dock.diag.turns'), String(timing.turns)],
					[t('dock.diag.totalTime'), timing.totalMs ? fmtMs(timing.totalMs) : '—'],
					[t('dock.diag.meanTime'), timing.meanMs ? fmtMs(timing.meanMs) : '—']
				]
			}
		];
	});

	let copied = $state(false);
	async function copyAll() {
		const text = groups.map((g) => `## ${g.title}\n${g.rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`).join('\n\n');
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			/* clipboard blocked */
		}
	}

	const trace = $derived(chat?.statusLog ?? []);
</script>

<div class="diag">
	<div class="scroll">
		{#each groups as g (g.title)}
			<div class="grp">
				<div class="grp-title">{g.title}</div>
				{#each g.rows as [k, v] (k)}
					<div class="row"><span class="k">{k}</span><span class="v" title={v}>{v}</span></div>
				{/each}
			</div>
		{/each}

		<div class="grp">
			<div class="grp-title">{t('dock.diag.trace')} <span class="badge">{trace.length}</span></div>
			{#if trace.length === 0}
				<div class="empty">{t('dock.diag.traceEmpty')}</div>
			{:else}
				{#each trace.slice(-40) as line, i (i)}
					<div class="tline">{line}</div>
				{/each}
			{/if}
		</div>
	</div>
	<div class="foot">
		<button class="copybtn" onclick={copyAll}>
			{#if copied}<Check size={12} />{t('dock.diag.copied')}{:else}<Copy size={12} />{t('dock.diag.copy')}{/if}
		</button>
		<span class="spacer"></span>
		<Activity size={12} />
	</div>
</div>

<style>
	.diag {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 10px;
	}
	.grp {
		margin-bottom: 14px;
	}
	.grp-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim2);
		font-family: var(--font-mono);
		margin-bottom: 6px;
	}
	.badge {
		color: var(--dim2);
		background: var(--surface2);
		border-radius: 999px;
		padding: 0 6px;
		font-size: 10px;
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 3px 4px;
		font-size: 12px;
	}
	.k {
		color: var(--dim);
		flex-shrink: 0;
		min-width: 92px;
	}
	.v {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 11.5px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		text-align: right;
	}
	.empty {
		font-size: 12px;
		color: var(--dim2);
		font-family: var(--font-mono);
		padding: 4px;
	}
	.tline {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--dim);
		padding: 2px 4px;
		border-left: 2px solid var(--hairline);
		margin-bottom: 2px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-top: 1px solid var(--hairline);
		color: var(--dim2);
		flex-shrink: 0;
	}
	.spacer {
		flex: 1;
	}
	.copybtn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 9px;
		font-size: 11.5px;
		color: var(--dim);
		background: none;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		cursor: pointer;
	}
	.copybtn:hover {
		color: var(--text);
		background: var(--surface2);
	}
</style>
