<script lang="ts">
	// A pending plan's actions, on its chat card and on its page: approve and
	// run in a chosen approval mode, or revise it with the next message.
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import type { ApprovalMode } from '$lib/approval';
	import type { PlanAction } from '$lib/PlanCard.svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';

	let {
		id,
		defaultMode = 'edits',
		placement = 'up-left',
		onAction
	}: {
		id: string;
		defaultMode?: ApprovalMode;
		placement?: 'up-left' | 'down-left';
		onAction: (id: string, action: PlanAction) => void;
	} = $props();

	const MODES: ApprovalMode[] = ['ask', 'edits', 'auto', 'all'];
	const LABEL: Record<string, string> = { ask: 'approvalAsk', edits: 'approvalEdits', auto: 'approvalAuto', all: 'approvalAll' };
	let mode = $state<ApprovalMode>('edits');
	$effect.pre(() => {
		mode = MODES.includes(defaultMode) ? defaultMode : 'edits';
	});
	let menuOpen = $state(false);
	const items = $derived<PopMenuItem[]>(
		MODES.map((m) => ({
			key: m,
			label: t(`chat.${LABEL[m]}`),
			desc: t(`chat.${LABEL[m]}Desc`),
			checked: m === mode,
			...(m === 'all' ? { tone: 'warn' as const } : {})
		}))
	);
</script>

<div class="actions">
	<span class="split">
		<Button variant="primary" size="sm" onclick={() => onAction(id, { decision: 'approve', mode })}>
			{t('chat.planCard.approve')}<span class="mode">· {t(`chat.${LABEL[mode]}`)}</span>
		</Button>
		<span class="anchor">
			<button class="pick" onclick={() => (menuOpen = !menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={t('chat.planCard.modeTitle')} title={t('chat.planCard.modeTitle')}>
				<CaretDownIcon size={13} />
			</button>
			{#if menuOpen}
				<PopMenu
					{items}
					title={t('chat.planCard.modeTitle')}
					{placement}
					onSelect={(k) => ((mode = k as ApprovalMode), (menuOpen = false))}
					onClose={() => (menuOpen = false)}
				/>
			{/if}
		</span>
	</span>
	<Button variant="secondary" size="sm" onclick={() => onAction(id, { decision: 'revise' })}>{t('chat.planCard.revise')}</Button>
</div>

<style>
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.split {
		display: inline-flex;
		align-items: stretch;
	}
	.split :global(.b) {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}
	.mode {
		opacity: 0.75;
	}
	.anchor {
		position: relative;
		display: inline-flex;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		padding: 0 8px;
		border: none;
		border-left: 1px solid color-mix(in oklab, var(--on-accent) 25%, transparent);
		border-radius: 0 var(--r-sm) var(--r-sm) 0;
		background: var(--accent);
		color: var(--on-accent);
		cursor: pointer;
	}
	.pick:hover {
		background: var(--accent-deep);
	}
</style>
