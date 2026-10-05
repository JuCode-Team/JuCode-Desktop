<script lang="ts">
	import { onMount } from 'svelte';
	import { dispatch, isDraft } from '$lib/backends/router';
	import type { ChatState } from '$lib/chat.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';

	// The current Claude Code session's permission rules, as /permissions lists
	// them: from settings files, this session's approvals and flags, each with
	// where it lives. Read-only: rules are saved from the approval card
	// (始终允许 → this project / every project).
	let { sessionId, chat }: { sessionId: string; chat: ChatState } = $props();

	let error = $state('');
	const live = $derived(!!sessionId && chat.engineState !== 'exited' && !isDraft(sessionId));
	onMount(() => {
		if (live) dispatch(sessionId, { op: 'permission_rules' }, (e) => (error = String(e)));
	});

	const groups = $derived.by(() => {
		const rules = chat.permissionRules?.rules ?? [];
		return (['allow', 'ask', 'deny'] as const)
			.map((behavior) => ({ behavior, rules: rules.filter((r) => r.behavior === behavior) }))
			.filter((g) => g.rules.length);
	});
	const source = (s: string) => {
		const known = ['userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg', 'policySettings'];
		return t(`settings.rules.source.${known.includes(s) ? s : 'other'}`);
	};
</script>

<SettingsSection id="permission-rules" title={t('settings.rules.title')} description={t('settings.rules.hint')}>
	{#if !live}
		<div class="pad"><Notice tone="info">{t('settings.rules.noSession')}</Notice></div>
	{:else if error}
		<div class="pad"><Notice>{error}</Notice></div>
	{:else if !chat.permissionRules}
		<p class="empty">{t('settings.rules.loading')}</p>
	{:else if !groups.length}
		<p class="empty">{t('settings.rules.empty')}</p>
	{:else}
		{#each groups as g (g.behavior)}
			<div class="group">
				<div class="ghead">{t(`settings.rules.behavior.${g.behavior}`)}</div>
				{#each g.rules as r, i (i)}
					<div class="rule">
						<code>{r.rule}</code>
						<span class="src">{source(r.source)}</span>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
</SettingsSection>

<style>
	.pad {
		padding: 12px 16px;
	}
	.empty {
		margin: 0;
		padding: 14px 16px;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.group {
		padding: 10px 16px;
	}
	.group + .group {
		border-top: 1px solid var(--hairline);
	}
	.ghead {
		margin-bottom: 6px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.rule {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 3px 0;
		min-width: 0;
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
		overflow-wrap: anywhere;
		flex: 1;
		min-width: 0;
	}
	.src {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
</style>
