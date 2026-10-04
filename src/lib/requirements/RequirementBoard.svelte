<script lang="ts">
	// The workbench's requirements page: noting an idea, then the list by
	// whose turn it is (the user's first, then work in progress, then ideas;
	// done and parked folded). A row opens the requirement.
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import LightbulbIcon from 'phosphor-svelte/lib/LightbulbIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import RequirementCapture from './RequirementCapture.svelte';
	import RequirementTag from './RequirementTag.svelte';
	import StartButton, { type StartHow } from './StartButton.svelte';
	import { grouped, type Requirement } from '$lib/requirements.svelte';
	import { useAgents } from '$lib/agentScope';
	import { statusLabel, sourceLabel, when } from './labels';
	import { t } from '$lib/i18n';

	let {
		list,
		projects,
		focusSignal = 0,
		currentStep,
		onOpen,
		onStart
	}: {
		/** The requirements shown (the open workspace's). */
		list: Requirement[];
		projects: { path: string; name: string }[];
		focusSignal?: number;
		/** What a running session is doing now, when this computer shows it. */
		currentStep?: (session: string) => string | undefined;
		onOpen: (id: string) => void;
		onStart: (r: Requirement, how: StartHow) => void;
	} = $props();

	const agents = useAgents();
	const groups = $derived(grouped(list));
	let showClosed = $state(false);
	const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
	const counts = $derived({
		done: groups.closed.filter((r) => r.status === 'done').length,
		parked: groups.closed.filter((r) => r.status === 'parked').length
	});

	function sessionTitle(id: string | null | undefined): string {
		return (id && agents.sessions.find((s) => s.session === id)?.title) || t('shell.agentPage.untitled');
	}
	/** What a running requirement's latest running session is doing. */
	function step(r: Requirement): string | undefined {
		const running = r.sessions.filter((s) => r.session_states?.[s] === 'running');
		for (const s of running.reverse()) {
			const now = currentStep?.(s);
			if (now) return now;
		}
	}
</script>

{#snippet row(r: Requirement)}
	<div class="row" class:attention={r.status === 'review' || r.status === 'approval' || r.status === 'failed'}>
		<button class="open" onclick={() => onOpen(r.id)}>
			<RequirementTag id={r.id} />
			<span class="main">
				<span class="tt">
					<span class="title">{r.title}</span>
					{#if r.images.length}<ImageIcon size={13} class="dim2" />{/if}
					{#each r.projects as p (p)}<span class="chip">{base(p)}</span>{/each}
					{#if r.status === 'approval' || r.status === 'failed'}
						<span class="chip {r.status}">{statusLabel(r.status)}</span>
					{/if}
				</span>
				<span class="sub">
					{#if r.status === 'review' || r.status === 'failed'}
						{#if r.last_reply}<ChatCircleTextIcon size={13} /><span class="q">{r.last_reply.replace(/\s+/g, ' ')}</span>{/if}
					{:else if r.status === 'approval'}
						<span class="q">{statusLabel(r.status)}</span>
					{:else if r.status === 'running'}
						{@const now = step(r)}
						{#if now}<ArrowRightIcon size={13} /><span class="q">{now}</span>{:else}<span class="q">{statusLabel(r.status)}</span>{/if}
					{:else}
						<span class="q">
							{r.source === 'session'
								? t('shell.requirement.fromSession', { title: sessionTitle(r.source_session) })
								: sourceLabel(r.source)} · {when(r.created_at)}{r.projects.length ? '' : ` · ${t('shell.requirement.noProject')}`}
						</span>
					{/if}
				</span>
			</span>
			{#if r.sessions.length}<span class="meta">{t('shell.requirement.sessions', { n: r.sessions.length })}</span>{/if}
		</button>
		{#if r.status === 'idea'}
			<StartButton requirement={r} {projects} onStart={(how) => onStart(r, how)} />
		{/if}
	</div>
{/snippet}

<h1>{t('shell.requirement.title')}</h1>
<p class="lede">{t('shell.requirement.lede')}</p>
<RequirementCapture {focusSignal} />

{#if !list.length}
	<p class="empty">{t('shell.requirement.empty')}</p>
{/if}
{#if groups.attention.length}
	<section>
		<h3><span class="dot warn"></span>{t('shell.requirement.groupAttention')}<span class="n">{groups.attention.length}</span></h3>
		{#each groups.attention as r (r.id)}{@render row(r)}{/each}
	</section>
{/if}
{#if groups.active.length}
	<section>
		<h3><CircleNotchIcon size={12} class="spin" />{t('shell.requirement.groupActive')}<span class="n">{groups.active.length}</span></h3>
		{#each groups.active as r (r.id)}{@render row(r)}{/each}
	</section>
{/if}
{#if groups.idea.length}
	<section>
		<h3><LightbulbIcon size={13} />{t('shell.requirement.groupIdea')}<span class="n">{groups.idea.length}</span></h3>
		{#each groups.idea as r (r.id)}{@render row(r)}{/each}
	</section>
{/if}
{#if groups.closed.length}
	<section>
		<button class="fold" onclick={() => (showClosed = !showClosed)} aria-expanded={showClosed}>
			{#if showClosed}<CaretDownIcon size={12} />{:else}<CaretRightIcon size={12} />{/if}
			{t('shell.requirement.groupClosed', counts)}
		</button>
		{#if showClosed}
			{#each groups.closed as r (r.id)}{@render row(r)}{/each}
		{/if}
	</section>
{/if}

<style>
	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.15;
		color: var(--text);
	}
	.lede {
		margin: 10px 0 18px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.empty {
		margin: 18px 2px;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	section {
		margin-top: 22px;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0 0 6px;
		padding: 0 4px;
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--dim);
	}
	.n {
		font-family: var(--font-mono);
		color: var(--dim2);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: var(--r-full);
		background: var(--warn);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-right: 10px;
		border-radius: var(--r-md);
		transition: background var(--t-fast) var(--ease-out);
	}
	.row:hover {
		background: var(--surface);
	}
	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 10px;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tt {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		font-size: var(--fs-sm);
	}
	.title {
		min-width: 0;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tt :global(.dim2) {
		flex: none;
		color: var(--dim2);
	}
	.chip {
		flex: none;
		padding: 0 7px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-2xs);
		line-height: 1.6;
		white-space: nowrap;
	}
	.chip.approval {
		background: color-mix(in oklab, var(--err) 12%, transparent);
		color: var(--err);
	}
	.chip.failed {
		background: color-mix(in oklab, var(--err) 12%, transparent);
		color: var(--err);
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.sub :global(svg) {
		flex: none;
	}
	.q {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		flex: none;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.fold {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.fold:hover {
		color: var(--text);
	}
</style>
