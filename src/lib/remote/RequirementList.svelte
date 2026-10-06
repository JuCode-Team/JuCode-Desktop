<script lang="ts">
	// The Requirements tab's list on the remote page: noting an idea, then the
	// requirements on this computer by whose turn it is (the user's first),
	// each with its project; done and parked folded. A row opens the
	// requirement as a page.
	import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLineIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import RequirementTag from '$lib/requirements/RequirementTag.svelte';
	import { grouped, type Requirement, type RequirementGroup } from '$lib/requirements.svelte';
	import { projectLabel, statusLabel, when } from '$lib/requirements/labels';
	import { t } from '$lib/i18n';
	import { useHost } from './connection.svelte';

	let {
		current,
		composing = false,
		onNew,
		onOpen
	}: {
		/** The requirement shown in the pane, highlighted. */
		current?: string;
		/** The capture page is the pane's page. */
		composing?: boolean;
		onNew: () => void;
		onOpen: (id: string) => void;
	} = $props();

	const conn = useHost();
	const groups = $derived(grouped(conn.requirements.list));
	let showClosed = $state(false);
	const HEADS: Record<Exclude<RequirementGroup, 'closed'>, string> = {
		attention: 'shell.requirement.groupAttention',
		active: 'shell.requirement.groupActive',
		idea: 'shell.requirement.groupIdea'
	};
	const counts = $derived({
		done: groups.closed.filter((r) => r.status === 'done').length,
		parked: groups.closed.filter((r) => r.status === 'parked').length
	});
	const projects = $derived(conn.projects.workspaces.flatMap((w) => w.projects));
	function sub(r: Requirement): string {
		const where = projectLabel(r.project, projects);
		if (r.proposal?.reason) return `${where} · ${statusLabel(r.status)} · ${r.proposal.reason}`;
		if (r.last_reply && (r.status === 'review' || r.status === 'failed' || r.status === 'confirm'))
			return `${where} · ${r.status === 'confirm' ? `${statusLabel(r.status)} · ` : ''}${r.last_reply.replace(/\s+/g, ' ')}`;
		if (r.status === 'idea') return `${where} · ${when(r.created_at)}`;
		return `${where} · ${statusLabel(r.status)}`;
	}
</script>

{#snippet row(r: Requirement)}
	<button class="row" class:on={current === r.id} onclick={() => onOpen(r.id)}>
		<span class="mark {r.status}">
			{#if r.status === 'running'}<CircleNotchIcon size={14} class="spin" />{:else}<span class="dot"></span>{/if}
		</span>
		<span class="text">
			<span class="title"><RequirementTag id={r.id} /><span class="name">{r.title}</span></span>
			<span class="meta">{sub(r)}</span>
		</span>
	</button>
{/snippet}

<div class="list">
	<button class="new" class:on={composing} onclick={onNew}>
		<PencilSimpleLineIcon size={16} />
		<span>{t('shell.requirement.capture')}</span>
	</button>

	{#each ['attention', 'active', 'idea'] as const as g (g)}
		{#if groups[g].length}
			<section>
				<div class="head">{t(HEADS[g])}<span class="n">{groups[g].length}</span></div>
				{#each groups[g] as r (r.id)}{@render row(r)}{/each}
			</section>
		{/if}
	{/each}
	{#if groups.closed.length}
		<section>
			<button class="head fold" onclick={() => (showClosed = !showClosed)} aria-expanded={showClosed}>
				{#if showClosed}<CaretDownIcon size={12} />{:else}<CaretRightIcon size={12} />{/if}
				{t('shell.requirement.groupClosed', counts)}
			</button>
			{#if showClosed}
				{#each groups.closed as r (r.id)}{@render row(r)}{/each}
			{/if}
		</section>
	{/if}
	{#if !conn.requirements.list.length}
		<p class="empty">{t('shell.requirement.empty')}</p>
	{/if}
</div>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-bottom: 16px;
	}
	.new {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 42px;
		padding: 0 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: background var(--t-fast) var(--ease-out);
	}
	.new:hover,
	.new.on {
		background: var(--surface2);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.n {
		font-family: var(--font-mono);
	}
	.fold {
		width: 100%;
		border: none;
		background: none;
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 52px;
		padding: 6px 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.row:hover {
		background: var(--surface);
	}
	.row:active {
		transform: scale(0.985);
	}
	.row.on {
		background: var(--surface2);
	}
	.mark {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		color: var(--ok);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.mark.review .dot,
	.mark.confirm .dot,
	.mark.proposed .dot,
	.mark.proposal .dot {
		background: var(--warn);
	}
	.mark.approval .dot,
	.mark.failed .dot {
		background: var(--err);
	}
	.mark.done .dot {
		background: var(--ok);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.name,
	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.empty {
		margin: 0;
		padding: 4px 12px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
</style>
