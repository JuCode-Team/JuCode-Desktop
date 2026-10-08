<script lang="ts" module>
	import type { ApprovalMode } from '$lib/approval';
	export type PlanAction = { decision: 'approve'; mode: ApprovalMode } | { decision: 'revise' };
</script>

<script lang="ts">
	// A plan the agent proposes in plan mode: its title, the Markdown clipped
	// to a few lines with a fade and "view the full plan", a copy button, and —
	// while it waits and is the latest message — the actions: approve and run
	// in a chosen mode, or revise it with the next message.
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import { t } from '$lib/i18n';
	import Markdown from '$lib/Markdown.svelte';
	import Button from '$lib/ui/Button.svelte';
	import PopMenu, { type PopMenuItem } from '$lib/ui/PopMenu.svelte';

	let {
		id,
		title,
		text,
		status,
		actionable = false,
		defaultMode = 'edits',
		onAction
	}: {
		id: string;
		title: string;
		text: string;
		status: string;
		/** Pending and the latest message: the approve / revise row shows. */
		actionable?: boolean;
		defaultMode?: ApprovalMode;
		onAction?: (id: string, action: PlanAction) => void;
	} = $props();

	const CLIP = 260;
	let expanded = $state(false);
	let bodyH = $state(0);
	const long = $derived(bodyH > CLIP + 24);

	let copied = $state(false);
	function copy() {
		navigator.clipboard?.writeText(title ? `# ${title}\n\n${text}` : text).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}

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

<article class="plan" aria-label={t('chat.planCard.label')}>
	<header>
		<span class="ico"><ClipboardTextIcon size={15} /></span>
		<span class="label">{t('chat.planCard.label')}</span>
		{#if status === 'approved' || status === 'revising'}
			<span class="tag {status}">{t(`chat.planCard.status.${status}`)}</span>
		{/if}
		<span class="grow"></span>
		<button class="copy" onclick={copy} aria-label={copied ? t('common.copied') : t('common.copy')} title={copied ? t('common.copied') : t('common.copy')}>
			{#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}
		</button>
	</header>
	{#if title}<h2 class="ptitle">{title}</h2>{/if}
	<div class="clip" class:folded={long && !expanded} style:--clip="{CLIP}px">
		<div class="pbody" bind:clientHeight={bodyH}><Markdown {text} /></div>
	</div>
	{#if long}
		<div class="more" class:open={expanded}>
			<button class="view" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
				{#if expanded}{t('chat.planCard.fold')}<CaretUpIcon size={13} />{:else}{t('chat.planCard.viewFull')}<ArrowRightIcon size={13} />{/if}
			</button>
		</div>
	{/if}
</article>
{#if actionable && status === 'pending' && onAction}
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
						placement="up-left"
						onSelect={(k) => ((mode = k as ApprovalMode), (menuOpen = false))}
						onClose={() => (menuOpen = false)}
					/>
				{/if}
			</span>
		</span>
		<Button variant="secondary" size="sm" onclick={() => onAction(id, { decision: 'revise' })}>{t('chat.planCard.revise')}</Button>
	</div>
{/if}

<style>
	.plan {
		max-width: 100%;
		padding: 12px 16px 14px;
		border-radius: var(--r-xl);
		background: var(--panel);
		box-shadow: var(--shadow-float);
	}
	header {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--dim);
	}
	.ico {
		display: inline-flex;
	}
	.label {
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.grow {
		flex: 1;
	}
	.tag {
		padding: 1px 8px;
		border-radius: var(--r-full);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.tag.approved {
		color: var(--ok);
		background: color-mix(in oklab, var(--ok) 12%, transparent);
	}
	.copy {
		display: inline-flex;
		padding: 5px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.copy:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.ptitle {
		margin: 10px 0 8px;
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 1.35;
	}
	.clip {
		position: relative;
	}
	.clip.folded {
		max-height: var(--clip);
		overflow: hidden;
		mask-image: linear-gradient(to bottom, black 60%, transparent);
	}
	.pbody {
		font-size: var(--fs-sm);
	}
	.more {
		display: flex;
		justify-content: center;
		margin-top: -18px;
		position: relative;
	}
	.more.open {
		margin-top: 10px;
	}
	.view {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border: none;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-xs);
		cursor: pointer;
		box-shadow: var(--shadow-sm);
		transition: background var(--t-fast) var(--ease-out);
	}
	.view:hover {
		background: color-mix(in oklab, var(--text) 12%, transparent);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
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
