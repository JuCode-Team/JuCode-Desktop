<script lang="ts">
	import Switch from '$lib/ui/Switch.svelte';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';

	export type SessionSwitch = 'ultracode' | 'fast' | 'thinking';

	// Claude Code's per-session switches, shown only where the engine offers
	// them: ultracode (standing Workflow orchestration), fast mode and
	// thinking summaries.
	let { chat, onSwitch }: { chat: ChatState; onSwitch: (name: SessionSwitch, on: boolean) => void } = $props();

	const rows = $derived(
		[
			chat.ultracodeAvailable && { name: 'ultracode' as const, label: 'Ultracode', desc: t('chat.ultracodeDesc'), on: chat.ultracode },
			(chat.fastAvailable || chat.fast) && { name: 'fast' as const, label: t('chat.fastLabel'), desc: t('chat.fastDesc'), on: chat.fast },
			chat.thinkingSummaries !== null && {
				name: 'thinking' as const,
				label: t('chat.thinkingLabel'),
				desc: t('chat.thinkingDesc'),
				on: chat.thinkingSummaries
			}
		].filter((r) => !!r)
	);
</script>

{#each rows as row (row.name)}
	<section class="sw-row">
		<span class="txt">
			<span class="label">{row.label}</span>
			<span class="desc">{row.desc}</span>
		</span>
		<Switch checked={row.on} label={row.label} onChange={(on) => onSwitch(row.name, on)} />
	</section>
{/each}

<style>
	.sw-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 6px 8px;
	}
	.txt {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.label {
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.desc {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
</style>
